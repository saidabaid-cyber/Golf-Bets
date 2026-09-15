import { deriveRoundLifecycleState } from "./round-lifecycle";

export const ROUND_CAPTURE_STAGES = ["score", "tee", "approach", "around", "summary"] as const;
export type RoundCaptureStage = typeof ROUND_CAPTURE_STAGES[number];
export type RoundResumeContext = { roundId: string; playerId: string; stage: RoundCaptureStage; currentIndex: number };

export function roundResumeStorageKey(userId: string) {
  return `backyard-round-resume-v1:${userId}`;
}

export function normalizeRoundResumeContext(value: unknown, roundId: string, playerIds: readonly string[], ownerId: string, holeCount: number): RoundResumeContext {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sameRound = source.roundId === roundId;
  return {
    roundId,
    playerId: sameRound && typeof source.playerId === "string" && playerIds.includes(source.playerId)
      ? source.playerId : playerIds.includes(ownerId) ? ownerId : playerIds[0] || "",
    stage: sameRound && ROUND_CAPTURE_STAGES.includes(source.stage as RoundCaptureStage) ? source.stage as RoundCaptureStage : "score",
    currentIndex: sameRound && Number.isInteger(source.currentIndex)
      ? Math.max(0, Math.min(Math.max(0, holeCount - 1), source.currentIndex as number)) : 0,
  };
}

export function readRoundResumeContext(storage: Pick<Storage, "getItem">, userId: string, roundId: string): unknown {
  try {
    const value = JSON.parse(storage.getItem(roundResumeStorageKey(userId)) || "null");
    return value?.roundId === roundId ? value : null;
  } catch { return null; }
}

export function persistRoundResumeContext(storage: Pick<Storage, "setItem">, userId: string, context: RoundResumeContext) {
  if (!userId || !context.roundId) return false;
  try { storage.setItem(roundResumeStorageKey(userId), JSON.stringify(context)); return true; }
  catch { return false; }
}

/** Navigation-only context never makes a round active. The authoritative draft
 * belongs to the hydrated account workspace and has a durable start or scores.
 * History, abandoned setup, review, completion and another owner are excluded. */
export function canResumeActiveRound(input: {
  userId: string;
  workspaceOwnerId: string | null;
  hydrated: boolean;
  closed: boolean;
  draftAvailable: boolean;
  draft: { roundId: string; startedAt?: string | null; reviewPending?: boolean; lifecycleState?: string; courseSelected: boolean; ownerId: string; players: readonly { id: string }[]; scores: unknown };
  history: readonly { id: string }[];
}) {
  const { draft } = input;
  if (!input.hydrated || !input.userId || input.workspaceOwnerId !== input.userId || input.closed || !input.draftAvailable) return false;
  if (!draft.roundId || !draft.courseSelected || draft.reviewPending || draft.lifecycleState === "completed" || draft.lifecycleState === "cancelled") return false;
  if (input.history.some(round => round.id === draft.roundId)) return false;
  if (!draft.players.length || draft.players.length > 5 || !draft.players.some(player => player.id === draft.ownerId)) return false;
  if (new Set(draft.players.map(player => player.id)).size !== draft.players.length) return false;
  return deriveRoundLifecycleState({ ...draft }) === "live";
}
