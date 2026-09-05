import { calculateSupplementalBets } from "./supplemental-bets";
import type { Course, PersonalBet, PersonalOpponentResult, Player, PuttsByHole, RoundHandicapBasis, RoundSnapshot, SupplementalBet } from "./types";
import { normalizeRoundHandicapBasis } from "./handicap-base";

type CanonicalPersonalResult = {
  betId: string;
  rivalId: string;
  totalMoney: number;
  liveComponents?: Array<{
    key: string;
    label: string;
    kind: "match" | "medal";
    complete: boolean;
    playedHoles: number;
    ownerMoney: number;
    matchState: number;
    medalDiff: number;
    ownerNetTotal: number;
    rivalNetTotal: number;
    stake: number;
  }>;
};

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
  handicapBasis = "relative",
}: {
  ownerId: string;
  players: Player[];
  course: Course;
  scores: Record<number, Record<string, number | null>>;
  putts: PuttsByHole;
  order: number[];
  canonicalResults: CanonicalPersonalResult[];
  personalBets: PersonalBet[];
  supplementalBets: SupplementalBet[];
  handicapBasis?: RoundHandicapBasis;
}): PersonalOpponentResult[] {
  const entries: PersonalOpponentResult[] = canonicalResults.map((result) => {
    const config = personalBets.find((bet) => bet.id === result.betId);
    const owner = opponentName(players, ownerId, "Jugador principal");
    const rival = opponentName(players, result.rivalId, config?.rivalName);
    const components = result.liveComponents || [];
    const played = components.some((component) => component.playedHoles > 0);
    const amount = components.length ? components.reduce((sum, component) => sum + component.ownerMoney, 0) : result.totalMoney;
    return {
      betId: result.betId,
      mode: "nassau_individual",
      modeLabel: PERSONAL_MODE_LABELS.nassau_individual,
      opponentId: result.rivalId,
      opponentName: rival,
      amount,
      status: !played ? "pending" : components.every((component) => component.complete) ? "final" : "partial",
      detailLines: config ? [
        `Participantes: ${owner} y ${rival}`,
        `Monto pactado: $${Math.max(0, config.baseValue)}`,
        config.advantageStrokes > 0 ? `Ventaja pactada: ${config.advantageStrokes} golpes para ${config.advantageReceiver === "owner" ? owner : rival}` : "Ventaja pactada: sin golpes",
        `Carry: ${config.carryEnabled ? "sí" : "no"} · Presión: ${config.pressureMultiplier || config.back9Multiplier || 1}x`,
      ] : undefined,
      components: components.map((component) => ({
        key: component.key,
        label: component.label,
        amount: component.ownerMoney,
        status: component.playedHoles === 0 ? "pending" : component.complete ? "final" : "partial",
        lines: [
          `${component.playedHoles} hoyos considerados`,
          component.kind === "match"
            ? `Match: ${component.matchState === 0 ? "AS" : `${component.matchState > 0 ? owner : rival} +${Math.abs(component.matchState)}`}`
            : `Medal neto: ${owner} ${component.ownerNetTotal} · ${rival} ${component.rivalNetTotal} · diferencia ${Math.abs(component.medalDiff)}`,
          `Monto de este componente: $${component.stake}`,
        ],
      })),
    };
  });

  for (const bet of supplementalBets.filter((item) => item.enabled !== false)) {
    if (bet.type === "dollar_stroke" || bet.type === "individual_nassau") {
      if (bet.playerAId !== ownerId && bet.playerBId !== ownerId) continue;
      const opponentId = bet.playerAId === ownerId ? bet.playerBId : bet.playerAId;
      if (!opponentId || opponentId === ownerId) continue;
      const result = calculateSupplementalBets([bet], players, course, scores, putts, order, handicapBasis).results[0];
      if (!result) continue;
      entries.push({
        betId: bet.id,
        mode: bet.type === "individual_nassau" ? "nassau_individual" : "dollar_stroke",
        modeLabel: PERSONAL_MODE_LABELS[bet.type === "individual_nassau" ? "nassau_individual" : "dollar_stroke"],
        opponentId,
        opponentName: opponentName(players, opponentId),
        amount: result.balances[ownerId] ?? 0,
        status: !result.audit?.playedHoles ? "pending" : result.complete ? "final" : "partial",
        detailLines: result.audit?.detailLines || result.lines,
        components: result.audit?.components.map((component) => ({
          key: component.key,
          label: component.label,
          amount: component.amounts[ownerId] ?? 0,
          status: component.status,
          lines: component.lines,
        })),
      });
      continue;
    }
    if (bet.type !== "individual_pressures" || !bet.participantIds.includes(ownerId)) continue;
    for (const opponentId of bet.participantIds.filter((id) => id !== ownerId)) {
      const pairBet = { ...bet, participantIds: [ownerId, opponentId] };
      const result = calculateSupplementalBets([pairBet], players, course, scores, putts, order, handicapBasis).results[0];
      if (!result) continue;
      entries.push({
        betId: bet.id,
        mode: "individual_pressures",
        modeLabel: PERSONAL_MODE_LABELS.individual_pressures,
        opponentId,
        opponentName: opponentName(players, opponentId),
        amount: result.balances[ownerId] ?? 0,
        status: !result.audit?.playedHoles ? "pending" : result.complete ? "final" : "partial",
        detailLines: result.audit?.detailLines || result.lines,
        components: result.audit?.components.map((component) => ({
          key: component.key,
          label: component.label,
          amount: component.amounts[ownerId] ?? 0,
          status: component.status,
          lines: component.lines,
        })),
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
    handicapBasis: normalizeRoundHandicapBasis(round.handicapBasis),
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
