import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountDataPolicy } from "./account-deletion";
import { accountLifecycleSignOutAlreadyComplete, validateAccountLifecycleJob, type AccountLifecycleGateway, type AccountLifecycleStorageRehome } from "./account-lifecycle";

export const lifecycleProof = (bearer: string) => createHash("sha256").update(bearer).digest("hex");
export const lifecycleRequestReference = (requestId: string) => createHash("sha256").update(requestId).digest("hex").slice(0, 12);
function assertResult(result: { error: unknown }) { if (result.error) throw result.error; }
function storageCopyAlreadyExists(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return candidate.status === 409 || candidate.statusCode === "409";
}
function validateStorageRehomes(value: unknown): AccountLifecycleStorageRehome[] {
  if (!Array.isArray(value)) throw new Error("INVALID_STORAGE_REHOME_MANIFEST");
  for (const row of value) {
    if (!row || typeof row !== "object") throw new Error("INVALID_STORAGE_REHOME_MANIFEST");
    const item = row as Partial<AccountLifecycleStorageRehome>;
    if (typeof item.document_id !== "string" || typeof item.bucket_id !== "string" || typeof item.name !== "string"
      || typeof item.replacement_name !== "string" || item.bucket_id !== "admin-documents-private"
      || !item.name || !item.replacement_name.startsWith(`account-lifecycle-shared/${item.document_id}.`)
      || item.name === item.replacement_name) throw new Error("INVALID_STORAGE_REHOME_MANIFEST");
  }
  return value as AccountLifecycleStorageRehome[];
}
export async function recoverAccountLifecycleActor(admin: SupabaseClient, requestId: string, dataPolicy: AccountDataPolicy, proof: string) {
  const result = await admin.rpc("account_lifecycle_recover", {
    operation_id: requestId, policy: dataPolicy, proof_hash: lifecycleProof(proof),
  }).abortSignal(AbortSignal.timeout(8_000));
  assertResult(result);
  return typeof result.data === "string" ? result.data : null;
}

export function accountLifecycleGateway(
  admin: SupabaseClient,
  actor: string,
  requestId: string,
  dataPolicy: AccountDataPolicy,
  token: string,
  recoveryToken?: string,
  observeError?: AccountLifecycleGateway["observeError"],
): AccountLifecycleGateway {
  const lease = randomUUID();
  const rpcJob = async (name: string, values: Record<string, unknown>, options: { allowBusyLease?: boolean } = {}) => {
    const result = await admin.rpc(name, values).abortSignal(AbortSignal.timeout(15_000));
    assertResult(result); return validateAccountLifecycleJob(result.data, { actor, requestId, dataPolicy, lease }, options);
  };
  return {
    acquire: () => rpcJob("account_lifecycle_acquire", { actor, operation_id: requestId, policy: dataPolicy, proof_hash: lifecycleProof(recoveryToken || token), lease }, { allowBusyLease: true }),
    storageRehomeBatch: async job => {
      const result = await admin.rpc("account_lifecycle_storage_rehomes", { operation_id: requestId, lease: job.lease_token }).abortSignal(AbortSignal.timeout(8_000));
      assertResult(result);
      return validateStorageRehomes(result.data);
    },
    copyStorage: async rehome => {
      const result = await admin.storage.from(rehome.bucket_id).copy(rehome.name, rehome.replacement_name);
      // A previous request can have copied the deterministic target before a
      // transport failure. The commit RPC below validates the target, owner,
      // source and document atomically; only an exact Storage conflict is safe.
      if (result.error && !storageCopyAlreadyExists(result.error)) throw result.error;
    },
    commitStorageRehome: async (job, rehome) => {
      const result = await admin.rpc("account_lifecycle_commit_storage_rehome", {
        operation_id: requestId,
        lease: job.lease_token,
        target_document_id: rehome.document_id,
        source_name: rehome.name,
        replacement_name: rehome.replacement_name,
      }).abortSignal(AbortSignal.timeout(8_000));
      assertResult(result);
      if (result.data !== true) throw new Error("INVALID_STORAGE_REHOME_COMMIT");
    },
    storageBatch: async job => {
      const result = await admin.rpc("account_lifecycle_storage", { operation_id: requestId, lease: job.lease_token }).abortSignal(AbortSignal.timeout(8_000));
      assertResult(result);
      if (!Array.isArray(result.data) || result.data.some(row => typeof row.bucket_id !== "string" || typeof row.name !== "string")) throw new Error("INVALID_STORAGE_MANIFEST");
      return result.data;
    },
    removeStorage: async (bucket, names) => { assertResult(await admin.storage.from(bucket).remove(names)); },
    prepare: job => rpcJob("account_lifecycle_prepare", { operation_id: requestId, lease: job.lease_token }),
    reconcile: job => rpcJob("account_lifecycle_reconcile_identifiers", { operation_id: requestId, lease: job.lease_token }),
    revokeAndBan: async job => {
      const current = await admin.auth.admin.getUserById(job.user_id);
      if (current.error) {
        if (job.data_policy === "delete_golf_data" && current.error.code === "user_not_found") return;
        throw current.error;
      }
      assertResult(await admin.auth.admin.updateUserById(job.user_id, { ban_duration: "876000h" }));
    },
    signOut: async () => {
      const result = token ? await admin.auth.admin.signOut(token, "global") : { error: null };
      // A retry may follow a previous sign-out. SQL blocks stale JWTs already.
      if (result.error && !accountLifecycleSignOutAlreadyComplete(result.error)
        && ![401, 403, 404].includes(result.error.status || 0)) throw result.error;
    },
    deleteAuth: async job => {
      const result = await admin.auth.admin.deleteUser(job.user_id, false);
      if (result.error && result.error.code !== "user_not_found") throw result.error;
    },
    complete: job => rpcJob("account_lifecycle_complete", { operation_id: requestId, lease: job.lease_token }),
    release: async job => {
      const result = await admin.rpc("account_lifecycle_release", { operation_id: requestId, lease: job.lease_token }).abortSignal(AbortSignal.timeout(5_000));
      assertResult(result);
    },
    observeError,
  };
}
