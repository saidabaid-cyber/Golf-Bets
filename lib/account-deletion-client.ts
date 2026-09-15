type DeletionMarkerStorage = Pick<Storage, "setItem" | "removeItem">;

export type AccountDeletionDataPolicy = "delete_golf_data" | "retain_history";
export type AccountDeletionIntent = { dataPolicy: AccountDeletionDataPolicy; requestId: string };
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
    if (source.userId !== userId || source.version !== 1 ||
      (source.dataPolicy !== "delete_golf_data" && source.dataPolicy !== "retain_history") ||
      typeof source.requestId !== "string" || !REQUEST_UUID_V4.test(source.requestId)) return null;
    return { dataPolicy: source.dataPolicy, requestId: source.requestId };
  } catch { return null; }
}

/** Choice and idempotency key must be durable BEFORE the deletion marker and
 * network call; a reload can then retry the exact request without inventing a
 * policy for a legacy marker. This contains no bearer token or golf data. */
export function persistAccountDeletionIntent(storage: Pick<Storage, "getItem" | "setItem">, userId: string, intent: AccountDeletionIntent) {
  if (!userId || userId === "guest" ||
    !["delete_golf_data", "retain_history"].includes(intent.dataPolicy) || !REQUEST_UUID_V4.test(intent.requestId)) {
    throw new Error("La elección de eliminación de cuenta no es válida.");
  }
  storage.setItem(accountDeletionIntentKey(userId), JSON.stringify({ version: 1, userId, ...intent }));
  if (JSON.stringify(readAccountDeletionIntent(storage, userId)) !== JSON.stringify(intent)) {
    throw new Error("No pudimos guardar la elección de eliminación en este dispositivo.");
  }
  return intent;
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
    if (responseStatus === null || responseStatus >= 500) {
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
