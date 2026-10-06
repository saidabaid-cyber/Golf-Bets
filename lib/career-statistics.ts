import { deduplicateRoundSnapshots } from "./balance-ledger";
import { attributableHistory, personalRoundPerspective } from "./participant-history";
import type { GolfInsights, ScoredRoundInsight } from "./golf-insights";
import type { RoundSnapshot } from "./types";
import { validTotalOnly } from "./total-score-round";

export type CareerScoreSample = Pick<ScoredRoundInsight,"id" | "date" | "holeCount" | "gross" | "courseName" | "teeName"> & { occurredAt?: string; relativeToPar?: number; source?: "card" | "declared" };
type CareerDatedRound = { id: string; date: string; occurredAt?: string; completedAt?: string; startedAt?: string };
/** Same-day rounds use their played/closed time; later corrections do not reorder history. */
export function careerNewestFirst(a: CareerDatedRound, b: CareerDatedRound) {
  const instant = (row: CareerDatedRound) => {
    const value = row.occurredAt || row.completedAt || row.startedAt;
    return value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  };
  return b.date.localeCompare(a.date) || instant(b) - instant(a) || b.id.localeCompare(a.id);
}
export function careerScoreSamples(rounds: readonly RoundSnapshot[], insights: GolfInsights, userId: string): CareerScoreSample[] {
  const rows: CareerScoreSample[] = insights.recentRounds.map(r => ({ ...r, source:"card" }));
  const seen = new Set(rows.map(r => r.id));
  for (const round of ownCareerHistory(rounds,userId)) {
    if (seen.has(round.id) || !validTotalOnly(round,userId) || !/^\d{4}-\d{2}-\d{2}$/.test(round.date)
      || !Number.isFinite(Date.parse(round.date)) || new Date(round.date).toISOString().slice(0,10) !== round.date) continue;
    rows.push({id:round.id,date:round.date,occurredAt:round.completedAt,holeCount:round.roundHoles!,gross:round.totalScoreCapture!.grossTotal,courseName:round.courseName,teeName:round.teeName,source:"declared"});
  }
  return rows.sort(careerNewestFirst);
}

export const careerNumber = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("es-MX", { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const careerDate = (date: string) => {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Fecha no disponible";
};
export const scoreToPar = (value: number | undefined) => value === undefined ? "—" : value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
export function ownCareerHistory(rounds: readonly RoundSnapshot[], userId: string) {
  return deduplicateRoundSnapshots(attributableHistory(rounds, userId)).flatMap(round => {
    const perspective = personalRoundPerspective(round);
    if (!perspective) return [];
    const linked = round.players?.filter(p => p.accountUserId === userId) ?? [];
    if (round.players?.some(p => p.accountUserId) && (linked.length !== 1 || linked[0].id !== perspective.ownerId)) return [];
    return [perspective];
  });
}
const mean = (rows: readonly CareerScoreSample[]) => rows.length ? rows.reduce((sum, row) => sum + row.gross, 0) / rows.length : undefined;
/** Recent five versus the preceding five; never mixes 9 and 18 holes. */
export function careerTrend(rows: readonly CareerScoreSample[]) {
  const sorted = [...rows].sort(careerNewestFirst);
  if (sorted.length < 4 || new Set(sorted.map(r => r.holeCount)).size !== 1) return undefined;
  const size = Math.min(5, Math.floor(sorted.length / 2));
  return mean(sorted.slice(0, size))! - mean(sorted.slice(size, size * 2))!;
}
export function careerSeason(rows: readonly CareerScoreSample[], year: number, holes: 9 | 18) {
  const current = rows.filter(r => r.holeCount === holes && r.date.startsWith(`${year}-`));
  const previous = rows.filter(r => r.holeCount === holes && r.date.startsWith(`${year - 1}-`));
  const months = Array.from({ length: 12 }, (_, month) => {
    const sample = current.filter(r => Number(r.date.slice(5, 7)) === month + 1);
    return { month: month + 1, rounds: sample.length, average: mean(sample) };
  });
  return { rounds: current.length, average: mean(current), best: current.length ? Math.min(...current.map(r => r.gross)) : undefined,
    evolution: current.length && previous.length ? mean(current)! - mean(previous)! : undefined,
    trend: careerTrend(current), months };
}
export function careerDistribution(rows: readonly CareerScoreSample[], holes: 9 | 18) {
  const edges = holes === 18 ? [70, 75, 80, 85, 90] : [35, 40, 45, 50, 55];
  return Array.from({ length: 6 }, (_, i) => ({ label: i === 0 ? `<${edges[0]}` : i === 5 ? `${edges[4]}+` : `${edges[i - 1]}–${edges[i] - 1}`,
    count: rows.filter(r => r.holeCount === holes && (i === 0 || r.gross >= edges[i - 1]) && (i === 5 || r.gross < edges[i])).length }));
}
/** Precision only uses explicit captures, never GIR inferred from score and putts. */
export function careerPrecision(rounds: readonly RoundSnapshot[], insights: GolfInsights, userId: string) {
  const eligible = new Set(insights.recentRounds.map(r => r.id));
  let fairways = 0, fairwayAttempts = 0, greens = 0, greenAttempts = 0, putts = 0, puttHoles = 0, yards = 0, distanceHoles = 0;
  for (const round of ownCareerHistory(rounds, userId)) {
    if (!eligible.has(round.id) || !round.ownerId) continue;
    const definitions = round.courseSnapshot?.playerHoleCards?.[round.ownerId] ?? round.courseSnapshot?.holes;
    for (const hole of round.order ?? []) {
      const fact = round.advancedStats?.[hole]?.[round.ownerId];
      if (typeof fact?.fairwayHit === "boolean" && (definitions?.find(h => h.number === hole)?.par ?? 0) > 3) { fairwayAttempts++; fairways += Number(fact.fairwayHit); }
      if (typeof fact?.greenInRegulation === "boolean") { greenAttempts++; greens += Number(fact.greenInRegulation); }
      const count = round.putts?.[hole]?.[round.ownerId];
      if (typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 20) { putts += count; puttHoles++; }
      if (typeof fact?.teeDistance === "number" && Number.isFinite(fact.teeDistance) && fact.teeDistance > 0 && fact.teeDistance < 700) { yards += fact.teeDistance; distanceHoles++; }
    }
  }
  return { fairways: fairwayAttempts ? fairways / fairwayAttempts * 100 : undefined, fairwayAttempts,
    gir: greenAttempts ? greens / greenAttempts * 100 : undefined, greenAttempts,
    putts: puttHoles ? putts / puttHoles : undefined, puttHoles, distance: distanceHoles ? yards / distanceHoles : undefined, distanceHoles };
}
