import type { LiveRoundOperation } from "./domain";

export type RoundActivityEvent = {
  id: string;
  roundId: string;
  groupId?: string;
  actorId: string;
  type: "SCORE_RECORDED" | "HOLE_COMPLETED" | "ROUND_STARTED" | "ROUND_FINISHED" | "BIRDIE";
  hole?: number;
  playerId?: string;
  occurredAt: string;
  visibility: "ROUND" | "GROUP";
};

export function activityFromScoreOperation(operation: LiveRoundOperation, par?: number): RoundActivityEvent | null {
  if (operation.kind !== "SCORE_SET" || typeof operation.value !== "number" || !operation.playerId || !operation.hole) return null;
  return { id: `activity:${operation.id}`, roundId: operation.roundId, actorId: operation.actorId, type: par !== undefined && operation.value < par ? "BIRDIE" : "SCORE_RECORDED", hole: operation.hole, playerId: operation.playerId, occurredAt: operation.createdAt, visibility: "ROUND" };
}

/** Deduplicates retries and groups noisy score entries by player/hole. */
export function compactRoundActivity(events: readonly RoundActivityEvent[], limit = 50) {
  const seenIds = new Set<string>();
  const seenCells = new Set<string>();
  return [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).filter((event) => {
    if (seenIds.has(event.id)) return false;
    seenIds.add(event.id);
    const cell = (event.type === "SCORE_RECORDED" || event.type === "BIRDIE") ? `${event.roundId}:${event.playerId}:${event.hole}` : "";
    if (cell && seenCells.has(cell)) return false;
    if (cell) seenCells.add(cell);
    return true;
  }).slice(0, Math.max(0, Math.min(100, limit)));
}
