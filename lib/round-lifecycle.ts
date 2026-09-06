import type { RoundLifecycleState } from "./types";

type LifecycleRecord = Record<string, unknown> & {
  lifecycleState?: unknown;
  reviewPending?: unknown;
  scores?: unknown;
};

export function isRoundLifecycleState(value: unknown): value is RoundLifecycleState {
  return value === "draft" || value === "live" || value === "completed" || value === "cancelled";
}

function hasConfirmedScore(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).some((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    return Object.values(row).some((score) => typeof score === "number" && Number.isFinite(score) && score >= 1);
  });
}

/** Derive lifecycle only from durable round facts. Temporary score edits do not
 * make a draft live until the hole itself has been confirmed in `scores`. */
export function deriveRoundLifecycleState(draft: LifecycleRecord): RoundLifecycleState {
  if (draft.lifecycleState === "cancelled") return "cancelled";
  if (draft.reviewPending === true) return "completed";
  return hasConfirmedScore(draft.scores) ? "live" : "draft";
}

export function withDerivedRoundLifecycle<T extends LifecycleRecord>(draft: T): T & { lifecycleState: RoundLifecycleState } {
  return { ...draft, lifecycleState: deriveRoundLifecycleState(draft) };
}

/** Historical snapshots predate lifecycle metadata but represent rounds that
 * were explicitly saved, so they remain completed. Explicit states are kept. */
export function normalizeHistoricalRoundLifecycle<T extends LifecycleRecord>(round: T): T & { lifecycleState: RoundLifecycleState } {
  return { ...round, lifecycleState: isRoundLifecycleState(round.lifecycleState) ? round.lifecycleState : "completed" };
}

/** Preserve an intentionally replaced active round as a recoverable cancelled
 * draft. The caller still verifies the backup before clearing the active slot. */
export function markRoundDraftCancelled<T extends LifecycleRecord>(draft: T, cancelledAt = new Date().toISOString()) {
  return { ...draft, lifecycleState: "cancelled" as const, cancelledAt };
}
