import { privateLeaderboard } from "./round-utils";
import type { FrequentGroup, Player, RoundSnapshot } from "./types";
import { summarizePlayerAdvancedStats } from "./advanced-stats";

export type ScoredRoundInsight = {
  id: string;
  date: string;
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
  betResult: number;
  holeCount: 9 | 18;
};

export type GolfInsights = {
  rounds: number;
  scoredRounds: number;
  scoredRounds9: number;
  scoredRounds18: number;
  scoreSampleRounds: number;
  scoreScopeHoles?: 9 | 18;
  averageScore?: number;
  bestScore?: number;
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
  betBalance: number;
  recentRounds: ScoredRoundInsight[];
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

function finiteScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ownerPlayer(round: RoundSnapshot): Player | undefined {
  return round.players?.find((player) => player.id === round.ownerId)
    || round.players?.find((player) => player.name === round.ownerName)
    || round.players?.[0];
}

function roundTimestamp(round: RoundSnapshot) {
  return round.completedAt || round.updatedAt || `${round.date}T12:00:00`;
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : undefined;
}

function compareNewest(left: { occurredAt: string }, right: { occurredAt: string }) {
  return right.occurredAt.localeCompare(left.occurredAt);
}

export function scoredRoundInsight(round: RoundSnapshot): ScoredRoundInsight | null {
  const course = round.courseSnapshot;
  const player = ownerPlayer(round);
  const order = round.order;
  if (!course || !player || !round.scores || (order?.length !== 9 && order?.length !== 18)) return null;
  const board = privateLeaderboard(course, [player], round.scores, order)[0];
  if (!board?.finished) return null;

  let pars = 0;
  let birdies = 0;
  let eaglesOrBetter = 0;
  let bogeys = 0;
  let doublesOrWorse = 0;
  const puttValues: number[] = [];
  let completePutts = Boolean(round.putts);

  for (const holeNumber of order) {
    const hole = course.holes.find((candidate) => candidate.number === holeNumber);
    const score = round.scores[holeNumber]?.[player.id];
    if (!hole || !finiteScore(score)) return null;
    const relative = score - hole.par;
    if (relative === 0) pars += 1;
    else if (relative === -1) birdies += 1;
    else if (relative <= -2) eaglesOrBetter += 1;
    else if (relative === 1) bogeys += 1;
    else if (relative >= 2) doublesOrWorse += 1;

    const putts = round.putts?.[holeNumber]?.[player.id];
    if (finiteScore(putts)) puttValues.push(putts);
    else completePutts = false;
  }
  const advanced = summarizePlayerAdvancedStats(round.advancedStats, player.id, order);

  return {
    id: round.id,
    date: round.date,
    courseName: round.courseName,
    teeName: round.teeName,
    gross: board.gross,
    net: board.net,
    relativeToPar: board.relativeToPar,
    pars,
    birdies,
    eaglesOrBetter,
    bogeys,
    doublesOrWorse,
    putts: completePutts ? puttValues.reduce((total, value) => total + value, 0) : null,
    fairwaysHit: advanced.fairwaysHit,
    fairwayAttempts: advanced.fairwayAttempts,
    greensInRegulation: advanced.greensInRegulation,
    greenAttempts: advanced.greenAttempts,
    penaltyStrokes: advanced.penaltyStrokes,
    advancedHoles: advanced.capturedHoles,
    betResult: round.betResult,
    holeCount: order.length,
  };
}

export function buildGolfInsights(rounds: RoundSnapshot[]): GolfInsights {
  const chronological = rounds
    .map((round) => ({ occurredAt: roundTimestamp(round), insight: scoredRoundInsight(round) }))
    .filter((item): item is { occurredAt: string; insight: ScoredRoundInsight } => Boolean(item.insight))
    .sort(compareNewest)
    .map((item) => item.insight);
  const rounds18 = chronological.filter((round) => round.holeCount === 18);
  const rounds9 = chronological.filter((round) => round.holeCount === 9);
  // Gross score and total putts are only comparable within the same round length.
  // Prefer the standard 18-hole cohort; fall back to 9 holes when it is the only
  // complete sample. Per-hole category totals remain valid across both lengths.
  const comparableRounds = rounds18.length ? rounds18 : rounds9;
  const scoreScopeHoles = comparableRounds[0]?.holeCount;
  const puttRounds = comparableRounds.filter((round) => round.putts !== null);
  const advancedRounds = chronological.filter((round) => round.advancedHoles > 0);
  const last5 = comparableRounds.slice(0, 5);
  const last10 = comparableRounds.slice(0, 10);

  return {
    rounds: rounds.length,
    scoredRounds: chronological.length,
    scoredRounds9: rounds9.length,
    scoredRounds18: rounds18.length,
    scoreSampleRounds: comparableRounds.length,
    scoreScopeHoles,
    averageScore: average(comparableRounds.map((round) => round.gross)),
    bestScore: comparableRounds.length ? Math.min(...comparableRounds.map((round) => round.gross)) : undefined,
    averageVsPar: average(comparableRounds.map((round) => round.relativeToPar)),
    bestVsPar: comparableRounds.length ? Math.min(...comparableRounds.map((round) => round.relativeToPar)) : undefined,
    last5Average: average(last5.map((round) => round.gross)),
    last10Average: average(last10.map((round) => round.gross)),
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
    coursesPlayed: new Set(rounds.map((round) => round.courseName).filter(Boolean)).size,
    betBalance: rounds.reduce((total, round) => total + round.betResult, 0),
    recentRounds: chronological,
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

export function buildPersonalActivity(
  rounds: RoundSnapshot[],
  groups: FrequentGroup[],
  displayName: string,
  limit = 12,
): PersonalActivity[] {
  const golferName = displayName.trim() || "Un jugador";
  const roundItems = rounds.map((round): PersonalActivity => {
    const insight = scoredRoundInsight(round);
    return {
      id: `round:${round.id}`,
      kind: "round",
      title: insight
        ? `${golferName} jugó ${insight.gross} en ${round.courseName}.`
        : `${golferName} guardó una ronda en ${round.courseName}.`,
      detail: insight
        ? `${relativeLabel(insight.relativeToPar)} · Apuestas ${signedMoneyLabel(insight.betResult)}`
        : `${round.roundHoles || 18} hoyos · Tarjeta disponible en Histórico`,
      occurredAt: roundTimestamp(round),
      roundId: round.id,
    };
  });
  const groupItems = groups.map((group): PersonalActivity => ({
    id: `group:${group.id}`,
    kind: "group",
    title: `Actualizaste el grupo ${group.name}.`,
    detail: `${group.players.length} integrante${group.players.length === 1 ? "" : "s"} · listo para una ronda`,
    occurredAt: group.updatedAt,
    groupId: group.id,
  }));
  return [...roundItems, ...groupItems].sort(compareNewest).slice(0, Math.max(0, limit));
}
