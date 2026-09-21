import { preserveDraftConflict } from "./account-workspace";
import { markRoundDraftCancelled } from "./round-lifecycle";
import { hasRoundProgress, readStoredJson, STORAGE_KEYS } from "./round-utils";

type RoundReplacementStorage = Pick<Storage, "getItem" | "setItem">;

/** An automatically inserted account owner alone is not a configured round.
 * Keep all real edits (course, scores, guests, bets) under the existing guard. */
export function hasRoundToPreserve(draft: Record<string, unknown>, userId: string) {
  const players = Array.isArray(draft.players) ? draft.players : [];
  const automaticOwner = players.length === 1 && players[0]?.accountUserId === userId;
  return hasRoundProgress(automaticOwner ? { ...draft, players: [{ ...players[0], name: '' }] } : draft);
}

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
