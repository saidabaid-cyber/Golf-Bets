import { derivedGreenInRegulation } from "./advanced-stats";
import { validTotalOnly } from "./total-score-round";
import type { AdvancedHoleStat, Player, RoundSnapshot } from "./types";

export type RoundAchievementCode =
  | "PERSONAL_BEST_18H"
  | "PERSONAL_BEST_GIR_18H"
  | "BIRDIES"
  | "EAGLES_OR_BETTER"
  | "NO_THREE_PUTTS"
  | "NO_DOUBLE_BOGEYS"
  | "BOGEY_FREE"
  | "GIR_9_PLUS";

export type RoundAchievement = { code: RoundAchievementCode; count?: number };
export type RoundAchievementSummary = {
  roundId: string;
  accountUserId: string;
  playerId: string;
  holeCount: 18;
  grossScore: number;
  coursePar: number;
  scoreToPar: number;
  birdies: number;
  eaglesOrBetter: number;
  puttsTotal: number | null;
  gir: { hit: number; attempts: 18; source: "explicit" | "score_putts" | "mixed" } | null;
  previousComparableBest: number | null;
  previousComparableGirBest: number | null;
  achievements: RoundAchievement[];
};

export const ROUND_ACHIEVEMENT_LABELS: Record<RoundAchievementCode, string> = {
  PERSONAL_BEST_18H: "Mejor score personal · 18 hoyos",
  PERSONAL_BEST_GIR_18H: "Mejor GIR personal · 18 hoyos",
  BIRDIES: "Birdies",
  EAGLES_OR_BETTER: "Águilas o mejor",
  NO_THREE_PUTTS: "Sin 3 putts",
  NO_DOUBLE_BOGEYS: "Sin doble bogey",
  BOGEY_FREE: "Ronda sin bogey",
  GIR_9_PLUS: "9+ GIR · 18 hoyos",
};

export function roundAchievementLabels(summary: RoundAchievementSummary): string[] {
  return summary.achievements.map(achievement => {
    if (achievement.code === "BIRDIES") return `${achievement.count || 0} birdie${achievement.count === 1 ? "" : "s"}`;
    if (achievement.code === "EAGLES_OR_BETTER") return `${achievement.count || 0} águila${achievement.count === 1 ? "" : "s"} o mejor`;
    if (achievement.code === "GIR_9_PLUS") return `${achievement.count || 0} GIR de 18 hoyos`;
    return ROUND_ACHIEVEMENT_LABELS[achievement.code];
  });
}

type ScorecardHole = { number: number; par: number; strokeIndex: number; score: number };
type ComparableScorecard = { player: Player; holes: ScorecardHole[]; gross: number; par: number };

function validPlayedDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Strict, account-owned scorecard comparability. Names are never identity. */
function comparableScorecard(round: RoundSnapshot, accountUserId: string, holeCount: 9 | 18): ComparableScorecard | null {
  if (!accountUserId || accountUserId === "guest" || round.lifecycleState !== "completed"
    || round.roundHoles !== holeCount || !validPlayedDate(round.date)
    || !Array.isArray(round.players) || !Array.isArray(round.order)
    || round.order.length !== holeCount || !round.scores || !round.courseSnapshot) return null;
  const linked = round.players.filter(player => player && player.accountUserId === accountUserId);
  if (linked.length !== 1 || !linked[0].id?.trim()) return null;
  const player = linked[0];
  const playerIds = round.players.map(candidate => candidate?.id);
  if (playerIds.some(id => typeof id !== "string" || !id.trim()) || new Set(playerIds).size !== playerIds.length) return null;
  const order = round.order;
  if (new Set(order).size !== holeCount || order.some(hole => !Number.isInteger(hole) || hole < 1 || hole > 18)
    || (holeCount === 18 && Array.from({ length: 18 }, (_, index) => index + 1).some(hole => !order.includes(hole)))) return null;
  const definitions = round.courseSnapshot.playerHoleCards?.[player.id] ?? round.courseSnapshot.holes;
  if (!Array.isArray(definitions) || new Set(definitions.map(hole => hole?.number)).size !== definitions.length) return null;
  const byNumber = new Map(definitions.map(hole => [hole.number, hole]));
  const holes: ScorecardHole[] = [];
  for (const number of order) {
    const definition = byNumber.get(number);
    const score = round.scores[number]?.[player.id];
    if (!definition || !Number.isInteger(definition.par) || definition.par < 3 || definition.par > 6
      || !Number.isInteger(definition.strokeIndex) || definition.strokeIndex < 1 || definition.strokeIndex > 18
      || !Number.isInteger(score) || (score as number) < 1 || (score as number) > 100) return null;
    holes.push({ number, par: definition.par, strokeIndex: definition.strokeIndex, score: score as number });
  }
  return { player, holes, gross: holes.reduce((sum, hole) => sum + hole.score, 0),
    par: holes.reduce((sum, hole) => sum + hole.par, 0) };
}

function completePutts(round: RoundSnapshot, holes: readonly ScorecardHole[], playerId: string): number[] | null {
  const result: number[] = [];
  for (const hole of holes) {
    const count = round.putts?.[hole.number]?.[playerId];
    if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > hole.score) return null;
    result.push(count as number);
  }
  return result;
}

function completeGir(round: RoundSnapshot, holes: readonly ScorecardHole[], playerId: string): RoundAchievementSummary["gir"] {
  let hit = 0;
  let explicit = 0;
  let derived = 0;
  for (const hole of holes) {
    const captured = round.advancedStats?.[hole.number]?.[playerId]?.greenInRegulation;
    let value: boolean | null;
    if (typeof captured === "boolean") { value = captured; explicit += 1; }
    else {
      value = derivedGreenInRegulation(hole.score, round.putts?.[hole.number]?.[playerId], hole.par);
      if (value === null) return null;
      derived += 1;
    }
    if (value) hit += 1;
  }
  return { hit, attempts: 18, source: explicit && derived ? "mixed" : explicit ? "explicit" : "score_putts" };
}

function instant(value: unknown): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function chronologicallyBefore(prior: RoundSnapshot, current: RoundSnapshot): boolean {
  if (!validPlayedDate(prior.date) || !validPlayedDate(current.date)) return false;
  if (prior.date < current.date) return true;
  if (prior.date > current.date) return false;
  // Same-day scorecards are not ordered by updatedAt: historical corrections
  // can change it. Require durable play instants or omit the uncertain baseline.
  const priorEnd = instant(prior.completedAt);
  const currentStart = instant(current.startedAt);
  if (priorEnd !== null && currentStart !== null) return priorEnd < currentStart;
  const priorComparable = priorEnd ?? instant(prior.startedAt);
  const currentComparable = instant(current.completedAt) ?? currentStart;
  return priorComparable !== null && currentComparable !== null && priorComparable < currentComparable;
}

/** One deterministic summary/event per completed 18-hole round and account participant. */
export function deriveRoundAchievements(
  round: RoundSnapshot,
  priorRounds: readonly RoundSnapshot[],
  accountUserId: string,
): RoundAchievementSummary | null {
  const current = comparableScorecard(round, accountUserId, 18);
  if (!current) return null;
  const priorComparable = priorRounds
    .filter(prior => prior?.id !== round.id && chronologicallyBefore(prior, round))
    .map(prior => ({ prior, card: comparableScorecard(prior, accountUserId, 18) }))
    .filter((item): item is { prior: RoundSnapshot; card: ComparableScorecard } => Boolean(item.card && item.card.par === current.par));
  const previousGross = priorComparable.map(item => item.card.gross);
  const previousComparableBest = previousGross.length ? Math.min(...previousGross) : null;
  const putts = completePutts(round, current.holes, current.player.id);
  const gir = completeGir(round, current.holes, current.player.id);
  const previousGirs = priorComparable.map(item => completeGir(item.prior, item.card.holes, item.card.player.id)?.hit)
    .filter((hit): hit is number => typeof hit === "number");
  const previousComparableGirBest = previousGirs.length ? Math.max(...previousGirs) : null;
  const birdies = current.holes.filter(hole => hole.score === hole.par - 1).length;
  const eaglesOrBetter = current.holes.filter(hole => hole.score <= hole.par - 2).length;
  const achievements: RoundAchievement[] = [];
  if (previousComparableBest !== null && current.gross < previousComparableBest) achievements.push({ code: "PERSONAL_BEST_18H" });
  if (gir && previousComparableGirBest !== null && gir.hit > previousComparableGirBest) achievements.push({ code: "PERSONAL_BEST_GIR_18H" });
  if (birdies) achievements.push({ code: "BIRDIES", count: birdies });
  if (eaglesOrBetter) achievements.push({ code: "EAGLES_OR_BETTER", count: eaglesOrBetter });
  if (putts && putts.every(count => count <= 2)) achievements.push({ code: "NO_THREE_PUTTS" });
  if (current.holes.every(hole => hole.score <= hole.par + 1)) achievements.push({ code: "NO_DOUBLE_BOGEYS" });
  if (current.holes.every(hole => hole.score <= hole.par)) achievements.push({ code: "BOGEY_FREE" });
  if (gir && gir.hit >= 9) achievements.push({ code: "GIR_9_PLUS", count: gir.hit });
  return {
    roundId: round.id, accountUserId, playerId: current.player.id, holeCount: 18,
    grossScore: current.gross, coursePar: current.par, scoreToPar: current.gross - current.par,
    birdies, eaglesOrBetter, puttsTotal: putts?.reduce((sum, count) => sum + count, 0) ?? null,
    gir, previousComparableBest, previousComparableGirBest, achievements,
  };
}

const MATERIAL_ADVANCED_FIELDS = [
  "fairwayHit", "greenInRegulation", "penaltyStrokes", "teeDirection", "landingLie",
  "teeClub", "teeDistance", "firstPuttDistanceFeet", "bunkerCount", "greenSideBunkerCount",
  "fairwayBunkerCount", "penaltyAreaCount", "outOfBounds", "outOfBoundsCount",
] as const satisfies readonly (keyof AdvancedHoleStat)[];

function materialAdvanced(stat: AdvancedHoleStat | undefined) {
  if (!stat) return null;
  const entries = MATERIAL_ADVANCED_FIELDS.filter(key => stat[key] !== undefined)
    .map(key => [key, stat[key]]);
  return entries.length ? Object.fromEntries(entries) : null;
}

function withoutDisplayFields<T extends object>(item: T, excluded: readonly string[]) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !excluded.includes(key)));
}

function stableJson(value: unknown, seen = new WeakSet<object>(), depth = 0): string {
  if (depth > 20) throw new Error("Material deportivo demasiado profundo.");
  if (value === null || value === undefined) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value !== "object") return "null";
  if (seen.has(value)) throw new Error("Material deportivo circular.");
  seen.add(value);
  const encoded = Array.isArray(value)
    ? `[${value.map(item => stableJson(item, seen, depth + 1)).join(",")}]`
    : `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key], seen, depth + 1)}`).join(",")}}`;
  seen.delete(value);
  return encoded;
}

/** Canonical private material. Never return/log this payload from a social API. */
export function roundMaterialPayload(round: RoundSnapshot, accountUserId: string): string | null {
  if (validTotalOnly(round, accountUserId)) return stableJson({ schema: "total-score-material-v1", roundId: round.id, accountUserId, playedAt: round.date, roundHoles: round.roundHoles, order: round.order, courseId: round.courseSnapshot!.id, teeId: round.courseSnapshot!.catalogTeeId || null, total: round.totalScoreCapture!.grossTotal });
  const card = comparableScorecard(round, accountUserId, round.roundHoles === 9 ? 9 : 18);
  if (!card) return null;
  const players = [...round.players!].filter(player => player && typeof player.id === "string" && player.id.trim())
    .sort((a, b) => a.id.localeCompare(b.id));
  const holes = card.holes.map(hole => ({
    number: hole.number, par: hole.par, strokeIndex: hole.strokeIndex,
    players: players.map(player => ({
      playerId: player.id,
      score: round.scores?.[hole.number]?.[player.id] ?? null,
      putts: round.putts?.[hole.number]?.[player.id] ?? null,
      advanced: materialAdvanced(round.advancedStats?.[hole.number]?.[player.id]),
    })),
  }));
  const material = {
    schema: "round-material-v1", roundId: round.id, accountUserId, playedAt: round.date,
    roundHoles: round.roundHoles, order: round.order,
    course: { id: round.courseSnapshot!.id, catalogCourseId: round.courseSnapshot!.catalogCourseId || null,
      catalogTeeId: round.courseSnapshot!.catalogTeeId || null, rating: round.courseSnapshot!.rating ?? null,
      slope: round.courseSnapshot!.slope ?? null },
    players: players.map(player => ({ id: player.id, accountUserId: player.accountUserId || null,
      handicap: player.handicap, handicapIndex: player.handicapIndex ?? null,
      courseHandicap: player.courseHandicapSnapshot ? {
        index: player.courseHandicapSnapshot.index, teeId: player.courseHandicapSnapshot.teeId,
        courseRating: player.courseHandicapSnapshot.courseRating,
        slope: player.courseHandicapSnapshot.slope, courseHandicap: player.courseHandicapSnapshot.courseHandicap,
        appliedHandicap: player.courseHandicapSnapshot.appliedHandicap,
      } : null })),
    holes, result: { betResult: round.betResult, expenseTotal: round.expenseTotal, netResult: round.netResult,
      expenses: round.expenses, categoryResults: round.categoryResults,
      playerBalances: round.playerBalances || null, categoryBalances: round.categoryBalances || null,
      betConfig: round.betConfig || null,
      personalBets: round.personalBets?.map(bet => withoutDisplayFields(bet, ["rivalName"])) || null,
      supplementalBets: round.supplementalBets || null,
      manualBets: round.manualBets?.map(bet => withoutDisplayFields(bet, ["name"])) || null,
      personalResults: round.personalResults?.map(item => ({ rivalKey: item.rivalKey,
        totalMoney: item.totalMoney, componentMoney: item.componentMoney, betId: item.betId || null,
        grossOwner: item.grossOwner ?? null, grossRival: item.grossRival ?? null })) || null,
      personalOpponentResults: round.personalOpponentResults?.map(item => ({
        betId: item.betId, mode: item.mode, opponentId: item.opponentId, amount: item.amount,
        status: item.status || null, components: item.components?.map(component => ({
          key: component.key, amount: component.amount, status: component.status,
        })) || null,
      })) || null,
      unitEvents: round.unitEvents?.map(event => withoutDisplayFields(event, ["label"])) || null,
      counterBetEvents: round.counterBetEvents || null,
      counterBetKeepers: round.counterBetKeepers || null, segments: round.segments || null,
      lobaHoles: round.lobaHoles || null, ballFriendSetup: round.ballFriendSetup || null,
      personalSlidingAdjustments: round.personalSlidingAdjustments?.map(adjustment => withoutDisplayFields(adjustment, ["updatedAt"])) || null,
    },
  };
  try {
    const payload = stableJson(material);
    return payload.length <= 200_000 ? payload : null;
  } catch { return null; }
}

/** SHA-256 revision of owned scorecard/result material, independent of social cosmetics. */
export async function roundMaterialFingerprint(round: RoundSnapshot, accountUserId: string): Promise<string | null> {
  const payload = roundMaterialPayload(round, accountUserId);
  if (!payload) return null;
  if (!globalThis.crypto?.subtle) throw new Error("No se puede comprobar la revisión deportiva en este entorno.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
