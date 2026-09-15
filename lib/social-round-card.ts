import type { SocialRoundCard } from "./social-activity-contract";
import type { RoundSnapshot } from "./types";

export type SocialRoundSource = { id: string; local_round_id: string; snapshot: RoundSnapshot };

/** Minimal author-only projection; never return other players or betting facts. */
export function safeSocialRoundCard(
  source: SocialRoundSource, accountUserId: string, includeScorecard: boolean,
  includeCourseIdentity = true,
): SocialRoundCard | null {
  const round = source.snapshot;
  if (!round || round.lifecycleState !== "completed" || round.id !== source.local_round_id
    || !Array.isArray(round.players) || !Array.isArray(round.order)
    || !round.courseSnapshot?.holes || !round.scores) return null;
  const linked = round.players.filter(player => player?.accountUserId === accountUserId);
  if (linked.length !== 1 || !linked[0]?.id) return null;
  const playerId = linked[0].id;
  const definitions = new Map(round.courseSnapshot.holes.map(hole => [hole.number, hole]));
  const holes: Array<{ hole: number; par: number; score: number }> = [];
  for (const number of round.order) {
    const definition = definitions.get(number);
    const score = round.scores[number]?.[playerId];
    if (!definition || !Number.isInteger(definition.par) || definition.par < 3 || definition.par > 6
      || !Number.isInteger(score) || (score as number) < 1 || (score as number) > 100) return null;
    holes.push({ hole: number, par: definition.par, score: score as number });
  }
  return {
    roundId: source.id, localRoundId: source.local_round_id, date: round.date,
    courseName: includeCourseIdentity ? round.courseName || "Campo no indicado" : "Campo privado",
    teeName: includeCourseIdentity ? round.teeName || null : null,
    holesPlayed: holes.length, ownerScore: holes.reduce((sum, hole) => sum + hole.score, 0),
    coursePar: holes.reduce((sum, hole) => sum + hole.par, 0),
    ...(includeScorecard ? { scorecard: holes } : {}),
  };
}
