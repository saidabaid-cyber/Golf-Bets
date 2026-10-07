import { buildHistoricalRoundRecap } from "./historical-round-recap";
import { personalRoundPerspective } from "./participant-history";
import type { SocialRoundCard, SocialScoreHole } from "./social-activity-contract";
import type { RoundSnapshot, RoundShotSnapshot } from "./types";

export const SCORE_RESULTS = ["eagle", "birdie", "par", "bogey", "double"] as const;
export type ScoreResult = typeof SCORE_RESULTS[number] | "missing";
export function scoreResult(score: number | null, par: number): ScoreResult {
  if (!Number.isInteger(score) || score === null || score < 1 || !Number.isInteger(par) || par < 3 || par > 6) return "missing";
  const difference = score - par;
  return difference <= -2 ? "eagle" : difference === -1 ? "birdie" : difference === 0 ? "par" : difference === 1 ? "bogey" : "double";
}
export const scoreResultLabel: Record<ScoreResult, string> = { eagle: "Eagle o mejor", birdie: "Birdie", par: "Par", bogey: "Bogey", double: "Doble bogey o más", missing: "Sin score" };
export function againstPar(value: number) { return value === 0 ? "E" : `${value > 0 ? "+" : ""}${value}`; }
export function scorecardTotals(holes: readonly SocialScoreHole[]) {
  const scores = holes.map(h => h.score), putts = holes.map(h => h.putts);
  const complete = holes.length > 0 && scores.every((s,i) => scoreResult(s,holes[i].par) !== "missing");
  const par = holes.reduce((n,h) => n + h.par, 0);
  const score = complete ? scores.reduce<number>((n,s) => n + s!, 0) : null;
  return { par, score, toPar: score === null ? null : score - par, putts: putts.length && putts.every(p => Number.isInteger(p) && p! >= 0) ? putts.reduce<number>((n,p) => n + p!, 0) : null };
}
export type GolfRoundDetail = { card: SocialRoundCard; playerId?: string; playerName?: string; shots: RoundShotSnapshot[] };
/** Local private history stays in the app. It is never sent through the social reader. */
export function historyGolfDetail(snapshot: RoundSnapshot): GolfRoundDetail | null {
  const round = personalRoundPerspective(snapshot);
  if (!round) return null;
  const recap = buildHistoricalRoundRecap(round), id = recap.meta.ownerId;
  const player = recap.golf?.leaderboard.find(p => p.playerId === id);
  const definitions = round.courseSnapshot?.playerHoleCards?.[id || ""];
  const holes: SocialScoreHole[] = (recap.golf?.scorecard || []).map(h => {
    const definition = definitions?.find(d => d.number === h.number), stat = round.advancedStats?.[h.number]?.[id || ""], putts = round.putts?.[h.number]?.[id || ""];
    return { hole: h.number, par: definition?.par ?? h.par, score: h.players.find(p => p.playerId === id)?.score ?? null,
      ...(Number.isInteger(putts) && putts! >= 0 && putts! <= 20 ? { putts: putts! } : {}),
      ...(Number.isFinite(definition?.yards ?? h.yards) ? { yards: definition?.yards ?? h.yards } : {}),
      ...(typeof stat?.fairwayHit === "boolean" && h.par > 3 ? { fairwayHit: stat.fairwayHit } : {}),
      ...(typeof stat?.greenInRegulation === "boolean" ? { greenInRegulation: stat.greenInRegulation } : {}),
      ...(Number.isInteger(stat?.penaltyStrokes) && stat!.penaltyStrokes! >= 0 ? { penaltyStrokes: stat!.penaltyStrokes } : {}),
    };
  });
  const totals = scorecardTotals(holes), fairways = holes.filter(h => h.par > 3), completeGreens = holes.length && holes.every(h => typeof h.greenInRegulation === "boolean"), completeFairways = fairways.length && fairways.every(h => typeof h.fairwayHit === "boolean");
  const totalOnly = round.totalScoreCapture && !round.totalScoreCapture.holesCompletedAt;
  return { card: { roundId: round.cloudRoundId || round.id, localRoundId: round.id, date: round.date,
    courseName: round.courseName, teeName: round.teeName || null, holesPlayed: round.roundHoles || recap.meta.holeCount || holes.length,
    ownerScore: totalOnly ? round.totalScoreCapture!.grossTotal : player?.gross ?? totals.score,
    coursePar: holes.length ? totals.par : null, ...(totalOnly ? { totalOnly: true } : {}),
    ...(!totalOnly && totals.toPar !== null ? { toPar: totals.toPar } : {}),
    ...(totals.putts !== null ? { putts: totals.putts } : {}),
    ...(completeGreens ? { girPct: Math.round(holes.filter(h => h.greenInRegulation).length / holes.length * 100) } : {}),
    ...(completeFairways ? { firPct: Math.round(fairways.filter(h => h.fairwayHit).length / fairways.length * 100) } : {}),
    ...(holes.length ? { scorecard: holes } : {}),
  }, playerId: id, playerName: player?.name || round.ownerName,
  shots: (round.shots || []).filter(s => s.playerId === id && s.roundId === (round.cloudSourceLocalId || round.id) && Number.isInteger(s.hole) && s.hole >= 1 && s.hole <= 18) };
}
