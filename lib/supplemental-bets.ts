import {
  calculatePersonalBet,
  completedHole,
  netScore,
  normalizeHandicapMode,
} from "./engine";
import type {
  ChicagoBet,
  Course,
  DollarStrokeBet,
  HoleScore,
  IndividualNassauBet,
  IndividualPressuresBet,
  MinimumPuttsBet,
  PersonalBet,
  Player,
  PuttsByHole,
  SupplementalBet,
  TeamPressuresBet,
  VegasBet,
} from "./types";

const EPS = 1e-9;

export const SUPPLEMENTAL_BET_LABELS: Record<SupplementalBet["type"], string> = {
  individual_nassau: "Nassau individual",
  dollar_stroke: "Dollar a Stroke",
  individual_pressures: "Presiones individuales",
  team_pressures: "Presiones por parejas",
  chicago: "Chicago",
  vegas: "Vegas",
  minimum_putts: "Mínimo de Putts",
};

export type SupplementalPressureDetail = {
  label: string;
  startHole: number;
  endHole?: number;
  winnerIds: string[];
  loserIds: string[];
  value: number;
  open: boolean;
};

export type SupplementalBetResult = {
  betId: string;
  type: SupplementalBet["type"];
  label: string;
  complete: boolean;
  balances: Record<string, number>;
  lines: string[];
  pressures?: SupplementalPressureDetail[];
};

export type SupplementalPlayerAmount = {
  playerId: string;
  amountWonLost: number;
};

function zeroBalances(players: Player[]) {
  return Object.fromEntries(players.map((player) => [player.id, 0])) as Record<string, number>;
}

function addBalance(target: Record<string, number>, id: string, amount: number) {
  target[id] = (target[id] ?? 0) + amount;
}

function enabled<T extends { enabled?: boolean }>(bet: T) {
  return bet.enabled !== false;
}

function selectedPlayers(players: Player[], ids: string[]) {
  const selected = new Set(ids);
  return players.filter((player) => selected.has(player.id));
}

function directAllowance(strokes: number, strokeIndex: number) {
  const safe = Math.max(0, Math.trunc(strokes));
  const cycles = Math.floor(safe / 18);
  const remainder = safe % 18;
  return cycles + Number(strokeIndex <= remainder);
}

function headToHeadNet(
  bet: { advantageReceiverId?: string; advantageStrokes: number },
  playerId: string,
  gross: number,
  strokeIndex: number,
) {
  return gross - (bet.advantageReceiverId === playerId ? directAllowance(bet.advantageStrokes, strokeIndex) : 0);
}

function completeForPlayers(order: number[], scores: Record<number, HoleScore>, ids: string[]) {
  return order.length > 0 && order.every((hole) => completedHole(hole, scores, ids));
}

function pairwise<T>(items: T[]) {
  const pairs: Array<[T, T]> = [];
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) pairs.push([items[first], items[second]]);
  }
  return pairs;
}

function settleHeadToHead(balances: Record<string, number>, firstId: string, secondId: string, firstAmount: number) {
  addBalance(balances, firstId, firstAmount);
  addBalance(balances, secondId, -firstAmount);
}

function settleTeams(balances: Record<string, number>, winners: string[], losers: string[], value: number) {
  for (const winner of winners) {
    for (const loser of losers) {
      addBalance(balances, winner, value);
      addBalance(balances, loser, -value);
    }
  }
}

function calculateNassau(
  bet: IndividualNassauBet,
  players: Player[],
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
): SupplementalBetResult {
  const balances = zeroBalances(players);
  const playerA = players.find((player) => player.id === bet.playerAId);
  const playerB = players.find((player) => player.id === bet.playerBId);
  if (!enabled(bet) || !playerA || !playerB || playerA.id === playerB.id) {
    return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: false, balances, lines: [] };
  }
  const personal: PersonalBet = {
    id: bet.id,
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: playerB.id,
    rivalName: playerB.name,
    externalScores: {},
    baseValue: Math.max(0, bet.value),
    advantageReceiver: bet.advantageReceiverId === playerA.id ? "owner" : bet.advantageReceiverId === playerB.id ? "rival" : "none",
    advantageStrokes: Math.max(0, bet.advantageStrokes),
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: order[0] === 10 ? "holes_1_9" : "holes_10_18",
    nassauVersion: 2,
    carryEnabled: bet.carryEnabled,
    components: bet.components,
  };
  const result = calculatePersonalBet(personal, playerA.id, course, scores, order);
  settleHeadToHead(balances, playerA.id, playerB.id, result.totalMoney);
  const lines = result.liveComponents.map((component) => `${component.label}: ${component.leader === "tie" ? "Empate" : component.leader === "owner" ? playerA.name : playerB.name} · $${Math.abs(component.ownerMoney)}`);
  return {
    betId: bet.id,
    type: bet.type,
    label: `${SUPPLEMENTAL_BET_LABELS[bet.type]} · ${playerA.name} vs ${playerB.name}`,
    complete: completeForPlayers(order, scores, [playerA.id, playerB.id]),
    balances,
    lines,
  };
}

function calculateDollarStroke(
  bet: DollarStrokeBet,
  players: Player[],
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
): SupplementalBetResult {
  const balances = zeroBalances(players);
  const playerA = players.find((player) => player.id === bet.playerAId);
  const playerB = players.find((player) => player.id === bet.playerBId);
  if (!enabled(bet) || !playerA || !playerB || playerA.id === playerB.id) {
    return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: false, balances, lines: [] };
  }
  let totalA = 0;
  let totalB = 0;
  let played = 0;
  for (const holeNumber of order) {
    const hole = course.holes.find((candidate) => candidate.number === holeNumber);
    const grossA = scores[holeNumber]?.[playerA.id];
    const grossB = scores[holeNumber]?.[playerB.id];
    if (!hole || typeof grossA !== "number" || typeof grossB !== "number") continue;
    totalA += headToHeadNet(bet, playerA.id, grossA, hole.strokeIndex);
    totalB += headToHeadNet(bet, playerB.id, grossB, hole.strokeIndex);
    played += 1;
  }
  const difference = totalB - totalA;
  const amountA = difference * Math.max(0, bet.valuePerStroke);
  if (played > 0) settleHeadToHead(balances, playerA.id, playerB.id, amountA);
  return {
    betId: bet.id,
    type: bet.type,
    label: `${SUPPLEMENTAL_BET_LABELS[bet.type]} · ${playerA.name} vs ${playerB.name}`,
    complete: played === order.length,
    balances,
    lines: played ? [`Neto: ${playerA.name} ${totalA} · ${playerB.name} ${totalB}`, `Diferencia ${Math.abs(difference)} golpes · $${Math.abs(amountA)}`] : [],
  };
}

function pairNet(
  players: [Player, Player],
  player: Player,
  gross: number,
  course: Course,
  holeNumber: number,
  hcpPct: number,
  decimals: IndividualPressuresBet["decimals"],
) {
  const hole = course.holes.find((candidate) => candidate.number === holeNumber);
  return hole ? netScore(gross, player.id, hole.strokeIndex, players, hcpPct, normalizeHandicapMode(decimals)) : gross;
}

function calculateIndividualPressures(
  bet: IndividualPressuresBet,
  players: Player[],
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
): SupplementalBetResult {
  const balances = zeroBalances(players);
  const participants = selectedPlayers(players, bet.participantIds);
  const pressures: SupplementalPressureDetail[] = [];
  if (!enabled(bet) || participants.length < 2) return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: false, balances, lines: [], pressures };
  for (const [first, second] of pairwise(participants)) {
    let startHole = order[0];
    let firstWins = 0;
    let secondWins = 0;
    for (let index = 0; index < order.length; index += 1) {
      const holeNumber = order[index];
      if (!bet.carryEnabled && index === 9) startHole = holeNumber;
      const firstGross = scores[holeNumber]?.[first.id];
      const secondGross = scores[holeNumber]?.[second.id];
      if (typeof firstGross !== "number" || typeof secondGross !== "number") continue;
      const comparison: [Player, Player] = [first, second];
      const firstScore = pairNet(comparison, first, firstGross, course, holeNumber, bet.hcpPct, bet.decimals);
      const secondScore = pairNet(comparison, second, secondGross, course, holeNumber, bet.hcpPct, bet.decimals);
      if (Math.abs(firstScore - secondScore) < EPS) continue;
      const winner = firstScore < secondScore ? first : second;
      const loser = winner.id === first.id ? second : first;
      if (winner.id === first.id) firstWins += 1;
      else secondWins += 1;
      settleHeadToHead(balances, winner.id, loser.id, Math.max(0, bet.value));
      pressures.push({ label: `${first.name} vs ${second.name}`, startHole, endHole: holeNumber, winnerIds: [winner.id], loserIds: [loser.id], value: Math.max(0, bet.value), open: false });
      startHole = order[index + 1] ?? 0;
    }
    if (startHole && order.includes(startHole) && !completeForPlayers(order.slice(order.indexOf(startHole)), scores, [first.id, second.id])) {
      pressures.push({ label: `${first.name} vs ${second.name}`, startHole, winnerIds: [], loserIds: [], value: Math.max(0, bet.value), open: true });
    }
    if (bet.matchPlayEnabled && completeForPlayers(order, scores, [first.id, second.id]) && firstWins !== secondWins) {
      const winner = firstWins > secondWins ? first : second;
      const loser = winner.id === first.id ? second : first;
      settleHeadToHead(balances, winner.id, loser.id, Math.max(0, bet.value));
    }
  }
  return {
    betId: bet.id,
    type: bet.type,
    label: SUPPLEMENTAL_BET_LABELS[bet.type],
    complete: completeForPlayers(order, scores, participants.map((player) => player.id)),
    balances,
    pressures,
    lines: pressures.map((pressure, index) => `Presión ${index + 1} · H${pressure.startHole}${pressure.endHole ? `–H${pressure.endHole}` : " · abierta"}${pressure.winnerIds[0] ? ` · gana ${players.find((player) => player.id === pressure.winnerIds[0])?.name}` : ""}`),
  };
}

type PressureMatchup = { label: string; teamA: string[]; teamB: string[]; virtual?: "mudo" | "yoyo" };

function teamPressureMatchups(bet: TeamPressuresBet, participants: Player[]): PressureMatchup[] {
  if (bet.virtualMode !== "standard" && participants.length === 3) {
    const virtualMode: "mudo" | "yoyo" = bet.virtualMode;
    return participants.map((partner) => ({
      label: `${virtualMode === "mudo" ? "Mudo" : "Yo-Yo"} + ${partner.name}`,
      teamA: [partner.id],
      teamB: participants.filter((player) => player.id !== partner.id).map((player) => player.id),
      virtual: virtualMode,
    }));
  }
  const teamA = bet.teamA.filter((id) => participants.some((player) => player.id === id));
  return teamA.length === 2 ? [{ label: "Equipo A vs Equipo B", teamA, teamB: participants.filter((player) => !teamA.includes(player.id)).map((player) => player.id) }] : [];
}

function calculateTeamPressures(
  bet: TeamPressuresBet,
  players: Player[],
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
): SupplementalBetResult {
  const balances = zeroBalances(players);
  const participants = selectedPlayers(players, bet.participantIds);
  const matchups = teamPressureMatchups(bet, participants);
  const pressures: SupplementalPressureDetail[] = [];
  const abandoned = new Set(bet.abandonedPlayerIds || []);
  const grossFor = (holeNumber: number, playerId: string) => {
    const captured = scores[holeNumber]?.[playerId];
    return typeof captured === "number" ? captured : abandoned.has(playerId) ? Math.max(1, bet.abandonedMaxScore) : undefined;
  };
  const holeIsComplete = (holeNumber: number) => participants.every((player) => typeof grossFor(holeNumber, player.id) === "number");
  const matchIsComplete = order.length > 0 && order.every(holeIsComplete);
  if (!enabled(bet) || !matchups.length) return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: false, balances, lines: [], pressures };
  for (const matchup of matchups) {
    let startHole = order[0];
    for (let index = 0; index < order.length; index += 1) {
      const holeNumber = order[index];
      if (!bet.carryEnabled && index === 9) startHole = holeNumber;
      const hole = course.holes.find((candidate) => candidate.number === holeNumber);
      if (!hole || !holeIsComplete(holeNumber)) continue;
      const adjusted = Object.fromEntries(participants.map((player) => [player.id, netScore(grossFor(holeNumber, player.id) as number, player.id, hole.strokeIndex, participants, bet.hcpPct, normalizeHandicapMode(bet.decimals))])) as Record<string, number>;
      const virtualScore = matchup.virtual === "mudo" ? hole.par : matchup.virtual === "yoyo" ? adjusted[matchup.teamA[0]] : undefined;
      const teamAScores = [...matchup.teamA.map((id) => adjusted[id]), ...(virtualScore === undefined ? [] : [virtualScore])];
      const teamBScores = matchup.teamB.map((id) => adjusted[id]);
      if (!teamAScores.length || !teamBScores.length) continue;
      const low = Math.sign(Math.min(...teamBScores) - Math.min(...teamAScores));
      const high = Math.sign(Math.max(...teamBScores) - Math.max(...teamAScores));
      const outcome = bet.metric === "low" ? low : bet.metric === "high" ? high : low + high;
      if (outcome === 0) continue;
      const winners = outcome > 0 ? matchup.teamA : matchup.teamB;
      const losers = outcome > 0 ? matchup.teamB : matchup.teamA;
      settleTeams(balances, winners, losers, Math.max(0, bet.value));
      pressures.push({ label: matchup.label, startHole, endHole: holeNumber, winnerIds: winners, loserIds: losers, value: Math.max(0, bet.value), open: false });
      startHole = order[index + 1] ?? 0;
    }
    if (startHole && order.includes(startHole)) pressures.push({ label: matchup.label, startHole, winnerIds: [], loserIds: [], value: Math.max(0, bet.value), open: true });
  }
  return {
    betId: bet.id,
    type: bet.type,
    label: SUPPLEMENTAL_BET_LABELS[bet.type],
    complete: matchIsComplete,
    balances,
    pressures,
    lines: pressures.map((pressure, index) => `${pressure.label} · Presión ${index + 1} · H${pressure.startHole}${pressure.endHole ? `–H${pressure.endHole}` : " · abierta"}`),
  };
}

function chicagoPoints(gross: number, par: number, bet: ChicagoBet) {
  if (gross <= par - 1) return bet.points.birdieOrBetter;
  if (gross === par) return bet.points.par;
  if (gross === par + 1) return bet.points.bogey;
  return bet.points.doubleBogeyOrWorse;
}

function calculateChicago(bet: ChicagoBet, players: Player[], course: Course, scores: Record<number, HoleScore>, order: number[]): SupplementalBetResult {
  const balances = zeroBalances(players);
  const participants = selectedPlayers(players, bet.participantIds);
  const complete = enabled(bet) && participants.length >= 2 && completeForPlayers(order, scores, participants.map((player) => player.id));
  if (!complete) return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: false, balances, lines: [] };
  const chicagoBalances = Object.fromEntries(participants.map((player) => {
    const points = order.reduce((total, holeNumber) => {
      const hole = course.holes.find((candidate) => candidate.number === holeNumber)!;
      return total + chicagoPoints(scores[holeNumber][player.id] as number, hole.par, bet);
    }, 0);
    const quota = bet.quotaBase - Number(player.handicap ?? 0);
    return [player.id, { points, quota, balance: points - quota }];
  })) as Record<string, { points: number; quota: number; balance: number }>;
  for (const [first, second] of pairwise(participants)) {
    const amount = (chicagoBalances[first.id].balance - chicagoBalances[second.id].balance) * Math.max(0, bet.valuePerPoint);
    settleHeadToHead(balances, first.id, second.id, amount);
  }
  return {
    betId: bet.id,
    type: bet.type,
    label: SUPPLEMENTAL_BET_LABELS[bet.type],
    complete,
    balances,
    lines: participants.map((player) => `${player.name}: ${chicagoBalances[player.id].points} puntos − cuota ${chicagoBalances[player.id].quota} = ${chicagoBalances[player.id].balance > 0 ? "+" : ""}${chicagoBalances[player.id].balance}`),
  };
}

function vegasPairing(bet: VegasBet, participants: Player[], holeIndex: number) {
  const baseA = bet.teamA.filter((id) => participants.some((player) => player.id === id));
  const baseB = participants.filter((player) => !baseA.includes(player.id)).map((player) => player.id);
  if (baseA.length !== 2 || baseB.length !== 2) return null;
  const pairings = [
    { teamA: [baseA[0], baseA[1]], teamB: [baseB[0], baseB[1]] },
    { teamA: [baseA[0], baseB[0]], teamB: [baseA[1], baseB[1]] },
    { teamA: [baseA[0], baseB[1]], teamB: [baseA[1], baseB[0]] },
  ];
  const pairingIndex = bet.rotation === "fixed" ? 0 : bet.rotation === "each_hole" ? holeIndex % 3 : Math.floor(holeIndex / bet.blockSize) % 3;
  return pairings[pairingIndex];
}

function vegasNumber(first: number, second: number, flip: boolean) {
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  return flip ? high * 10 + low : low * 10 + high;
}

function calculateVegas(bet: VegasBet, players: Player[], course: Course, scores: Record<number, HoleScore>, order: number[]): SupplementalBetResult {
  const balances = zeroBalances(players);
  const participants = selectedPlayers(players, bet.participantIds);
  const lines: string[] = [];
  if (!enabled(bet) || participants.length !== 4) return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: false, balances, lines };
  for (let index = 0; index < order.length; index += 1) {
    const holeNumber = order[index];
    const hole = course.holes.find((candidate) => candidate.number === holeNumber);
    const pairing = vegasPairing(bet, participants, index);
    if (!hole || !pairing || !completedHole(holeNumber, scores, participants.map((player) => player.id))) continue;
    const adjusted = Object.fromEntries(participants.map((player) => [player.id, Math.round(netScore(scores[holeNumber][player.id] as number, player.id, hole.strokeIndex, participants, bet.hcpPct, normalizeHandicapMode(bet.decimals)))])) as Record<string, number>;
    const grossLowA = Math.min(...pairing.teamA.map((id) => scores[holeNumber][id] as number));
    const grossLowB = Math.min(...pairing.teamB.map((id) => scores[holeNumber][id] as number));
    const penalizeA = bet.birdiePenalty && grossLowB < hole.par && grossLowA > hole.par;
    const penalizeB = bet.birdiePenalty && grossLowA < hole.par && grossLowB > hole.par;
    const numberA = vegasNumber(adjusted[pairing.teamA[0]], adjusted[pairing.teamA[1]], penalizeA);
    const numberB = vegasNumber(adjusted[pairing.teamB[0]], adjusted[pairing.teamB[1]], penalizeB);
    const difference = numberB - numberA;
    if (difference !== 0) {
      const winners = difference > 0 ? pairing.teamA : pairing.teamB;
      const losers = difference > 0 ? pairing.teamB : pairing.teamA;
      settleTeams(balances, winners, losers, Math.abs(difference) * Math.max(0, bet.valuePerUnit));
    }
    lines.push(`H${holeNumber}: ${numberA} vs ${numberB} · ${Math.abs(difference)} unidades`);
  }
  return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: completeForPlayers(order, scores, participants.map((player) => player.id)), balances, lines };
}

function calculateMinimumPutts(bet: MinimumPuttsBet, players: Player[], putts: PuttsByHole, order: number[]): SupplementalBetResult {
  const balances = zeroBalances(players);
  const participants = selectedPlayers(players, bet.participantIds);
  const holes = order.slice(0, Math.min(bet.holes, order.length));
  const complete = enabled(bet) && participants.length >= 2 && holes.length === bet.holes && holes.every((hole) => participants.every((player) => typeof putts[hole]?.[player.id] === "number"));
  if (!complete) return { betId: bet.id, type: bet.type, label: SUPPLEMENTAL_BET_LABELS[bet.type], complete: false, balances, lines: [] };
  const totals = Object.fromEntries(participants.map((player) => [player.id, holes.reduce((total, hole) => total + Number(putts[hole]?.[player.id] ?? 0), 0)])) as Record<string, number>;
  const lowest = Math.min(...Object.values(totals));
  const winners = participants.filter((player) => totals[player.id] === lowest);
  if (winners.length !== participants.length) {
    const losers = participants.filter((player) => totals[player.id] !== lowest);
    const pot = losers.length * Math.max(0, bet.ante);
    for (const loser of losers) addBalance(balances, loser.id, -Math.max(0, bet.ante));
    for (const winner of winners) addBalance(balances, winner.id, pot / winners.length);
  }
  return {
    betId: bet.id,
    type: bet.type,
    label: SUPPLEMENTAL_BET_LABELS[bet.type],
    complete,
    balances,
    lines: participants.map((player) => `${player.name}: ${totals[player.id]} putts${winners.some((winner) => winner.id === player.id) ? " · ganador" : ""}`),
  };
}

export function calculateSupplementalBets(
  bets: SupplementalBet[],
  players: Player[],
  course: Course,
  scores: Record<number, HoleScore>,
  putts: PuttsByHole,
  order: number[],
) {
  const balances = zeroBalances(players);
  const rawResults = bets.filter(enabled).map((bet): SupplementalBetResult => {
    switch (bet.type) {
      case "individual_nassau": return calculateNassau(bet, players, course, scores, order);
      case "dollar_stroke": return calculateDollarStroke(bet, players, course, scores, order);
      case "individual_pressures": return calculateIndividualPressures(bet, players, course, scores, order);
      case "team_pressures": return calculateTeamPressures(bet, players, course, scores, order);
      case "chicago": return calculateChicago(bet, players, course, scores, order);
      case "vegas": return calculateVegas(bet, players, course, scores, order);
      case "minimum_putts": return calculateMinimumPutts(bet, players, putts, order);
    }
  });
  const results = rawResults.map((result) => ({
    ...result,
    playerAmounts: Object.entries(result.balances).map(([playerId, amountWonLost]): SupplementalPlayerAmount => ({ playerId, amountWonLost })),
  }));
  for (const result of results) for (const [id, amount] of Object.entries(result.balances)) addBalance(balances, id, amount);
  return { balances, results };
}

export function createSupplementalBet(type: SupplementalBet["type"], players: Player[], id: string): SupplementalBet {
  const ids = players.map((player) => player.id);
  const headToHead = { playerAId: ids[0] ?? "", playerBId: ids[1] ?? "", advantageStrokes: 0 };
  switch (type) {
    case "individual_nassau": return { id, type, enabled: true, ...headToHead, value: 100, carryEnabled: false, components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true } };
    case "dollar_stroke": return { id, type, enabled: true, ...headToHead, valuePerStroke: 10 };
    case "individual_pressures": return { id, type, enabled: true, participantIds: ids, value: 100, hcpPct: 100, decimals: "half_up", carryEnabled: true, matchPlayEnabled: false };
    case "team_pressures": return { id, type, enabled: true, participantIds: ids.slice(0, ids.length === 3 ? 3 : 4), abandonedPlayerIds: [], teamA: ids.slice(0, 2), metric: "low_high", virtualMode: ids.length === 3 ? "mudo" : "standard", value: 100, hcpPct: 100, decimals: "half_up", carryEnabled: true, abandonedMaxScore: 9 };
    case "chicago": return { id, type, enabled: true, participantIds: ids, quotaBase: 39, valuePerPoint: 10, points: { birdieOrBetter: 4, par: 2, bogey: 1, doubleBogeyOrWorse: 0 } };
    case "vegas": return { id, type, enabled: true, participantIds: ids.slice(0, 4), teamA: ids.slice(0, 2), valuePerUnit: 10, rotation: "fixed", blockSize: 3, hcpPct: 100, decimals: "half_up", birdiePenalty: false };
    case "minimum_putts": return { id, type, enabled: true, participantIds: ids, ante: 50, holes: 18 };
  }
}

export function normalizeSupplementalBets(value: unknown): SupplementalBet[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SupplementalBet => Boolean(item && typeof item === "object" && typeof (item as SupplementalBet).id === "string" && Object.hasOwn(SUPPLEMENTAL_BET_LABELS, (item as SupplementalBet).type))).map((item) => ({ ...item, enabled: item.enabled !== false }));
}

export function supplementalBalancesAreZero(result: SupplementalBetResult) {
  return Math.abs(Object.values(result.balances).reduce((total, amount) => total + amount, 0)) < EPS;
}

export function supplementalBetValue(bet: SupplementalBet) {
  switch (bet.type) {
    case "individual_nassau": return bet.value;
    case "dollar_stroke": return bet.valuePerStroke;
    case "individual_pressures":
    case "team_pressures": return bet.value;
    case "chicago": return bet.valuePerPoint;
    case "vegas": return bet.valuePerUnit;
    case "minimum_putts": return bet.ante;
  }
}
