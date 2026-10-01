import { playingHandicap, strokeAllowanceForHole, personalRivalKey } from "./engine";
import type { calculatePersonalBets } from "./engine";
import { migratePersonalNassau } from "./personal-nassau";
import { migrateSupplementalNassau } from "./nassau-migration";
import type { Course, HoleScore, Player, RoundSnapshot } from "./types";
import type { FrequentPlayer } from "./types";

export const STORAGE_KEYS = {
  courses: "golfbets-courses",
  history: "golfbets-history",
  rivals: "golfbets-personal-rivals",
  draft: "golfbets-draft-v1",
  frequentPlayers: "golfbets-frequent-players-v1",
  frequentGroups: "golfbets-frequent-groups-v1",
  contrast: "golfbets-high-contrast-v1",
} as const;

export function readStoredJson<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: T,
): T {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function recordValue(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function validScoreRows(value: unknown) {
  const source = recordValue(value);
  if (!source) return {};
  const rows: Record<number, HoleScore> = {};
  for (const [rawHole, rawRow] of Object.entries(source)) {
    const hole = Number(rawHole);
    const row = recordValue(rawRow);
    if (!Number.isInteger(hole) || hole < 1 || hole > 18 || !row) continue;
    const clean = Object.fromEntries(Object.entries(row).filter(([, score]) => score === null || (typeof score === "number" && Number.isInteger(score) && score >= 1)));
    if (Object.keys(clean).length) rows[hole] = clean as HoleScore;
  }
  return rows;
}

/** Keep independent valid blocks of a legacy/local draft and discard only the
 * malformed portions. This function never clears storage or mutates its input. */
export function normalizeRoundDraft(value: unknown) {
  const source = recordValue(value);
  if (!source) return null;
  const players = Array.isArray(source.players)
    ? source.players.filter(player => recordValue(player) && typeof player.id === "string" && typeof player.name === "string")
    : [];
  const course = recordValue(source.course) && Array.isArray(source.course.holes) && source.course.holes.length === 18 ? source.course : undefined;
  const draft = {
    ...source,
    ...(course ? { course } : { course: undefined }),
    players,
    bets: recordValue(source.bets),
    segments: Array.isArray(source.segments) ? source.segments : [],
    personalBets: Array.isArray(source.personalBets) ? source.personalBets : [],
    supplementalBets: Array.isArray(source.supplementalBets) ? source.supplementalBets : [],
    manualBets: Array.isArray(source.manualBets) ? source.manualBets : [],
    scores: validScoreRows(source.scores),
    scoreEdits: validScoreRows(source.scoreEdits),
    putts: validPuttRows(source.putts),
    unitEvents: Array.isArray(source.unitEvents) ? source.unitEvents : [],
    counterBetEvents: Array.isArray(source.counterBetEvents) ? source.counterBetEvents : [],
    counterBetKeepers: recordValue(source.counterBetKeepers),
    lobaHoles: recordValue(source.lobaHoles) || {},
    ballFriendSetup: recordValue(source.ballFriendSetup) || {},
    expenses: recordValue(source.expenses),
  };
  return migrateDraftPressures(migrateSupplementalNassau(draft));
}

function validPuttRows(value: unknown) {
  const source = recordValue(value);
  if (!source) return {};
  const rows: Record<number, Record<string, number>> = {};
  for (const [rawHole, rawRow] of Object.entries(source)) {
    const hole = Number(rawHole);
    const row = recordValue(rawRow);
    if (!Number.isInteger(hole) || hole < 1 || hole > 18 || !row) continue;
    const clean = Object.fromEntries(Object.entries(row).filter(([, count]) => typeof count === "number" && Number.isInteger(count) && count >= 0));
    if (Object.keys(clean).length) rows[hole] = clean as Record<string, number>;
  }
  return rows;
}

export function clearActiveRoundStorage(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(STORAGE_KEYS.draft);
}

export function ensureHoleScoresAtPar(
  scores: Record<number, HoleScore>,
  hole: Pick<Course["holes"][number], "number" | "par">,
  players: Player[],
) {
  const current = scores[hole.number] || {};
  let changed = false;
  const nextRow: HoleScore = { ...current };
  for (const player of players) {
    if (typeof nextRow[player.id] !== "number") {
      nextRow[player.id] = hole.par;
      changed = true;
    }
  }
  return changed ? { ...scores, [hole.number]: nextRow } : scores;
}

export type DeletionDecision = "cancel" | "delete";

export function resolveHistoricalRoundDeletion(rounds: RoundSnapshot[], roundId: string, decision: DeletionDecision) {
  if (decision === "cancel") return rounds;
  return rounds.filter((round) => round.id !== roundId);
}

export function resolvePersonalHistoryDeletion(
  rounds: RoundSnapshot[],
  roundId: string,
  resultIndex: number,
  decision: DeletionDecision,
  updatedAt = new Date().toISOString(),
) {
  if (decision === "cancel") return rounds;
  return rounds.map((round) => {
    if (round.id !== roundId) return round;
    const personalResults = round.personalResults || [];
    const removed = personalResults[resultIndex];
    if (!removed) return round;
    const normalizeZero = (value: number) => Math.abs(value) < 0.001 ? 0 : value;
    const candidates = (round.personalBets || []).filter(bet => personalRivalKey(bet) === removed.rivalKey);
    const betId = removed.betId || removed.betSnapshot?.id || (candidates.length === 1 ? candidates[0].id : undefined);
    const ownerId = round.ownerId || round.players?.find(player => player.name === round.ownerName)?.id;
    const subtractResult = (balances: Record<string, number> | undefined) => {
      if (!balances || !ownerId) return balances;
      return { ...balances, [ownerId]: normalizeZero((balances[ownerId] || 0) - removed.totalMoney), [removed.rivalKey]: normalizeZero((balances[removed.rivalKey] || 0) + removed.totalMoney) };
    };
    const personalDetails = round.resultDetails?.personals as ReturnType<typeof calculatePersonalBets> | undefined;
    return {
      ...round,
      personalResults: personalResults.filter((_, index) => index !== resultIndex),
      personalBets: betId ? round.personalBets?.filter(bet => bet.id !== betId) : round.personalBets,
      playerBalances: subtractResult(round.playerBalances),
      categoryBalances: round.categoryBalances ? { ...round.categoryBalances, Personales: subtractResult(round.categoryBalances.Personales) || {} } : undefined,
      resultDetails: round.resultDetails ? { ...round.resultDetails, ...(personalDetails ? { personals: { ...personalDetails, balances: subtractResult(personalDetails.balances), results: personalDetails.results.filter(result => result.betId !== betId) } } : {}) } : undefined,
      categoryResults: {
        ...round.categoryResults,
        Personales: normalizeZero((round.categoryResults.Personales || 0) - removed.totalMoney),
      },
      betResult: normalizeZero(round.betResult - removed.totalMoney),
      netResult: normalizeZero(round.netResult - removed.totalMoney),
      updatedAt,
    };
  });
}

export function persistRoundHistory(storage: Pick<Storage, "setItem">, rounds: RoundSnapshot[]) {
  storage.setItem(STORAGE_KEYS.history, JSON.stringify(rounds));
}

export function mergeCoursesPreservingEdits(defaults: Course[], saved: Course[] | null | undefined) {
  const byId = new Map(defaults.map((course) => [course.id, { ...course, holes: course.holes.map((hole) => ({ ...hole })) }]));
  for (const course of Array.isArray(saved) ? saved : []) {
    if (!course?.id || !Array.isArray(course.holes) || course.holes.length !== 18) continue;
    byId.set(course.id, { ...course, holes: course.holes.map((hole) => ({ ...hole })) });
  }
  return Array.from(byId.values());
}

export function hasRoundProgress(draft: any) {
  if (!draft || typeof draft !== "object") return false;
  const namedPlayers = Array.isArray(draft.players) && draft.players.some((player: Player) => player.name?.trim());
  const scoreRows = recordValue(draft.scores);
  const enteredScores = scoreRows && Object.values(scoreRows).some((row) => {
    const values = recordValue(row);
    return values ? Object.values(values).some((score) => typeof score === "number") : false;
  });
  return Boolean(namedPlayers || enteredScores || draft.currentIndex > 0);
}

export function migrateDraftPressures(draft: any) {
  if (!draft || typeof draft !== "object") return draft;
  const startHole = draft.startHole === 10 ? 10 : 1;
  const foursome = draft.bets?.foursome;
  if (foursome) {
    foursome.pressureMultiplier ??= foursome.pressSecond9 ? 2 : 1;
    foursome.pressureNine ??= "holes_10_18";
  }
  if (Array.isArray(draft.personalBets)) {
    draft.personalBets = draft.personalBets.map((bet: any) => migratePersonalNassau(bet, startHole, draft.roundHoles === 9 ? 9 : 18));
  }
  return draft;
}

export type PrivateLeaderboardRow = {
  playerId: string;
  name: string;
  handicap: number | null;
  gross: number;
  net: number;
  relativeToPar: number;
  thru: number;
  finished: boolean;
};

export function privateLeaderboard(course: Course, players: Player[], scores: Record<number, HoleScore>, order: number[]) {
  return players.map((player): PrivateLeaderboardRow => {
    let gross = 0;
    let net = 0;
    let par = 0;
    let thru = 0;
    const roundHandicap = playingHandicap(Math.max(0, Number(player.handicap ?? 0)), 100, "half_up");
    for (const holeNumber of order) {
      const score = scores[holeNumber]?.[player.id];
      const hole = course.holes.find((candidate) => candidate.number === holeNumber);
      if (typeof score !== "number" || !hole) continue;
      gross += score;
      net += score - strokeAllowanceForHole(roundHandicap, hole.strokeIndex, "half_up");
      par += hole.par;
      thru += 1;
    }
    return { playerId: player.id, name: player.name, handicap: player.handicap, gross, net, relativeToPar: gross - par, thru, finished: thru === order.length };
  });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function roundSnapshotToCsv(round: RoundSnapshot) {
  const rows: unknown[][] = [["fecha", "campo", "jugador", "hcp", "hoyo", "score", "apuestas", "resultado_total", "gastos"]];
  const players = round.players || [{ id: "owner", name: round.ownerName, handicap: null }];
  for (const player of players) {
    const playerScores = round.scores || {};
    const holes = round.order?.length ? round.order : [""];
    for (const hole of holes) {
      rows.push([
        round.date,
        round.courseName,
        player.name,
        player.handicap ?? "",
        hole,
        typeof hole === "number" ? playerScores[hole]?.[player.id] ?? "" : "",
        JSON.stringify(round.categoryResults),
        player.id === players[0].id ? round.betResult : "",
        player.id === players[0].id ? round.expenseTotal : "",
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function pushUndoState<T>(stack: T[], state: T, limit = 15) {
  return [...stack.slice(-(Math.max(1, limit) - 1)), structuredClone(state)];
}

export function upsertFrequentPlayers(current: FrequentPlayer[], players: Player[], updatedAt: string) {
  const byName = new Map(current.map((player) => [player.name.trim().toLocaleLowerCase("es-MX"), player]));
  for (const player of players.filter((item) => item.name.trim())) {
    const key = player.name.trim().toLocaleLowerCase("es-MX");
    const previous = byName.get(key);
    byName.set(key, {
      id: previous?.id || player.id,
      name: player.name.trim(),
      handicap: player.handicap,
      uses: (previous?.uses || 0) + 1,
      updatedAt,
    });
  }
  return Array.from(byName.values()).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, "es-MX"));
}

export function buildHoleSummary(hole: number, players: Player[], scores: Record<number, HoleScore>, extras: string[] = []) {
  return [`Hoyo ${hole} guardado`, ...players.map((player) => `${player.name.trim() || "Sin nombre"} ${scores[hole]?.[player.id] ?? "—"}`), ...extras];
}

export function historicalGolfStats(rounds: RoundSnapshot[]) {
  const complete = rounds.flatMap((round) => {
    const course = round.courseSnapshot;
    const player = round.players?.find((candidate) => candidate.name === round.ownerName) || round.players?.[0];
    if (!course || !player || !round.scores || !round.order?.length) return [];
    const row = privateLeaderboard(course, [player], round.scores, round.order)[0];
    return row.finished ? [row] : [];
  });
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
  const categoryTotals: Record<string, number> = {};
  rounds.forEach((round) => Object.entries(round.categoryResults).forEach(([name, value]) => { categoryTotals[name] = (categoryTotals[name] || 0) + value; }));
  return {
    rounds: rounds.length,
    scoredRounds: complete.length,
    averageGross: average(complete.map((row) => row.gross)),
    averageNet: average(complete.map((row) => row.net)),
    bestRelativeToPar: complete.length ? Math.min(...complete.map((row) => row.relativeToPar)) : undefined,
    coursesPlayed: new Set(rounds.map((round) => round.courseName)).size,
    betBalance: rounds.reduce((sum, round) => sum + round.betResult, 0),
    categoryTotals,
  };
}
