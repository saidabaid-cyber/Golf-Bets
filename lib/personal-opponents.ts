import { calculateSupplementalBets } from "./supplemental-bets";
import type { Course, PersonalOpponentResult, Player, PuttsByHole, RoundSnapshot, SupplementalBet } from "./types";

type CanonicalPersonalResult = { betId: string; rivalId: string; totalMoney: number };

const PERSONAL_MODE_LABELS: Record<PersonalOpponentResult["mode"], string> = {
  nassau_individual: "Nassau individual",
  dollar_stroke: "Dollar a Stroke",
  individual_pressures: "Presiones individuales",
};

function opponentName(players: Player[], id: string, fallback = "Contrincante") {
  return players.find((player) => player.id === id)?.name?.trim() || fallback;
}

export function buildPersonalOpponentResults({
  ownerId,
  players,
  course,
  scores,
  putts,
  order,
  canonicalResults,
  personalBets,
  supplementalBets,
}: {
  ownerId: string;
  players: Player[];
  course: Course;
  scores: Record<number, Record<string, number | null>>;
  putts: PuttsByHole;
  order: number[];
  canonicalResults: CanonicalPersonalResult[];
  personalBets: Array<{ id: string; rivalName: string }>;
  supplementalBets: SupplementalBet[];
}): PersonalOpponentResult[] {
  const entries: PersonalOpponentResult[] = canonicalResults.map((result) => ({
    betId: result.betId,
    mode: "nassau_individual",
    modeLabel: PERSONAL_MODE_LABELS.nassau_individual,
    opponentId: result.rivalId,
    opponentName: opponentName(players, result.rivalId, personalBets.find((bet) => bet.id === result.betId)?.rivalName),
    amount: result.totalMoney,
  }));

  for (const bet of supplementalBets.filter((item) => item.enabled !== false)) {
    if (bet.type === "dollar_stroke" || bet.type === "individual_nassau") {
      if (bet.playerAId !== ownerId && bet.playerBId !== ownerId) continue;
      const opponentId = bet.playerAId === ownerId ? bet.playerBId : bet.playerAId;
      if (!opponentId || opponentId === ownerId) continue;
      const result = calculateSupplementalBets([bet], players, course, scores, putts, order).results[0];
      if (!result) continue;
      entries.push({
        betId: bet.id,
        mode: bet.type === "individual_nassau" ? "nassau_individual" : "dollar_stroke",
        modeLabel: PERSONAL_MODE_LABELS[bet.type === "individual_nassau" ? "nassau_individual" : "dollar_stroke"],
        opponentId,
        opponentName: opponentName(players, opponentId),
        amount: result.balances[ownerId] ?? 0,
      });
      continue;
    }
    if (bet.type !== "individual_pressures" || !bet.participantIds.includes(ownerId)) continue;
    for (const opponentId of bet.participantIds.filter((id) => id !== ownerId)) {
      const pairBet = { ...bet, participantIds: [ownerId, opponentId] };
      const result = calculateSupplementalBets([pairBet], players, course, scores, putts, order).results[0];
      if (!result) continue;
      entries.push({
        betId: bet.id,
        mode: "individual_pressures",
        modeLabel: PERSONAL_MODE_LABELS.individual_pressures,
        opponentId,
        opponentName: opponentName(players, opponentId),
        amount: result.balances[ownerId] ?? 0,
      });
    }
  }
  return entries;
}

export type PersonalOpponentRound = {
  roundId: string;
  date: string;
  courseName: string;
  total: number;
  entries: PersonalOpponentResult[];
};

export type PersonalOpponentHistory = {
  key: string;
  name: string;
  wonMoney: number;
  lostMoney: number;
  total: number;
  rounds: PersonalOpponentRound[];
};

function legacyEntries(round: RoundSnapshot): PersonalOpponentResult[] {
  const canonical = (round.personalResults || []).map((result) => ({
    betId: result.betId || `${round.id}:${result.rivalKey}`,
    mode: "nassau_individual" as const,
    modeLabel: PERSONAL_MODE_LABELS.nassau_individual,
    opponentId: result.rivalTemplateId || result.rivalKey,
    opponentName: result.rivalName,
    amount: result.totalMoney,
  }));
  if (!round.ownerId || !round.players || !round.courseSnapshot || !round.scores || !round.order || !round.supplementalBets) return canonical;
  const supplemental = buildPersonalOpponentResults({
    ownerId: round.ownerId,
    players: round.players,
    course: round.courseSnapshot,
    scores: round.scores,
    putts: round.putts || {},
    order: round.order,
    canonicalResults: [],
    personalBets: [],
    supplementalBets: round.supplementalBets,
  });
  return [...canonical, ...supplemental];
}

export function buildPersonalOpponentHistory(history: RoundSnapshot[]): PersonalOpponentHistory[] {
  const newestById = new Map<string, RoundSnapshot>();
  for (const round of [...history].sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date))) newestById.set(round.id, round);
  const rivals = new Map<string, PersonalOpponentHistory>();
  for (const round of [...newestById.values()].sort((a, b) => b.date.localeCompare(a.date))) {
    const entries = round.personalOpponentResults || legacyEntries(round);
    const byOpponent = new Map<string, PersonalOpponentResult[]>();
    for (const entry of entries) {
      const grouped = byOpponent.get(entry.opponentId) || [];
      grouped.push(entry);
      byOpponent.set(entry.opponentId, grouped);
    }
    for (const [opponentId, opponentEntries] of byOpponent) {
      const key = `${round.ownerId || round.ownerName}::${opponentId}`;
      const total = opponentEntries.reduce((sum, entry) => sum + entry.amount, 0);
      const rival = rivals.get(key) || { key, name: opponentEntries[0].opponentName, wonMoney: 0, lostMoney: 0, total: 0, rounds: [] };
      rival.wonMoney += opponentEntries.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
      rival.lostMoney += opponentEntries.reduce((sum, entry) => sum + Math.max(0, -entry.amount), 0);
      rival.total += total;
      rival.rounds.push({ roundId: round.id, date: round.date, courseName: round.courseName, total, entries: opponentEntries });
      rivals.set(key, rival);
    }
  }
  return [...rivals.values()].sort((a, b) => b.rounds[0].date.localeCompare(a.rounds[0].date) || a.name.localeCompare(b.name, "es-MX"));
}

export function groupCurrentPersonalResults(entries: PersonalOpponentResult[]) {
  return buildPersonalOpponentHistory([{
    id: "current",
    date: "9999-12-31",
    courseName: "Ronda actual",
    teeName: "",
    ownerName: "",
    betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 0,
    categoryResults: {},
    personalOpponentResults: entries,
  }]);
}
