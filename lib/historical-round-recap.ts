import { profileHandicapLabel } from "./account-state";
import { summarizePlayerAdvancedStats } from "./advanced-stats";
import { buildBalanceLedger } from "./balance-ledger";
import { isValidRoundHandicapValue } from "./handicap-base";
import { privateLeaderboard } from "./round-utils";
import type { Course, HoleScore, Player, RoundLifecycleState, RoundSnapshot } from "./types";

const ZERO_SUM_EPSILON = 1e-9;

export type HistoricalRoundRecapIssueCode =
  | "invalid_snapshot"
  | "invalid_geometry"
  | "invalid_course"
  | "invalid_players"
  | "invalid_handicap"
  | "invalid_scores"
  | "invalid_player_balances"
  | "invalid_category_balances"
  | "invalid_financials"
  | "non_final_round";

export type HistoricalRoundRecapIssue = {
  code: HistoricalRoundRecapIssueCode;
  detail?: string;
};

export type HistoricalRoundRecapMeta = {
  roundId?: string;
  date?: string;
  courseName?: string;
  teeName?: string;
  ownerId?: string;
  ownerName?: string;
  lifecycleState?: RoundLifecycleState;
  holeCount?: 9 | 18;
  startHole?: 1 | 10;
};

export type HistoricalRoundFinancials = {
  /** Persisted bet total. It is never reconstructed from result details. */
  betResult?: number;
  /** Persisted expense total. */
  expenseTotal?: number;
  /** Persisted net total. It is never inferred from the other totals. */
  netResult?: number;
};

export type HistoricalGolfPlayer = {
  playerId: string;
  name: string;
  handicap: number | null;
  handicapLabel: string;
  gross?: number;
  net?: number;
  grossRelativeToPar?: number;
  netRelativeToPar?: number;
  thru: number;
  finished: boolean;
};

export type HistoricalScorecardPlayer = {
  playerId: string;
  score?: number;
};

export type HistoricalScorecardHole = {
  number: number;
  par: number;
  strokeIndex: number;
  yards?: number;
  players: HistoricalScorecardPlayer[];
};

export type HistoricalGolfRecap = {
  holeCount: 9 | 18;
  startHole: 1 | 10;
  order: number[];
  status: "not_started" | "partial" | "complete";
  leaderboard: HistoricalGolfPlayer[];
  scorecard: HistoricalScorecardHole[];
};

export type HistoricalPuttsRecap = {
  /** Total of explicitly persisted putts only. */
  total: number;
  capturedHoles: number;
};

export type HistoricalAdvancedStatsRecap = {
  capturedHoles: number;
  fairways?: { hit: number; attempts: number };
  greensInRegulation?: { hit: number; attempts: number };
  penalties?: { strokes: number; capturedHoles: number };
};

export type HistoricalScoringStatsRecap = {
  scoredHoles: number;
  pars: number;
  birdies: number;
  eaglesOrBetter: number;
  bogeys: number;
  doublesPlus: number;
};

export type HistoricalPlayerStatsRecap = {
  playerId: string;
  name: string;
  scoring?: HistoricalScoringStatsRecap;
  putts?: HistoricalPuttsRecap;
  advanced?: HistoricalAdvancedStatsRecap;
};

export type HistoricalPersistedBalance = {
  identityKey: string;
  playerId: string;
  name: string;
  amount: number;
};

export type HistoricalSuggestedTransfer = {
  /** This is a mathematical suggestion, never evidence of a debt or payment. */
  kind: "suggestion";
  fromIdentityKey: string;
  fromPlayerId: string;
  fromName: string;
  toIdentityKey: string;
  toPlayerId: string;
  toName: string;
  amount: number;
};

export type HistoricalSettlementRecap = {
  source: "persisted_player_balances";
  balances: HistoricalPersistedBalance[];
  suggestedTransfers: HistoricalSuggestedTransfer[];
  notice: string;
};

export type HistoricalCategoryBalanceRecap = {
  category: string;
  /** Exact, validated persisted amounts; no betting engine is rerun. */
  balances: Array<{ playerId: string; name: string; amount: number }>;
};

export type HistoricalPersonalOpponentRecap = {
  source: "personal_opponent_results" | "legacy_personal_results";
  opponentId: string;
  opponentName: string;
  amount: number;
  betId?: string;
  mode?: "nassau_individual" | "dollar_stroke" | "individual_pressures";
  modeLabel?: string;
  status?: "partial" | "final" | "pending";
};

export type HistoricalRoundRecap = {
  meta: HistoricalRoundRecapMeta;
  financials?: HistoricalRoundFinancials;
  golf?: HistoricalGolfRecap;
  /** Omitted when no optional stat was explicitly persisted. */
  playerStats?: HistoricalPlayerStatsRecap[];
  /** Omitted for legacy, absent, non-finite or non-zero-sum ledgers. */
  settlement?: HistoricalSettlementRecap;
  /** Omitted when no complete, finite, zero-sum category map was persisted. */
  categoryBalances?: HistoricalCategoryBalanceRecap[];
  /** Frozen persisted rival results. No historical betting engine is executed. */
  personalOpponents?: HistoricalPersonalOpponentRecap[];
  issues: HistoricalRoundRecapIssue[];
};

type RuntimeRecord = Record<string, unknown>;

function record(value: unknown): RuntimeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RuntimeRecord
    : undefined;
}

function nonblank(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !/\s/.test(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function lifecycleState(value: unknown): RoundLifecycleState | undefined {
  return value === "draft" || value === "live" || value === "completed" || value === "cancelled"
    ? value
    : undefined;
}

function playedOrder(startHole: 1 | 10, holeCount: 9 | 18) {
  const full = startHole === 10
    ? [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  return full.slice(0, holeCount);
}

function equalOrder(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((hole, index) => hole === right[index]);
}

function roundGeometry(source: RuntimeRecord) {
  const rawHoleCount = source.roundHoles;
  const rawStartHole = source.startHole;
  const explicitHoleCount = rawHoleCount === 9 || rawHoleCount === 18 ? rawHoleCount : undefined;
  const explicitStartHole = rawStartHole === 1 || rawStartHole === 10 ? rawStartHole : undefined;
  if ((rawHoleCount !== undefined && explicitHoleCount === undefined)
    || (rawStartHole !== undefined && explicitStartHole === undefined)) return undefined;

  let storedOrder: number[] | undefined;
  if (source.order !== undefined) {
    if (!Array.isArray(source.order)
      || (source.order.length !== 9 && source.order.length !== 18)
      || source.order.some((hole) => !integerInRange(hole, 1, 18))
      || new Set(source.order).size !== source.order.length) return undefined;
    storedOrder = [...source.order] as number[];
  }

  const holeCount: 9 | 18 | undefined = explicitHoleCount ?? (storedOrder?.length as 9 | 18 | undefined);
  const inferredStartHole: 1 | 10 | undefined = storedOrder?.[0] === 1 ? 1 : storedOrder?.[0] === 10 ? 10 : undefined;
  const startHole: 1 | 10 | undefined = explicitStartHole ?? inferredStartHole;
  if (!holeCount || !startHole) return undefined;
  const expected = playedOrder(startHole, holeCount);
  if (storedOrder && !equalOrder(storedOrder, expected)) return undefined;
  return { holeCount, startHole, order: storedOrder || expected };
}

function normalizedPlayers(value: unknown, issues: HistoricalRoundRecapIssue[]) {
  if (!Array.isArray(value) || !value.length) {
    issues.push({ code: "invalid_players" });
    return { players: [] as Player[], valid: false };
  }
  const players: Player[] = [];
  const ids = new Set<string>();
  let invalid = false;
  let duplicate = false;
  for (const rawPlayer of value) {
    const player = record(rawPlayer);
    const id = player && stableId(player.id) ? player.id : undefined;
    if (!player || !id) {
      invalid = true;
      continue;
    }
    if (ids.has(id)) {
      invalid = true;
      duplicate = true;
      continue;
    }
    ids.add(id);
    const name = nonblank(player.name) || id;
    let handicap: number | null = null;
    if (isValidRoundHandicapValue(player.handicap)) handicap = Object.is(player.handicap, -0) ? 0 : player.handicap;
    else if (player.handicap !== null && player.handicap !== undefined) {
      issues.push({ code: "invalid_handicap", detail: id });
    }
    const accountUserId = stableId(player.accountUserId) ? player.accountUserId : undefined;
    players.push({ id, name, handicap, ...(accountUserId ? { accountUserId } : {}) });
  }
  if (invalid) issues.push({ code: "invalid_players" });
  // Duplicate ids make every score-to-player association ambiguous.
  return { players: duplicate ? [] : players, valid: !invalid };
}

function normalizedCourse(value: unknown, order: readonly number[], meta: HistoricalRoundRecapMeta) {
  const source = record(value);
  if (!source || !Array.isArray(source.holes)) return undefined;
  const holes = new Map<number, Course["holes"][number]>();
  let duplicate = false;
  for (const rawHole of source.holes) {
    const hole = record(rawHole);
    if (!hole
      || !integerInRange(hole.number, 1, 18)
      || !integerInRange(hole.par, 1, 9)
      || !integerInRange(hole.strokeIndex, 1, 18)) continue;
    if (holes.has(hole.number)) {
      duplicate = true;
      continue;
    }
    const yards = finiteNumber(hole.yards) && hole.yards >= 0 ? hole.yards : undefined;
    holes.set(hole.number, {
      number: hole.number,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
      ...(yards !== undefined ? { yards } : {}),
    });
  }
  const orderedHoles = order.map((hole) => holes.get(hole));
  if (duplicate || orderedHoles.some((hole) => !hole)) return undefined;
  const strokeIndexes = orderedHoles.map((hole) => hole!.strokeIndex);
  if (new Set(strokeIndexes).size !== strokeIndexes.length) return undefined;
  return {
    id: nonblank(source.id) || meta.roundId || "historical-round",
    name: nonblank(source.name) || meta.courseName || "Campo guardado",
    teeName: nonblank(source.teeName) || meta.teeName || "",
    holes: [...holes.values()],
  } satisfies Course;
}

function normalizedScores(value: unknown, order: readonly number[], players: readonly Player[]) {
  const source = record(value);
  if (!source) return { scores: {} as Record<number, HoleScore>, invalid: value !== undefined, fatal: false };
  const playerIds = new Set(players.map((player) => player.id));
  const scores: Record<number, HoleScore> = {};
  let invalid = false;
  let fatal = false;
  for (const hole of order) {
    const rawRow = source[String(hole)];
    if (rawRow === undefined) continue;
    const row = record(rawRow);
    if (!row) {
      invalid = true;
      continue;
    }
    const safeRow: HoleScore = {};
    for (const [playerId, score] of Object.entries(row)) {
      if (!playerIds.has(playerId)) {
        fatal = true;
        continue;
      }
      if (score === null || score === undefined) continue;
      if (finiteNumber(score) && Number.isSafeInteger(score) && score >= 1 && score <= 20) safeRow[playerId] = score;
      else invalid = true;
    }
    if (Object.keys(safeRow).length) scores[hole] = safeRow;
  }
  return { scores, invalid: invalid || fatal, fatal };
}

function golfRecap(
  geometry: NonNullable<ReturnType<typeof roundGeometry>>,
  course: Course,
  players: Player[],
  scores: Record<number, HoleScore>,
): HistoricalGolfRecap {
  const rows = privateLeaderboard(course, players, scores, geometry.order);
  const leaderboard = rows.map((row): HistoricalGolfPlayer => {
    if (!row.thru) {
      return {
        playerId: row.playerId,
        name: row.name,
        handicap: row.handicap,
        handicapLabel: profileHandicapLabel(row.handicap),
        thru: 0,
        finished: false,
      };
    }
    const playedPar = row.gross - row.relativeToPar;
    return {
      playerId: row.playerId,
      name: row.name,
      handicap: row.handicap,
      handicapLabel: profileHandicapLabel(row.handicap),
      gross: row.gross,
      ...(row.net === null ? {} : { net: row.net, netRelativeToPar: row.net - playedPar }),
      grossRelativeToPar: row.relativeToPar,
      thru: row.thru,
      finished: row.finished,
    };
  });
  const anyScore = leaderboard.some((row) => row.thru > 0);
  const complete = anyScore && leaderboard.length > 0 && leaderboard.every((row) => row.finished);
  return {
    holeCount: geometry.holeCount,
    startHole: geometry.startHole,
    order: [...geometry.order],
    status: complete ? "complete" : anyScore ? "partial" : "not_started",
    leaderboard,
    scorecard: geometry.order.map((holeNumber) => {
      const hole = course.holes.find((candidate) => candidate.number === holeNumber)!;
      return {
        number: hole.number,
        par: hole.par,
        strokeIndex: hole.strokeIndex,
        ...(hole.yards === undefined ? {} : { yards: hole.yards }),
        players: players.map((player) => ({
          playerId: player.id,
          ...(typeof scores[holeNumber]?.[player.id] === "number" ? { score: scores[holeNumber][player.id] as number } : {}),
        })),
      };
    }),
  };
}

function puttsForPlayer(value: unknown, playerId: string, order: readonly number[]): HistoricalPuttsRecap | undefined {
  const source = record(value);
  if (!source) return undefined;
  let total = 0;
  let capturedHoles = 0;
  for (const hole of order) {
    const row = record(source[String(hole)]);
    const putts = row?.[playerId];
    if (!finiteNumber(putts) || !Number.isInteger(putts) || putts < 0 || putts > 20) continue;
    total += putts;
    capturedHoles += 1;
  }
  return capturedHoles ? { total, capturedHoles } : undefined;
}

function scoringForPlayer(
  playerId: string,
  order: readonly number[],
  course: Course,
  scores: Readonly<Record<number, HoleScore>>,
): HistoricalScoringStatsRecap | undefined {
  const result: HistoricalScoringStatsRecap = {
    scoredHoles: 0,
    pars: 0,
    birdies: 0,
    eaglesOrBetter: 0,
    bogeys: 0,
    doublesPlus: 0,
  };
  for (const holeNumber of order) {
    const score = scores[holeNumber]?.[playerId];
    const hole = course.holes.find((candidate) => candidate.number === holeNumber);
    if (typeof score !== "number" || !hole) continue;
    result.scoredHoles += 1;
    const relative = score - hole.par;
    if (relative === 0) result.pars += 1;
    else if (relative === -1) result.birdies += 1;
    else if (relative <= -2) result.eaglesOrBetter += 1;
    else if (relative === 1) result.bogeys += 1;
    else if (relative >= 2) result.doublesPlus += 1;
  }
  return result.scoredHoles ? result : undefined;
}

function optionalPlayerStats(
  source: RuntimeRecord,
  players: readonly Player[],
  order: readonly number[],
  course: Course,
  scores: Readonly<Record<number, HoleScore>>,
) {
  const result: HistoricalPlayerStatsRecap[] = [];
  for (const player of players) {
    const scoring = scoringForPlayer(player.id, order, course, scores);
    const putts = puttsForPlayer(source.putts, player.id, order);
    const summary = summarizePlayerAdvancedStats(source.advancedStats as RoundSnapshot["advancedStats"], player.id, [...order]);
    const advanced: HistoricalAdvancedStatsRecap | undefined = summary.capturedHoles
      ? {
          capturedHoles: summary.capturedHoles,
          ...(summary.fairwayAttempts ? { fairways: { hit: summary.fairwaysHit, attempts: summary.fairwayAttempts } } : {}),
          ...(summary.greenAttempts ? { greensInRegulation: { hit: summary.greensInRegulation, attempts: summary.greenAttempts } } : {}),
          ...(summary.penaltyHoles ? { penalties: { strokes: summary.penaltyStrokes, capturedHoles: summary.penaltyHoles } } : {}),
        }
      : undefined;
    if (scoring || putts || advanced) result.push({
      playerId: player.id,
      name: player.name,
      ...(scoring ? { scoring } : {}),
      ...(putts ? { putts } : {}),
      ...(advanced ? { advanced } : {}),
    });
  }
  return result.length ? result : undefined;
}

function personalMode(value: unknown): HistoricalPersonalOpponentRecap["mode"] | undefined {
  return value === "nassau_individual" || value === "dollar_stroke" || value === "individual_pressures"
    ? value
    : undefined;
}

function personalStatus(value: unknown): HistoricalPersonalOpponentRecap["status"] | undefined {
  return value === "partial" || value === "final" || value === "pending" ? value : undefined;
}

function persistedPersonalOpponents(source: RuntimeRecord) {
  const entries: HistoricalPersonalOpponentRecap[] = [];
  const names = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  const rememberName = (opponentId: string, opponentName: string) => {
    if (ambiguousNames.has(opponentId)) return;
    const existing = names.get(opponentId);
    if (existing && existing !== opponentName) {
      names.delete(opponentId);
      ambiguousNames.add(opponentId);
    } else names.set(opponentId, opponentName);
  };

  if (source.personalOpponentResults !== undefined) {
    if (!Array.isArray(source.personalOpponentResults)) return { entries: undefined, names };
    for (const rawResult of source.personalOpponentResults) {
      const result = record(rawResult);
      const opponentId = result && stableId(result.opponentId) ? result.opponentId : undefined;
      const opponentName = result ? nonblank(result.opponentName) : undefined;
      if (!result || !opponentId || !opponentName || !finiteNumber(result.amount)) continue;
      const mode = personalMode(result.mode);
      const status = personalStatus(result.status);
      const betId = nonblank(result.betId);
      const modeLabel = nonblank(result.modeLabel);
      entries.push({
        source: "personal_opponent_results",
        opponentId,
        opponentName,
        amount: result.amount,
        ...(betId ? { betId } : {}),
        ...(mode ? { mode } : {}),
        ...(modeLabel ? { modeLabel } : {}),
        ...(status ? { status } : {}),
      });
      rememberName(opponentId, opponentName);
    }
    return { entries: entries.length ? entries : undefined, names };
  }

  if (!Array.isArray(source.personalResults)) return { entries: undefined, names };
  for (const rawResult of source.personalResults) {
    const result = record(rawResult);
    const opponentId = result && stableId(result.rivalKey) ? result.rivalKey : undefined;
    const opponentName = result ? nonblank(result.rivalName) : undefined;
    if (!result || !opponentId || !opponentName || !finiteNumber(result.totalMoney)) continue;
    const betId = nonblank(result.betId);
    entries.push({
      source: "legacy_personal_results",
      opponentId,
      opponentName,
      amount: result.totalMoney,
      ...(betId ? { betId } : {}),
    });
    rememberName(opponentId, opponentName);
  }
  return { entries: entries.length ? entries : undefined, names };
}

function minimalLedgerSnapshot(
  source: RuntimeRecord,
  meta: HistoricalRoundRecapMeta,
  players: Player[],
  externalNames: ReadonlyMap<string, string>,
): RoundSnapshot | undefined {
  if (!meta.roundId || source.playerBalances === undefined) return undefined;
  return {
    id: meta.roundId,
    date: meta.date || "",
    courseName: meta.courseName || "",
    teeName: meta.teeName || "",
    ownerName: meta.ownerName || "",
    ...(meta.ownerId ? { ownerId: meta.ownerId } : {}),
    betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 0,
    categoryResults: {},
    players,
    personalOpponentResults: [...externalNames].map(([opponentId, opponentName], index) => ({
      betId: `historical-opponent-${index}`,
      mode: "nassau_individual",
      modeLabel: "Resultado personal guardado",
      opponentId,
      opponentName,
      amount: 0,
    })),
    playerBalances: source.playerBalances as Record<string, number>,
  };
}

function persistedSettlement(
  source: RuntimeRecord,
  meta: HistoricalRoundRecapMeta,
  players: Player[],
  playersValid: boolean,
  externalNames: ReadonlyMap<string, string>,
) {
  const snapshot = minimalLedgerSnapshot(source, meta, players, externalNames);
  if (!snapshot) return undefined;
  const rawBalances = record(source.playerBalances);
  if (!playersValid || !rawBalances) return null;
  const balanceIds = new Set(Object.keys(rawBalances));
  if (players.some((player) => !balanceIds.has(player.id))) return null;
  if ([...balanceIds].some((playerId) => !players.some((player) => player.id === playerId) && !externalNames.has(playerId))) return null;
  const ledger = buildBalanceLedger([snapshot]);
  const round = ledger.rounds.find((candidate) => candidate.roundId === snapshot.id && candidate.settleable);
  if (!round || ledger.issues.length) return null;
  const byKey = new Map(round.balances.map((balance) => [balance.key, balance]));
  return {
    source: "persisted_player_balances" as const,
    balances: round.balances.map((balance) => ({
      identityKey: balance.key,
      playerId: balance.playerId,
      name: balance.name,
      amount: balance.amount,
    })),
    suggestedTransfers: ledger.suggestedTransfers.map((transfer): HistoricalSuggestedTransfer => {
      const from = byKey.get(transfer.fromKey)!;
      const to = byKey.get(transfer.toKey)!;
      return {
        kind: "suggestion",
        fromIdentityKey: transfer.fromKey,
        fromPlayerId: from.playerId,
        fromName: from.name,
        toIdentityKey: transfer.toKey,
        toPlayerId: to.playerId,
        toName: to.name,
        amount: transfer.amount,
      };
    }),
    notice: "Sugerencias matemáticas basadas en los balances guardados; no confirman deuda ni pago.",
  } satisfies HistoricalSettlementRecap;
}

function safePlayerName(players: readonly Player[], playerId: string, externalNames: ReadonlyMap<string, string>) {
  return players.find((player) => player.id === playerId)?.name || externalNames.get(playerId) || playerId;
}

function persistedCategoryBalances(
  value: unknown,
  players: readonly Player[],
  issues: HistoricalRoundRecapIssue[],
  settlement: HistoricalSettlementRecap | undefined,
  externalNames: ReadonlyMap<string, string>,
) {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source) {
    issues.push({ code: "invalid_category_balances" });
    return undefined;
  }
  const categories: HistoricalCategoryBalanceRecap[] = [];
  const totals = new Map<string, number>();
  let invalid = false;
  for (const [rawCategory, rawBalances] of Object.entries(source)) {
    const category = rawCategory.trim();
    const balances = record(rawBalances);
    const entries = balances ? Object.entries(balances) : [];
    const valid = Boolean(category)
      && Boolean(balances)
      && entries.every(([playerId, amount]) => stableId(playerId) && finiteNumber(amount))
      && Math.abs(entries.reduce((sum, [, amount]) => sum + (amount as number), 0)) <= ZERO_SUM_EPSILON;
    if (!valid) {
      issues.push({ code: "invalid_category_balances", ...(category ? { detail: category } : {}) });
      invalid = true;
      continue;
    }
    if (!entries.length || entries.every(([, amount]) => Math.abs(amount as number) <= ZERO_SUM_EPSILON)) continue;
    for (const [playerId, amount] of entries) totals.set(playerId, (totals.get(playerId) || 0) + (amount as number));
    categories.push({
      category,
      balances: entries.map(([playerId, amount]) => ({
        playerId,
        name: safePlayerName(players, playerId, externalNames),
        amount: amount as number,
      })),
    });
  }
  if (invalid) return undefined;
  if (settlement) {
    const expected = new Map(settlement.balances.map((balance) => [balance.playerId, balance.amount]));
    const playerIds = new Set([...expected.keys(), ...totals.keys()]);
    const reconciles = [...playerIds].every((playerId) => Math.abs((expected.get(playerId) || 0) - (totals.get(playerId) || 0)) <= ZERO_SUM_EPSILON);
    if (!reconciles) {
      issues.push({ code: "invalid_category_balances", detail: "player_balances_mismatch" });
      return undefined;
    }
  }
  return categories.length ? categories : undefined;
}

function safeMeta(source: RuntimeRecord): HistoricalRoundRecapMeta {
  const holeCount = source.roundHoles === 9 || source.roundHoles === 18 ? source.roundHoles : undefined;
  const startHole = source.startHole === 1 || source.startHole === 10 ? source.startHole : undefined;
  return {
    ...(stableId(source.id) ? { roundId: source.id } : {}),
    ...(nonblank(source.date) ? { date: nonblank(source.date) } : {}),
    ...(nonblank(source.courseName) ? { courseName: nonblank(source.courseName) } : {}),
    ...(nonblank(source.teeName) ? { teeName: nonblank(source.teeName) } : {}),
    ...(stableId(source.ownerId) ? { ownerId: source.ownerId } : {}),
    ...(nonblank(source.ownerName) ? { ownerName: nonblank(source.ownerName) } : {}),
    lifecycleState: lifecycleState(source.lifecycleState) || "completed",
    ...(holeCount ? { holeCount } : {}),
    ...(startHole ? { startHole } : {}),
  };
}

const EXPENSE_KEYS = ["caddie", "food", "drinks", "greenFee", "cartRental", "other"] as const;

function persistedFinancials(source: RuntimeRecord, settlement: HistoricalSettlementRecap | null | undefined) {
  if (source.snapshotVersion === 2) {
    const expenses = record(source.expenses);
    const ownerId = stableId(source.ownerId) ? source.ownerId : undefined;
    const betResult = source.betResult;
    const expenseTotal = source.expenseTotal;
    const netResult = source.netResult;
    const expenseValues = expenses ? EXPENSE_KEYS.map((key) => expenses[key]) : [];
    const expensesValid = expenseValues.length === EXPENSE_KEYS.length
      && expenseValues.every((value) => finiteNumber(value) && value >= 0);
    const expenseSum = expensesValid
      ? expenseValues.reduce<number>((sum, value) => sum + (value as number), 0)
      : Number.NaN;
    const ownerBalance = ownerId && settlement
      ? settlement.balances.find((balance) => balance.playerId === ownerId)?.amount
      : undefined;
    const valid = finiteNumber(betResult)
      && finiteNumber(expenseTotal) && expenseTotal >= 0
      && finiteNumber(netResult)
      && expensesValid
      && finiteNumber(ownerBalance)
      && Math.abs(ownerBalance - betResult) <= ZERO_SUM_EPSILON
      && Math.abs(expenseSum - expenseTotal) <= ZERO_SUM_EPSILON
      && Math.abs((betResult - expenseTotal) - netResult) <= ZERO_SUM_EPSILON;
    return valid ? { betResult, expenseTotal, netResult } satisfies HistoricalRoundFinancials : null;
  }
  const financials: HistoricalRoundFinancials = {
    ...(finiteNumber(source.betResult) ? { betResult: source.betResult } : {}),
    ...(finiteNumber(source.expenseTotal) && source.expenseTotal >= 0 ? { expenseTotal: source.expenseTotal } : {}),
    ...(finiteNumber(source.netResult) ? { netResult: source.netResult } : {}),
  };
  return Object.keys(financials).length ? financials : undefined;
}

/**
 * Builds a read-only recap exclusively from fields persisted in one round snapshot.
 * `resultDetails` is deliberately never read: it is an untrusted historical cache,
 * and the recap never reruns any betting engine or claims a payment occurred.
 */
export function buildHistoricalRoundRecap(snapshot: RoundSnapshot): HistoricalRoundRecap {
  const empty: HistoricalRoundRecap = { meta: {}, issues: [{ code: "invalid_snapshot" }] };
  try {
    const source = record(snapshot);
    if (!source) return empty;
    const issues: HistoricalRoundRecapIssue[] = [];
    const meta = safeMeta(source);
    const isFinalRound = meta.lifecycleState === "completed";
    if (!isFinalRound) issues.push({ code: "non_final_round" });
    const geometry = roundGeometry(source);
    if (geometry) {
      meta.holeCount = geometry.holeCount;
      meta.startHole = geometry.startHole;
    } else issues.push({ code: "invalid_geometry" });

    const normalizedPlayerResult = normalizedPlayers(source.players, issues);
    const players = normalizedPlayerResult.players;
    let golf: HistoricalGolfRecap | undefined;
    let playerStats: HistoricalPlayerStatsRecap[] | undefined;
    if (geometry && normalizedPlayerResult.valid && players.length) {
      const course = normalizedCourse(source.courseSnapshot, geometry.order, meta);
      if (!course) issues.push({ code: "invalid_course" });
      else {
        const normalized = normalizedScores(source.scores, geometry.order, players);
        if (normalized.invalid) issues.push({ code: "invalid_scores" });
        if (!normalized.fatal) {
          golf = golfRecap(geometry, course, players, normalized.scores);
          playerStats = optionalPlayerStats(source, players, geometry.order, course, normalized.scores);
        }
      }
    }

    const personal = persistedPersonalOpponents(source);
    const persistedLedger = persistedSettlement(source, meta, players, normalizedPlayerResult.valid, personal.names);
    const invalidPersistedLedger = source.playerBalances !== undefined && !persistedLedger;
    if (invalidPersistedLedger) issues.push({ code: "invalid_player_balances" });
    const settlement = isFinalRound && persistedLedger ? persistedLedger : undefined;
    const categoryBalances = isFinalRound && !invalidPersistedLedger
      ? persistedCategoryBalances(source.categoryBalances, players, issues, persistedLedger || undefined, personal.names)
      : undefined;
    const financials = persistedFinancials(source, persistedLedger);
    if (financials === null) issues.push({ code: "invalid_financials" });

    return {
      meta,
      ...(financials ? { financials } : {}),
      ...(golf ? { golf } : {}),
      ...(playerStats ? { playerStats } : {}),
      ...(settlement ? { settlement } : {}),
      ...(categoryBalances ? { categoryBalances } : {}),
      ...(personal.entries ? { personalOpponents: personal.entries } : {}),
      issues,
    };
  } catch {
    return empty;
  }
}
