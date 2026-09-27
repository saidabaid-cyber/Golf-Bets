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

export const ACCOUNT_LIFECYCLE_STAGES = [
  "authenticate", "recover", "acquire", "storageRehomeBatch", "copyStorage", "commitStorageRehome",
  "storageBatch", "removeStorage",
  "prepare", "reconcile", "revokeAndBan", "signOut", "deleteAuth", "complete", "release",
] as const;
export type AccountLifecycleStage = (typeof ACCOUNT_LIFECYCLE_STAGES)[number];

type AccountLifecycleErrorMetadata = {
  code?: string;
  errorClass?: string;
  status?: number;
};

const SAFE_ERROR_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
function safeErrorToken(value: unknown, fallback: string) {
  const token = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  return SAFE_ERROR_TOKEN.test(token) ? token : fallback;
}
function safeErrorStatus(value: unknown) {
  const status = typeof value === "number" ? value : typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : undefined;
  return status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

/** A deliberately lossy error: no upstream message, token or PII is retained. */
export class AccountLifecycleStageError extends Error {
  readonly stage: AccountLifecycleStage;
  readonly code: string;
  readonly errorClass: string;
  readonly status?: number;

  constructor(stage: AccountLifecycleStage, metadata: AccountLifecycleErrorMetadata = {}) {
    super("ACCOUNT_LIFECYCLE_STAGE_FAILED");
    this.name = "AccountLifecycleStageError";
    this.stage = stage;
    this.code = safeErrorToken(metadata.code, "ACCOUNT_LIFECYCLE_FAILED");
    this.errorClass = safeErrorToken(metadata.errorClass, "UnknownError");
    this.status = safeErrorStatus(metadata.status);
  }
}

export function asAccountLifecycleStageError(stage: AccountLifecycleStage, error: unknown) {
  if (error instanceof AccountLifecycleStageError) return error;
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const namedError = error instanceof Error ? error : null;
  const internalCode = namedError && /^(?:ACCOUNT|INVALID)_[A-Z0-9_]{1,55}$/.test(namedError.message) ? namedError.message : undefined;
  return new AccountLifecycleStageError(stage, {
    code: safeErrorToken(source.code ?? internalCode, "ACCOUNT_LIFECYCLE_FAILED"),
    errorClass: safeErrorToken(source.name ?? namedError?.name ?? namedError?.constructor?.name, "UnknownError"),
    status: safeErrorStatus(source.status ?? source.statusCode),
  });
}

export async function runAccountLifecycleStage<T>(stage: AccountLifecycleStage, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    throw asAccountLifecycleStageError(stage, error);
  }
}

export function accountLifecycleSafeError(error: unknown) {
  const failure = error instanceof AccountLifecycleStageError
    ? error
    : asAccountLifecycleStageError("acquire", error);
  return {
    stage: failure.stage,
    code: failure.code,
    errorClass: failure.errorClass,
    ...(failure.status === undefined ? {} : { status: failure.status }),
  };
}

/** Supabase Auth reports a replayed global sign-out as HTTP 400. Only the
 * provider's exact missing-session signals are terminal-success; a generic
 * 400 must remain visible to the lifecycle retry path. */
export function accountLifecycleSignOutAlreadyComplete(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return candidate.code === "session_not_found" || candidate.name === "AuthSessionMissingError";
}

export type AccountLifecycleFailureResponse = {
  status: number;
  body: { code: string; error: string; pending?: true };
};

/** Stable, non-sensitive API failures. Raw provider messages never cross the boundary. */
export function accountLifecycleFailureResponse(error: unknown): AccountLifecycleFailureResponse {
  const failure = error instanceof AccountLifecycleStageError
    ? error
    : asAccountLifecycleStageError("acquire", error);
  if (failure.stage === "acquire" && failure.code === "23505") return {
    status: 409,
    body: { code: "ACCOUNT_REQUEST_CONFLICT", error: "Ya existe una solicitud de cierre. Reanuda esa solicitud para continuar." },
  };
  if (failure.code === "ACCOUNT_OPERATION_BUSY") return {
    status: 409,
    body: { code: "ACCOUNT_OPERATION_BUSY", pending: true, error: "La solicitud ya está en curso. Espera un momento y vuelve a intentarlo con la misma solicitud." },
  };
  if (failure.stage === "authenticate") {
    if ([401, 403].includes(failure.status || 0) || failure.code === "AUTH_REQUIRED") return {
      status: 401,
      body: { code: "AUTH_REQUIRED", error: "La sesión terminó. Vuelve a iniciar sesión." },
    };
    return {
      status: 503,
      body: { code: "ACCOUNT_AUTHENTICATION_UNAVAILABLE", pending: true, error: "No pudimos verificar la sesión. Reintenta con la misma solicitud." },
    };
  }
  if (failure.stage === "recover") return {
    status: [401, 403].includes(failure.status || 0) || failure.code === "AUTH_REQUIRED" ? 401 : 503,
    body: [401, 403].includes(failure.status || 0) || failure.code === "AUTH_REQUIRED"
      ? { code: "AUTH_REQUIRED", error: "La sesión terminó. Vuelve a iniciar sesión." }
      : { code: "ACCOUNT_RECOVERY_PENDING", pending: true, error: "No pudimos reanudar la solicitud. Reintenta con la misma solicitud." },
  };
  const byStage: Partial<Record<AccountLifecycleStage, { code: string; error: string }>> = {
    acquire: { code: "ACCOUNT_ACQUIRE_PENDING", error: "No pudimos iniciar o reanudar la solicitud. Reintenta con la misma solicitud." },
    storageRehomeBatch: { code: "ACCOUNT_STORAGE_PENDING", error: "La preservación de archivos compartidos todavía no termina. Reintenta con la misma solicitud." },
    copyStorage: { code: "ACCOUNT_STORAGE_PENDING", error: "La preservación de archivos compartidos todavía no termina. Reintenta con la misma solicitud." },
    commitStorageRehome: { code: "ACCOUNT_STORAGE_PENDING", error: "La preservación de archivos compartidos todavía no termina. Reintenta con la misma solicitud." },
    storageBatch: { code: "ACCOUNT_STORAGE_PENDING", error: "La limpieza de archivos todavía no termina. Reintenta con la misma solicitud." },
    removeStorage: { code: "ACCOUNT_STORAGE_PENDING", error: "La limpieza de archivos todavía no termina. Reintenta con la misma solicitud." },
    prepare: { code: "ACCOUNT_DATA_CLEANUP_PENDING", error: "La limpieza de datos todavía no termina. Reintenta con la misma solicitud." },
    reconcile: { code: "ACCOUNT_DATA_CLEANUP_PENDING", error: "La reconciliación de datos todavía no termina. Reintenta con la misma solicitud." },
    revokeAndBan: { code: "ACCOUNT_AUTH_PENDING", error: "El cierre de acceso todavía no termina. Reintenta con la misma solicitud." },
    signOut: { code: "ACCOUNT_AUTH_PENDING", error: "El cierre de sesión todavía no termina. Reintenta con la misma solicitud." },
    deleteAuth: { code: "ACCOUNT_AUTH_PENDING", error: "La eliminación de identidad todavía no termina. Reintenta con la misma solicitud." },
    complete: { code: "ACCOUNT_FINALIZATION_PENDING", error: "La operación todavía no se ha confirmado. Reintenta con la misma solicitud." },
    release: { code: "ACCOUNT_FINALIZATION_PENDING", error: "La operación todavía no se ha confirmado. Reintenta con la misma solicitud." },
  };
  const publicFailure = byStage[failure.stage] || {
    code: "ACCOUNT_OPERATION_PENDING",
    error: "La operación todavía no se ha confirmado. Reintenta con la misma solicitud.",
  };
  return { status: 503, body: { ...publicFailure, pending: true } };
}
export function validateAccountLifecycleJob(
  value: unknown,
  scope: { actor: string; requestId: string; dataPolicy: AccountDataPolicy; lease: string },
  options: { allowBusyLease?: boolean } = {},
): AccountLifecycleJob {
  const job = value as Partial<AccountLifecycleJob> | null;
  if (!job || job.request_id !== scope.requestId || job.user_id !== scope.actor || job.data_policy !== scope.dataPolicy ||
    !["requested", "data_prepared", "completed"].includes(job.stage || "") ||
    (job.stage !== "completed" && job.lease_token !== scope.lease
      && !(options.allowBusyLease === true && job.lease_token === null)) ||
    (job.stage === "completed" && (job.lease_token !== null || typeof job.completed_at !== "string" || !Number.isFinite(Date.parse(job.completed_at))))) {
    throw new Error("INVALID_LIFECYCLE_RESPONSE");
  }
  return job as AccountLifecycleJob;
}
export type AccountLifecycleStorageRehome = {
  document_id: string;
  bucket_id: string;
  name: string;
  replacement_name: string;
};

export type AccountLifecycleGateway = {
  acquire: () => Promise<AccountLifecycleJob>;
  storageRehomeBatch: (job: AccountLifecycleJob) => Promise<AccountLifecycleStorageRehome[]>;
  copyStorage: (rehome: AccountLifecycleStorageRehome) => Promise<void>;
  commitStorageRehome: (job: AccountLifecycleJob, rehome: AccountLifecycleStorageRehome) => Promise<void>;
  storageBatch: (job: AccountLifecycleJob) => Promise<Array<{ bucket_id: string; name: string }>>;
  removeStorage: (bucket: string, names: string[]) => Promise<void>;
  prepare: (job: AccountLifecycleJob) => Promise<AccountLifecycleJob>;
  reconcile: (job: AccountLifecycleJob) => Promise<AccountLifecycleJob>;
  revokeAndBan: (job: AccountLifecycleJob) => Promise<void>;
  signOut: (job: AccountLifecycleJob) => Promise<void>;
  deleteAuth: (job: AccountLifecycleJob) => Promise<void>;
  complete: (job: AccountLifecycleJob) => Promise<AccountLifecycleJob>;
  release: (job: AccountLifecycleJob) => Promise<void>;
  observeError?: (error: AccountLifecycleStageError, context: { secondary: boolean; operationCompleted: boolean }) => void;
};

/** Auth/Storage cannot join a Postgres transaction. A durable, leased saga
 * records the blocked account before external work; SQL graph preparation is
 * atomic, Auth is last, and the exact authenticated request can resume. */
export async function executeAccountLifecycle(gateway: AccountLifecycleGateway) {
  let job = await runAccountLifecycleStage("acquire", gateway.acquire);
  if (job.stage === "completed") return job;
  if (!job.lease_token) throw new AccountLifecycleStageError("acquire", { code: "ACCOUNT_OPERATION_BUSY", errorClass: "LifecycleLeaseError", status: 409 });
  let releaseJob = job;
  let primaryError: AccountLifecycleStageError | null = null;
  let operationCompleted = false;
  try {
    if (job.data_policy === "delete_golf_data" && (job.stage === "requested" || job.stage === "data_prepared")) {
      // Shared Admin documents cannot keep an Auth-owned Storage object after
      // that identity is deleted. Copy each object to its deterministic,
      // ownerless path and atomically retarget the shared row before the
      // ordinary owner manifest removes the original. Re-query offset zero so
      // a retry resumes both a completed copy and a completed DB retarget.
      for (let batch = 0; batch < 100; batch += 1) {
        const rehomes = await runAccountLifecycleStage("storageRehomeBatch", () => gateway.storageRehomeBatch(job));
        if (!rehomes.length) break;
        for (const rehome of rehomes) {
          await runAccountLifecycleStage("copyStorage", () => gateway.copyStorage(rehome));
          await runAccountLifecycleStage("commitStorageRehome", () => gateway.commitStorageRehome(job, rehome));
        }
        if (batch === 99) throw new AccountLifecycleStageError("storageRehomeBatch", { code: "ACCOUNT_STORAGE_REHOME_MORE_PENDING", errorClass: "LifecycleBatchLimitError" });
      }
      // Delete through Storage API, never storage.objects SQL. Re-query offset
      // zero after each batch so deletion cannot skip shifting object offsets.
      for (let batch = 0; batch < 100; batch += 1) {
        const objects = await runAccountLifecycleStage("storageBatch", () => gateway.storageBatch(job));
        if (!objects.length) break;
        const buckets = new Map<string, string[]>();
        for (const object of objects) buckets.set(object.bucket_id, [...(buckets.get(object.bucket_id) || []), object.name]);
        for (const [bucket, names] of buckets) await runAccountLifecycleStage("removeStorage", () => gateway.removeStorage(bucket, names));
        if (batch === 99) throw new AccountLifecycleStageError("storageBatch", { code: "ACCOUNT_STORAGE_MORE_PENDING", errorClass: "LifecycleBatchLimitError" });
      }
    }
    // prepare is deliberately idempotent and must be replayed for jobs left in
    // data_prepared so a corrected SQL graph can repair an older partial plan.
    if (job.stage === "requested" || job.stage === "data_prepared") {
      const prepared = await runAccountLifecycleStage("prepare", () => gateway.prepare(job));
      if (prepared.stage !== "data_prepared" || prepared.lease_token !== job.lease_token) {
        throw new AccountLifecycleStageError("prepare", { code: "INVALID_LIFECYCLE_RESPONSE", errorClass: "LifecycleContractError" });
      }
      job = prepared;
      releaseJob = job;
    }
    if (job.data_policy === "delete_golf_data" && job.stage === "data_prepared") {
      const reconciled = await runAccountLifecycleStage("reconcile", () => gateway.reconcile(job));
      if (reconciled.stage !== "data_prepared" || reconciled.lease_token !== job.lease_token) {
        throw new AccountLifecycleStageError("reconcile", { code: "INVALID_LIFECYCLE_RESPONSE", errorClass: "LifecycleContractError" });
      }
      job = reconciled;
      releaseJob = job;
    }
    await runAccountLifecycleStage("revokeAndBan", () => gateway.revokeAndBan(job));
    await runAccountLifecycleStage("signOut", () => gateway.signOut(job));
    if (job.data_policy === "delete_golf_data") await runAccountLifecycleStage("deleteAuth", () => gateway.deleteAuth(job));
    const completed = await runAccountLifecycleStage("complete", () => gateway.complete(job));
    if (completed.stage !== "completed" || completed.request_id !== job.request_id || completed.user_id !== job.user_id
      || completed.data_policy !== job.data_policy || completed.lease_token !== null
      || typeof completed.completed_at !== "string" || !Number.isFinite(Date.parse(completed.completed_at))) {
      throw new AccountLifecycleStageError("complete", { code: "INVALID_LIFECYCLE_COMPLETION", errorClass: "LifecycleContractError" });
    }
    operationCompleted = true;
    return completed;
  } catch (error) {
    primaryError = error instanceof AccountLifecycleStageError ? error : asAccountLifecycleStageError("complete", error);
    throw primaryError;
  } finally {
    try {
      await runAccountLifecycleStage("release", () => gateway.release(releaseJob));
    } catch (error) {
      const releaseError = error instanceof AccountLifecycleStageError ? error : asAccountLifecycleStageError("release", error);
      try { gateway.observeError?.(releaseError, { secondary: primaryError !== null, operationCompleted }); } catch { /* telemetry must never alter lifecycle semantics */ }
      // SQL complete clears the lease atomically. A later transport failure in
      // the redundant release call is observable but cannot undo completion.
      // Likewise, a release failure must never hide the primary stage failure.
      if (!primaryError && !operationCompleted) throw releaseError;
    }
  }
}
