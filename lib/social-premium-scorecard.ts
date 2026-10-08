import type { SocialActivityCard } from "./social-activity-contract";
import type { AdvancedStatsByHole, Course, Player, PuttsByHole } from "./types";
import type { ScoreRows } from "./score-capture";
import { recordedNumber } from "./premium-scorecard";
import { normalizeAdvancedStats } from "./advanced-stats";

/** Consume only the server's authorized author projection, never a raw shared snapshot. */
export function socialPremiumScorecard(activity: SocialActivityCard) {
  const round = activity.round;
  if (!round || round.totalOnly || !round.scorecard?.length || !activity.author.userId
    || activity.roundId !== round.roundId) return null;
  const holes = round.scorecard;
  if (holes.length !== round.holesPlayed || holes.length > 18 || new Set(holes.map(h => h.hole)).size !== holes.length
    || holes.some(h => recordedNumber(h.hole, 1, 18) === null || recordedNumber(h.par, 3, 6) === null
      || h.score !== null && recordedNumber(h.score, 1) === null)
    || !holes.some(h => h.score !== null)) return null;
  const playerId = activity.author.userId;
  const players: Player[] = [{ id: playerId, accountUserId: playerId, name: activity.author.displayName,
    // Required by the legacy Player shape; unused in this gross-only, read-only projection.
    handicap: 0 }];
  const course: Course = { id: round.roundId, name: round.courseName, teeName: round.teeName ?? "",
    holes: holes.map(h => ({ number: h.hole, par: h.par,
      // Zero is the existing unavailable SI sentinel; Premium excludes it from display.
      strokeIndex: recordedNumber(h.strokeIndex, 1, 18) ?? 0,
      ...(recordedNumber(h.yards, 1, 1500) === null ? {} : { yards: h.yards }) })) };
  const scores: ScoreRows = {}, putts: PuttsByHole = {}, stats: AdvancedStatsByHole = {};
  for (const hole of holes) {
    if (hole.score !== null) scores[hole.hole] = { [playerId]: hole.score };
    if (recordedNumber(hole.putts, 0, 50) !== null) putts[hole.hole] = { [playerId]: hole.putts! };
    if (hole.stats) stats[hole.hole] = { [playerId]: hole.stats };
  }
  return { roundId: round.roundId, course, players, ownerId: playerId, date: round.date,
    lifecycle: "completed" as const, order: holes.map(h => h.hole), scores, putts,
    advancedStats: normalizeAdvancedStats(stats) };
}
