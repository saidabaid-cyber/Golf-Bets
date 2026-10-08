import type { SocialRoundCard } from "./social-activity-contract";
import type { RoundSnapshot } from "./types";
import { validTotalOnly } from "./total-score-round";
import { capturedSocialStats } from "./social-feed-presentation";
import { normalizeAdvancedStats } from "./advanced-stats";
import { recordedNumber } from "./premium-scorecard";

export type SocialRoundSource = { id: string; local_round_id: string; snapshot: RoundSnapshot };

/** Minimal author-only projection; never return other players or betting facts. */
export function safeSocialRoundCard(
  source: SocialRoundSource, accountUserId: string, includeScorecard: boolean,
  includeCourseIdentity = true,
): SocialRoundCard | null {
  const round = source.snapshot;
  if (round?.id === source.local_round_id && validTotalOnly(round, accountUserId)) return {
    roundId: source.id, localRoundId: source.local_round_id, date: round.date,
    courseName: includeCourseIdentity ? round.courseName : "Campo privado",
    teeName: includeCourseIdentity ? round.teeName : null,
    holesPlayed: round.roundHoles!, ownerScore: round.totalScoreCapture!.grossTotal, coursePar: null, totalOnly: true,
  };
  if (!round || round.lifecycleState !== "completed" || round.id !== source.local_round_id
    || !Array.isArray(round.players) || !Array.isArray(round.order)
    || !round.courseSnapshot?.holes || !round.scores) return null;
  const linked = round.players.filter(player => player?.accountUserId === accountUserId);
  if (linked.length !== 1 || !linked[0]?.id) return null;
  const playerId = linked[0].id;
  const definitions = new Map((round.courseSnapshot.playerHoleCards?.[playerId] ?? round.courseSnapshot.holes).map(hole => [hole.number, hole]));
  const holes: Array<NonNullable<SocialRoundCard["scorecard"]>[number] & { score: number }> = [];
  const advanced = includeScorecard ? normalizeAdvancedStats(round.advancedStats) : {};
  for (const number of round.order) {
    const definition = definitions.get(number);
    const score = round.scores[number]?.[playerId];
    if (!definition || !Number.isInteger(definition.par) || definition.par < 3 || definition.par > 6
      || !Number.isInteger(score) || (score as number) < 1 || (score as number) > 100) return null;
    const putts = recordedNumber(round.putts?.[number]?.[playerId], 0, 50);
    const stats = advanced[number]?.[playerId];
    holes.push({ hole: number, par: definition.par, score: score as number,
      ...(includeScorecard && includeCourseIdentity && recordedNumber(definition.yards, 1, 1500) !== null ? { yards: definition.yards } : {}),
      ...(includeScorecard && includeCourseIdentity && recordedNumber(definition.strokeIndex, 1, 18) !== null ? { strokeIndex: definition.strokeIndex } : {}),
      ...(includeScorecard && putts !== null ? { putts } : {}),
      ...(includeScorecard && stats && Object.keys(stats).length ? { stats } : {}),
    });
  }
  return {
    roundId: source.id, localRoundId: source.local_round_id, date: round.date,
    courseName: includeCourseIdentity ? round.courseName || "Campo no indicado" : "Campo privado",
    teeName: includeCourseIdentity ? round.playerTeeAssignments?.find(t=>t.playerId===playerId)?.teeName || round.teeName || null : null,
    holesPlayed: holes.length, ownerScore: holes.reduce((sum, hole) => sum + hole.score, 0),
    coursePar: holes.reduce((sum, hole) => sum + hole.par, 0),
    toPar:holes.reduce((sum,hole)=>sum+hole.score-hole.par,0),...capturedSocialStats(round,accountUserId),
    ...(includeScorecard ? { scorecard: holes } : {}),
  };
}
