import { deduplicateRoundSnapshots } from "./balance-ledger";
import {
  buildHistoricalRoundRecap,
  type HistoricalRoundRecap,
} from "./historical-round-recap";
import type { Expense, FrequentGroup, RoundSnapshot } from "./types";

const STRUCTURAL_GOLF_ISSUES: ReadonlySet<string> = new Set([
  "invalid_snapshot",
  "invalid_geometry",
  "invalid_course",
  "invalid_players",
  "invalid_scores",
] as const);
const FINANCIAL_EPSILON = 1e-9;
const EXPENSE_KEYS = ["caddie", "food", "drinks", "greenFee", "cartRental", "other"] as const;

export type ScoredRoundInsight = {
  id: string;
  date: string;
  occurredAt: string;
  courseName: string;
  teeName: string;
  gross: number;
  net: number | null;
  relativeToPar: number;
  pars: number;
  birdies: number;
  eaglesOrBetter: number;
  bogeys: number;
  doublesOrWorse: number;
  putts: number | null;
  fairwaysHit: number;
  fairwayAttempts: number;
  greensInRegulation: number;
  greenAttempts: number;
  penaltyStrokes: number;
  advancedHoles: number;
  /** Omitted when the persisted owner result is absent or fails validation. */
  betResult?: number;
  holeCount: 9 | 18;
};

export type ScoreCohortInsight = {
  holeCount: 9 | 18;
  rounds: number;
  averageScore?: number;
  bestScore?: number;
  averageNet?: number;
  bestNet?: number;
  netRounds: number;
  averageVsPar?: number;
  bestVsPar?: number;
  last5Average?: number;
  last10Average?: number;
  recentRounds: ScoredRoundInsight[];
};

export type GolfInsightsQuality = {
  inputSnapshots: number;
  uniqueSnapshots: number;
  duplicateSnapshots: number;
  nonFinalRounds: number;
  invalidRounds: number;
  incompleteRounds: number;
  unresolvedOwnerRounds: number;
};

export type GolfInsights = {
  /** Canonical, completed rounds with a valid id, date and course name. */
  rounds: number;
  scoredRounds: number;
  scoredRounds9: number;
  scoredRounds18: number;
  scoreSampleRounds: number;
  scoreScopeHoles?: 9 | 18;
  averageScore?: number;
  bestScore?: number;
  averageNet?: number;
  bestNet?: number;
  netRounds: number;
  averageVsPar?: number;
  bestVsPar?: number;
  last5Average?: number;
  last10Average?: number;
  pars: number;
  birdies: number;
  eaglesOrBetter: number;
  bogeys: number;
  doublesOrWorse: number;
  averagePutts?: number;
  puttRounds: number;
  advancedRounds: number;
  fairwaysHit: number;
  fairwayAttempts: number;
  greensInRegulation: number;
  greenAttempts: number;
  penaltyStrokes: number;
  coursesPlayed: number;
  /** Omitted instead of pretending that an unavailable balance is zero. */
  betBalance?: number;
  betRounds: number;
  expenseTotal?: number;
  expenseRounds: number;
  netResult?: number;
  netResultRounds: number;
  expenseBreakdown?: Expense;
  categoryTotals: Record<string, number>;
  recentRounds: ScoredRoundInsight[];
  scoreCohorts: Partial<Record<9 | 18, ScoreCohortInsight>>;
  quality: GolfInsightsQuality;
};

export type PersonalActivity = {
  id: string;
  kind: "round" | "group";
  title: string;
  detail: string;
  occurredAt: string;
  roundId?: string;
  groupId?: string;
};

type CanonicalRound = {
  round: RoundSnapshot;
  recap: HistoricalRoundRecap;
  occurredAt: string;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonblank(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validInstant(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function playedTimestamp(round: RoundSnapshot, date: string) {
  // Corrections (`updatedAt`) must not turn an old round into recent activity.
  return validInstant(round.completedAt) || `${date}T12:00:00-06:00`;
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : undefined;
}

function compareNewest(left: { occurredAt: string }, right: { occurredAt: string }) {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    || right.occurredAt.localeCompare(left.occurredAt);
}

function hasStructuralGolfIssue(recap: HistoricalRoundRecap) {
  return recap.issues.some((issue) => STRUCTURAL_GOLF_ISSUES.has(issue.code));
}

function ownerPlayer(recap: HistoricalRoundRecap) {
  const leaderboard = recap.golf?.leaderboard || [];
  if (recap.meta.ownerId) {
    const byId = leaderboard.filter((player) => player.playerId === recap.meta.ownerId);
    return byId.length === 1 ? byId[0] : undefined;
  }
  if (recap.meta.ownerName) {
    const byName = leaderboard.filter((player) => player.name === recap.meta.ownerName);
    if (byName.length === 1) return byName[0];
  }
  return leaderboard.length === 1 ? leaderboard[0] : undefined;
}

function trustedBetResult(recap: HistoricalRoundRecap) {
  const value = recap.financials?.betResult;
  return finiteNumber(value) ? value : undefined;
}

function insightFromRecap(round: RoundSnapshot, recap: HistoricalRoundRecap): ScoredRoundInsight | null {
  const id = recap.meta.roundId;
  const date = recap.meta.date;
  const courseName = recap.meta.courseName;
  const golf = recap.golf;
  if (recap.meta.lifecycleState !== "completed"
    || !id
    || !validDate(date)
    || !courseName
    || !golf
    || golf.status !== "complete"
    || hasStructuralGolfIssue(recap)) return null;

  const owner = ownerPlayer(recap);
  if (!owner || !owner.finished || owner.gross === undefined || owner.grossRelativeToPar === undefined) return null;
  const stats = recap.playerStats?.find((candidate) => candidate.playerId === owner.playerId);
  const scoring = stats?.scoring;
  if (!scoring || scoring.scoredHoles !== golf.holeCount) return null;
  const advanced = stats?.advanced;
  const betResult = trustedBetResult(recap);

  return {
    id,
    date,
    occurredAt: playedTimestamp(round, date),
    courseName,
    teeName: recap.meta.teeName || "",
    gross: owner.gross,
    net: owner.net ?? null,
    relativeToPar: owner.grossRelativeToPar,
    pars: scoring.pars,
    birdies: scoring.birdies,
    eaglesOrBetter: scoring.eaglesOrBetter,
    bogeys: scoring.bogeys,
    doublesOrWorse: scoring.doublesPlus,
    putts: stats?.putts?.capturedHoles === golf.holeCount ? stats.putts.total : null,
    fairwaysHit: advanced?.fairways?.hit || 0,
    fairwayAttempts: advanced?.fairways?.attempts || 0,
    greensInRegulation: advanced?.greensInRegulation?.hit || 0,
    greenAttempts: advanced?.greensInRegulation?.attempts || 0,
    penaltyStrokes: advanced?.penalties?.strokes || 0,
    advancedHoles: advanced?.capturedHoles || 0,
    ...(betResult === undefined ? {} : { betResult }),
    holeCount: golf.holeCount,
  };
}

function canonicalRounds(rounds: readonly RoundSnapshot[]) {
  const runtimeRounds = Array.isArray(rounds)
    ? rounds.filter((round): round is RoundSnapshot => Boolean(round) && typeof round === "object" && !Array.isArray(round))
    : [];
  const unique = deduplicateRoundSnapshots(runtimeRounds);
  const records: CanonicalRound[] = [];
  let nonFinalRounds = 0;
  let invalidRounds = rounds.length - runtimeRounds.length;
  for (const round of unique) {
    const recap = buildHistoricalRoundRecap(round);
    if (recap.meta.lifecycleState !== "completed") {
      nonFinalRounds += 1;
      continue;
    }
    if (!recap.meta.roundId || !validDate(recap.meta.date) || !recap.meta.courseName) {
      invalidRounds += 1;
      continue;
    }
    records.push({ round, recap, occurredAt: playedTimestamp(round, recap.meta.date) });
  }
  return { unique, records, nonFinalRounds, invalidRounds };
}

function cohort(holeCount: 9 | 18, rounds: ScoredRoundInsight[]): ScoreCohortInsight | undefined {
  const selected = rounds.filter((round) => round.holeCount === holeCount);
  if (!selected.length) return undefined;
  const netRounds = selected.filter((round) => round.net !== null);
  return {
    holeCount,
    rounds: selected.length,
    averageScore: average(selected.map((round) => round.gross)),
    bestScore: Math.min(...selected.map((round) => round.gross)),
    averageNet: average(netRounds.map((round) => round.net as number)),
    bestNet: netRounds.length ? Math.min(...netRounds.map((round) => round.net as number)) : undefined,
    netRounds: netRounds.length,
    averageVsPar: average(selected.map((round) => round.relativeToPar)),
    bestVsPar: Math.min(...selected.map((round) => round.relativeToPar)),
    last5Average: average(selected.slice(0, 5).map((round) => round.gross)),
    last10Average: average(selected.slice(0, 10).map((round) => round.gross)),
    recentRounds: selected,
  };
}

function trustedExpenses(round: RoundSnapshot, recap: HistoricalRoundRecap): Expense | undefined {
  const source: unknown = round.expenses;
  if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
  const expenseRecord = source as Record<string, unknown>;
  const values = EXPENSE_KEYS.map((key) => expenseRecord[key]);
  if (values.some((value) => !finiteNumber(value) || value < 0)) return undefined;
  const result = Object.fromEntries(EXPENSE_KEYS.map((key, index) => [key, values[index]])) as Expense;
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  return finiteNumber(recap.financials?.expenseTotal)
    && Math.abs(total - recap.financials.expenseTotal) <= FINANCIAL_EPSILON
    ? result
    : undefined;
}

function addExpenses(target: Expense, source: Expense) {
  for (const key of EXPENSE_KEYS) target[key] += source[key];
}

export function scoredRoundInsight(round: RoundSnapshot): ScoredRoundInsight | null {
  try {
    return insightFromRecap(round, buildHistoricalRoundRecap(round));
  } catch {
    return null;
  }
}

export function buildGolfInsights(rounds: readonly RoundSnapshot[]): GolfInsights {
  const { unique, records, nonFinalRounds, invalidRounds } = canonicalRounds(rounds);
  let unresolvedOwnerRounds = 0;
  const chronological = records
    .map(({ round, recap }) => {
      const insight = insightFromRecap(round, recap);
      if (recap.golf?.status === "complete" && !ownerPlayer(recap)) unresolvedOwnerRounds += 1;
      return insight;
    })
    .filter((insight): insight is ScoredRoundInsight => Boolean(insight))
    .sort(compareNewest);
  const cohort9 = cohort(9, chronological);
  const cohort18 = cohort(18, chronological);
  // Keep the existing default (standard 18-hole cohort) but expose both cohorts
  // so the UI can let the golfer choose explicitly.
  const primary = cohort18 || cohort9;
  const puttRounds = primary?.recentRounds.filter((round) => round.putts !== null) || [];
  const advancedRounds = chronological.filter((round) => round.advancedHoles > 0);

  const betValues: number[] = [];
  const expenseValues: number[] = [];
  const netValues: number[] = [];
  const expenseBreakdown: Expense = { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 };
  const categoryTotals: Record<string, number> = {};
  for (const { round, recap } of records) {
    const bet = trustedBetResult(recap);
    if (bet !== undefined) betValues.push(bet);
    const expenses = trustedExpenses(round, recap);
    if (expenses) {
      expenseValues.push(Object.values(expenses).reduce((sum, value) => sum + value, 0));
      addExpenses(expenseBreakdown, expenses);
    }
    const net = recap.financials?.netResult;
    if (finiteNumber(net) && bet !== undefined && expenses
      && Math.abs(bet - Object.values(expenses).reduce((sum, value) => sum + value, 0) - net) <= FINANCIAL_EPSILON) {
      netValues.push(net);
    }
    const owner = ownerPlayer(recap);
    if (owner) {
      for (const category of recap.categoryBalances || []) {
        const ownerBalance = category.balances.find((balance) => balance.playerId === owner.playerId)?.amount;
        if (finiteNumber(ownerBalance)) categoryTotals[category.category] = (categoryTotals[category.category] || 0) + ownerBalance;
      }
    }
  }

  return {
    rounds: records.length,
    scoredRounds: chronological.length,
    scoredRounds9: cohort9?.rounds || 0,
    scoredRounds18: cohort18?.rounds || 0,
    scoreSampleRounds: primary?.rounds || 0,
    scoreScopeHoles: primary?.holeCount,
    averageScore: primary?.averageScore,
    bestScore: primary?.bestScore,
    averageNet: primary?.averageNet,
    bestNet: primary?.bestNet,
    netRounds: primary?.netRounds || 0,
    averageVsPar: primary?.averageVsPar,
    bestVsPar: primary?.bestVsPar,
    last5Average: primary?.last5Average,
    last10Average: primary?.last10Average,
    pars: chronological.reduce((total, round) => total + round.pars, 0),
    birdies: chronological.reduce((total, round) => total + round.birdies, 0),
    eaglesOrBetter: chronological.reduce((total, round) => total + round.eaglesOrBetter, 0),
    bogeys: chronological.reduce((total, round) => total + round.bogeys, 0),
    doublesOrWorse: chronological.reduce((total, round) => total + round.doublesOrWorse, 0),
    averagePutts: average(puttRounds.map((round) => round.putts as number)),
    puttRounds: puttRounds.length,
    advancedRounds: advancedRounds.length,
    fairwaysHit: advancedRounds.reduce((total, round) => total + round.fairwaysHit, 0),
    fairwayAttempts: advancedRounds.reduce((total, round) => total + round.fairwayAttempts, 0),
    greensInRegulation: advancedRounds.reduce((total, round) => total + round.greensInRegulation, 0),
    greenAttempts: advancedRounds.reduce((total, round) => total + round.greenAttempts, 0),
    penaltyStrokes: advancedRounds.reduce((total, round) => total + round.penaltyStrokes, 0),
    coursesPlayed: new Set(chronological.map((round) => round.courseName)).size,
    ...(betValues.length ? { betBalance: betValues.reduce((total, value) => total + value, 0) } : {}),
    betRounds: betValues.length,
    ...(expenseValues.length ? { expenseTotal: expenseValues.reduce((total, value) => total + value, 0), expenseBreakdown } : {}),
    expenseRounds: expenseValues.length,
    ...(netValues.length ? { netResult: netValues.reduce((total, value) => total + value, 0) } : {}),
    netResultRounds: netValues.length,
    categoryTotals,
    recentRounds: chronological,
    scoreCohorts: {
      ...(cohort9 ? { 9: cohort9 } : {}),
      ...(cohort18 ? { 18: cohort18 } : {}),
    },
    quality: {
      inputSnapshots: rounds.length,
      uniqueSnapshots: unique.length,
      duplicateSnapshots: Math.max(0, rounds.length - unique.length),
      nonFinalRounds,
      invalidRounds,
      incompleteRounds: records.length - chronological.length,
      unresolvedOwnerRounds,
    },
  };
}

function relativeLabel(value: number) {
  if (value === 0) return "par";
  return `${value > 0 ? "+" : ""}${value} vs par`;
}

function signedMoneyLabel(value: number) {
  const rounded = Math.round(value);
  if (rounded === 0) return "$0";
  return `${rounded > 0 ? "+" : "−"}$${Math.abs(rounded).toLocaleString("es-MX")}`;
}

function validGroupActivity(group: FrequentGroup): PersonalActivity | undefined {
  const id = nonblank(group?.id);
  const name = nonblank(group?.name);
  const occurredAt = validInstant(group?.updatedAt);
  if (!id || !name || !occurredAt || !Array.isArray(group.players)) return undefined;
  return {
    id: `group:${id}`,
    kind: "group",
    title: `Actualizaste el grupo ${name}.`,
    detail: `${group.players.length} integrante${group.players.length === 1 ? "" : "s"} · listo para una ronda`,
    occurredAt,
    groupId: id,
  };
}

export function buildPersonalActivity(
  rounds: readonly RoundSnapshot[],
  groups: readonly FrequentGroup[],
  displayName: string,
  limit = 12,
): PersonalActivity[] {
  const golferName = displayName.trim() || "Un jugador";
  const canonical = canonicalRounds(rounds);
  const roundItems = canonical.records.map(({ round, recap, occurredAt }): PersonalActivity => {
    const insight = insightFromRecap(round, recap);
    const betDetail = insight?.betResult === undefined ? "" : ` · Apuestas ${signedMoneyLabel(insight.betResult)}`;
    const holeDetail = recap.meta.holeCount ? `${recap.meta.holeCount} hoyos · ` : "";
    return {
      id: `round:${recap.meta.roundId}`,
      kind: "round",
      title: insight
        ? `${golferName} jugó ${insight.gross} en ${insight.courseName}.`
        : `${golferName} guardó una ronda en ${recap.meta.courseName}.`,
      detail: insight
        ? `${relativeLabel(insight.relativeToPar)}${betDetail}`
        : `${holeDetail}Tarjeta disponible en Histórico`,
      occurredAt,
      roundId: recap.meta.roundId,
    };
  });
  const groupItems = groups
    .map(validGroupActivity)
    .filter((item): item is PersonalActivity => Boolean(item));
  return [...roundItems, ...groupItems].sort(compareNewest).slice(0, Math.max(0, limit));
}
