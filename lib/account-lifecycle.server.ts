import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountDataPolicy } from "./account-deletion";
import { validateAccountLifecycleJob, type AccountLifecycleGateway } from "./account-lifecycle";

export const lifecycleProof = (bearer: string) => createHash("sha256").update(bearer).digest("hex");
function assertResult(result: { error: unknown }) { if (result.error) throw result.error; }
export async function recoverAccountLifecycleActor(admin: SupabaseClient, requestId: string, dataPolicy: AccountDataPolicy, proof: string) {
  const result = await admin.rpc("account_lifecycle_recover", {
    operation_id: requestId, policy: dataPolicy, proof_hash: lifecycleProof(proof),
  }).abortSignal(AbortSignal.timeout(8_000));
  assertResult(result);
  return typeof result.data === "string" ? result.data : null;
}

export function accountLifecycleGateway(admin: SupabaseClient, actor: string, requestId: string, dataPolicy: AccountDataPolicy, token: string, recoveryToken?: string): AccountLifecycleGateway {
  const lease = randomUUID();
  const rpcJob = async (name: string, values: Record<string, unknown>) => {
    const result = await admin.rpc(name, values).abortSignal(AbortSignal.timeout(15_000));
    assertResult(result); return validateAccountLifecycleJob(result.data, { actor, requestId, dataPolicy, lease });
  };
  return {
    acquire: () => rpcJob("account_lifecycle_acquire", { actor, operation_id: requestId, policy: dataPolicy, proof_hash: lifecycleProof(recoveryToken || token), lease }),
    storageBatch: async job => {
      const result = await admin.rpc("account_lifecycle_storage", { operation_id: requestId, lease: job.lease_token }).abortSignal(AbortSignal.timeout(8_000));
      assertResult(result);
      if (!Array.isArray(result.data) || result.data.some(row => typeof row.bucket_id !== "string" || typeof row.name !== "string")) throw new Error("INVALID_STORAGE_MANIFEST");
      return result.data;
    },
    removeStorage: async (bucket, names) => { assertResult(await admin.storage.from(bucket).remove(names)); },
    prepare: job => rpcJob("account_lifecycle_prepare", { operation_id: requestId, lease: job.lease_token }),
    revokeAndBan: async job => {
      const current = await admin.auth.admin.getUserById(job.user_id);
      if (current.error) {
        if (job.data_policy === "delete_golf_data" && current.error.code === "user_not_found") return;
        throw current.error;
      }
      assertResult(await admin.auth.admin.updateUserById(job.user_id, { ban_duration: "876000h" }));
      const result = token ? await admin.auth.admin.signOut(token, "global") : { error: null };
      // A retry may follow a previous sign-out. SQL blocks stale JWTs already.
      if (result.error && ![401, 403, 404].includes(result.error.status || 0)) throw result.error;
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
  };
}
