import type { AccountDataPolicy } from "./account-deletion";
import { isolatedPreviewDatabaseEnabled } from "./preview-database";

export function accountLifecycleEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ACCOUNT_LIFECYCLE_ENABLED === "true" && isolatedPreviewDatabaseEnabled(env);
}

export type AccountLifecycleJob = {
  request_id: string; user_id: string; data_policy: AccountDataPolicy;
  stage: "requested" | "data_prepared" | "completed";
  lease_token: string | null; completed_at: string | null;
};
export function validateAccountLifecycleJob(value: unknown, scope: { actor: string; requestId: string; dataPolicy: AccountDataPolicy; lease: string }): AccountLifecycleJob {
  const job = value as Partial<AccountLifecycleJob> | null;
  if (!job || job.request_id !== scope.requestId || job.user_id !== scope.actor || job.data_policy !== scope.dataPolicy ||
    !["requested", "data_prepared", "completed"].includes(job.stage || "") ||
    (job.lease_token !== null && job.lease_token !== scope.lease) ||
    (job.stage === "completed" && (job.lease_token !== null || typeof job.completed_at !== "string" || !Number.isFinite(Date.parse(job.completed_at))))) {
    throw new Error("INVALID_LIFECYCLE_RESPONSE");
  }
  return job as AccountLifecycleJob;
}
export type AccountLifecycleGateway = {
  acquire: () => Promise<AccountLifecycleJob>;
  storageBatch: (job: AccountLifecycleJob) => Promise<Array<{ bucket_id: string; name: string }>>;
  removeStorage: (bucket: string, names: string[]) => Promise<void>;
  prepare: (job: AccountLifecycleJob) => Promise<AccountLifecycleJob>;
  revokeAndBan: (job: AccountLifecycleJob) => Promise<void>;
  deleteAuth: (job: AccountLifecycleJob) => Promise<void>;
  complete: (job: AccountLifecycleJob) => Promise<AccountLifecycleJob>;
  release: (job: AccountLifecycleJob) => Promise<void>;
};

/** Auth/Storage cannot join a Postgres transaction. A durable, leased saga
 * records the blocked account before external work; SQL graph preparation is
 * atomic, Auth is last, and the exact authenticated request can resume. */
export async function executeAccountLifecycle(gateway: AccountLifecycleGateway) {
  let job = await gateway.acquire();
  if (job.stage === "completed") return job;
  if (!job.lease_token) throw new Error("ACCOUNT_OPERATION_BUSY");
  try {
    if (job.data_policy === "delete_golf_data" && job.stage === "requested") {
      // Delete through Storage API, never storage.objects SQL. Re-query offset
      // zero after each batch so deletion cannot skip shifting object offsets.
      for (let batch = 0; batch < 100; batch += 1) {
        const objects = await gateway.storageBatch(job);
        if (!objects.length) break;
        const buckets = new Map<string, string[]>();
        for (const object of objects) buckets.set(object.bucket_id, [...(buckets.get(object.bucket_id) || []), object.name]);
        for (const [bucket, names] of buckets) await gateway.removeStorage(bucket, names);
        if (batch === 99) throw new Error("ACCOUNT_STORAGE_MORE_PENDING");
      }
    }
    if (job.stage === "requested") job = await gateway.prepare(job);
    await gateway.revokeAndBan(job);
    if (job.data_policy === "delete_golf_data") await gateway.deleteAuth(job);
    return await gateway.complete(job);
  } finally {
    await gateway.release(job).catch(() => undefined);
  }
}
