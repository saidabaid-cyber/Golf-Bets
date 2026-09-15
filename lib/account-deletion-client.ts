type DeletionMarkerStorage = Pick<Storage, "setItem" | "removeItem">;

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
