type DeletionMarkerStorage = Pick<Storage, "setItem" | "removeItem">;

export type AccountDeletionDataPolicy = "delete_golf_data" | "retain_history";
export type AccountDeletionIntent = { dataPolicy: AccountDeletionDataPolicy; requestId: string; recoveryToken?: string };
const REQUEST_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function accountDeletionIntentKey(userId: string) {
  return `backyard-account-deletion-intent-v1:${userId}`;
}

export function readAccountDeletionIntent(storage: Pick<Storage, "getItem">, userId: string): AccountDeletionIntent | null {
  if (!userId || userId === "guest") return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(accountDeletionIntentKey(userId)) || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (source.userId !== userId || (source.version !== 1 && source.version !== 2) ||
      (source.dataPolicy !== "delete_golf_data" && source.dataPolicy !== "retain_history") ||
      typeof source.requestId !== "string" || !REQUEST_UUID_V4.test(source.requestId)) return null;
    if (source.version === 2 && (typeof source.recoveryToken !== "string" || !/^[a-f0-9]{64}$/.test(source.recoveryToken))) return null;
    return { dataPolicy: source.dataPolicy, requestId: source.requestId,
      ...(source.version === 2 ? { recoveryToken: source.recoveryToken as string } : {}) };
  } catch { return null; }
}

/** Choice and idempotency key must be durable BEFORE the deletion marker and
 * network call; a reload can then retry the exact request without inventing a
 * policy for a legacy marker. The recovery secret authorizes ONLY resuming this
 * already-confirmed server operation, not login, another account or golf data. */
export function persistAccountDeletionIntent(storage: Pick<Storage, "getItem" | "setItem">, userId: string, intent: AccountDeletionIntent) {
  if (!userId || userId === "guest" ||
    !["delete_golf_data", "retain_history"].includes(intent.dataPolicy) || !REQUEST_UUID_V4.test(intent.requestId)
    || (intent.recoveryToken !== undefined && !/^[a-f0-9]{64}$/.test(intent.recoveryToken))) {
    throw new Error("La elección de eliminación de cuenta no es válida.");
  }
  storage.setItem(accountDeletionIntentKey(userId), JSON.stringify({ version: intent.recoveryToken ? 2 : 1, userId, ...intent }));
  if (JSON.stringify(readAccountDeletionIntent(storage, userId)) !== JSON.stringify(intent)) {
    throw new Error("No pudimos guardar la elección de eliminación en este dispositivo.");
  }
  return intent;
}

export function prepareAccountDeletionIntent(storage: Pick<Storage, "getItem" | "setItem">, userId: string, dataPolicy: AccountDeletionDataPolicy, requestId: string): AccountDeletionIntent {
  const existing = readAccountDeletionIntent(storage, userId);
  if (existing) {
    if (existing.dataPolicy !== dataPolicy) throw new Error("Reanuda la solicitud de cierre anterior antes de crear otra.");
    return existing;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const recoveryToken = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  return persistAccountDeletionIntent(storage, userId, { dataPolicy, requestId, recoveryToken });
}

export function accountDeletionRequestBody(intent: AccountDeletionIntent) {
  return { confirmation: "ELIMINAR", dataPolicy: intent.dataPolicy, requestId: intent.requestId,
    ...(intent.recoveryToken ? { recoveryToken: intent.recoveryToken } : {}) };
}

export function accountDeletionResponseConfirmed(body: unknown, policy: AccountDeletionDataPolicy) {
  if (!body || typeof body !== "object") return false;
  const result = body as Record<string, unknown>;
  return result.ok === true && (policy === "retain_history"
    ? result.archived === true && result.deleted === false && result.accountStatus === "archived"
    : result.deleted === true && result.archived === false && result.accountStatus === "deleted");
}

export function accountDeletionPrewriteRejected(status: number, result: { code?: string; noDataDeleted?: boolean } | null) {
  return status === 503 && result?.noDataDeleted === true
    && ["CONTROLLED_DB_ACTION_REQUIRED", "PENDING_CONTROLLED_DB_APPLY", "LEGAL_REVIEW_REQUIRED", "account_deletion_controlled_apply_pending"].includes(result.code || "");
}

export function clearAccountDeletionIntent(storage: Pick<Storage, "removeItem">, userId: string) {
  if (userId && userId !== "guest") storage.removeItem(accountDeletionIntentKey(userId));
}

/** Only a marker written after a confirmed server response may resume purge. */
export function accountDeletionRecoveryAction(markerState: string): "wait" | "purge" | "normalize_pending" {
  if (markerState === "completed" || markerState === "pending_confirmation") return "wait";
  if (markerState === "completed_cleanup_pending") return "purge";
  return "normalize_pending";
}

/** Local data is deleted only after an HTTP success from the deletion route.
 * An unknown/5xx result keeps the sync barrier but never runs local cleanup. */
export async function settleAccountDeletionClient(
  storage: DeletionMarkerStorage,
  markerKey: string,
  responseStatus: number | null,
  serverDeletionConfirmed: boolean,
  finishAccountDeletion: () => Promise<boolean>,
): Promise<"confirmed" | "pending_confirmation" | "rejected"> {
  const confirmedHttpSuccess = serverDeletionConfirmed && responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
  if (!confirmedHttpSuccess) {
    // Expired Auth or a conflicting in-progress job can follow partial server
    // work. Neither is proof that the original operation never started.
    if (responseStatus === null || ![400, 403, 413, 415].includes(responseStatus)) {
      storage.setItem(markerKey, "pending_confirmation");
      return "pending_confirmation";
    }
    storage.removeItem(markerKey);
    return "rejected";
  }

  // Durable proof must precede the first destructive local cleanup step. A
  // tab closed during cleanup can then resume without guessing server state.
  storage.setItem(markerKey, "completed_cleanup_pending");
  let locallyComplete = false;
  try {
    locallyComplete = await finishAccountDeletion();
  } finally {
    storage.setItem(markerKey, locallyComplete ? "completed" : "completed_cleanup_pending");
  }
  return "confirmed";
}
