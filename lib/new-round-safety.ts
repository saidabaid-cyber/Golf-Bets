import { preserveDraftConflict } from "./account-workspace";
import { markRoundDraftCancelled } from "./round-lifecycle";
import { hasRoundProgress, readStoredJson, STORAGE_KEYS } from "./round-utils";

type RoundReplacementStorage = Pick<Storage, "getItem" | "setItem">;

/** Flushes the exact active draft and verifies a recoverable cancelled copy
 * before callers are allowed to replace the round UI with another intent. */
export function backupActiveRoundForReplacement(
  storage: RoundReplacementStorage,
  flushCurrentDraft: () => boolean,
) {
  if (!flushCurrentDraft()) return false;
  const activeDraft = readStoredJson<unknown>(storage, STORAGE_KEYS.draft, null);
  if (!hasRoundProgress(activeDraft)) return false;
  const cancelledDraft = activeDraft && typeof activeDraft === "object" && !Array.isArray(activeDraft)
    ? markRoundDraftCancelled(activeDraft as Record<string, unknown>)
    : activeDraft;
  return preserveDraftConflict(storage, cancelledDraft);
}
