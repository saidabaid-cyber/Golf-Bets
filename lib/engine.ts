import {
  BallFriendHole,
  BetConfig,
  Course,
  DecimalMode,
  Expense,
  FoursomeSegment,
  HoleScore,
  PersonalBet,
  Player,
  Transfer,
  UnitEvent,
} from "./types";

const EPS = 1e-9;

export function playOrder(startHole: 1 | 10 = 1) {
  return startHole === 1
    ? Array.from({ length: 18 }, (_, i) => i + 1)
    : [...Array.from({ length: 9 }, (_, i) => i + 10), ...Array.from({ length: 9 }, (_, i) => i + 1)];
}

export function playersByIds(players: Player[], ids: string[]) {
  const wanted = new Set(ids);
  return players.filter((p) => wanted.has(p.id));
}

export function baseHandicaps(players: Player[]) {
  if (!players.length) return {} as Record<string, number>;
  const best = Math.min(...players.map((p) => p.handicap));
  return Object.fromEntries(players.map((p) => [p.id, p.handicap - best])) as Record<string, number>;
}

export function playingHandicap(base: number, pct: number, mode: DecimalMode) {
  const raw = (base * pct) / 100;
  return mode === "round" ? Math.round(raw) : raw;
}

export function strokeAllowanceForHole(playingHcp: number, strokeIndex: number, mode: DecimalMode) {
  const safe = Math.max(0, playingHcp);
  const full = Math.floor(safe);
  const fraction = safe - full;
  const cycles = Math.floor(full / 18);
  const remainder = full % 18;
  let allowance = cycles + (strokeIndex <= remainder ? 1 : 0);

  if (mode === "partial" && fraction > EPS) {
    const nextIndex = remainder + 1;
    if (strokeIndex === nextIndex) allowance += fraction;
  }
  return allowance;
}

export function netScore(
  gross: number,
  playerId: string,
  holeStrokeIndex: number,
  comparisonPlayers: Player[],
  pct: number,
  decimals: DecimalMode,
) {
  const bases = baseHandicaps(comparisonPlayers);
  const ph = playingHandicap(bases[playerId] ?? 0, pct, decimals);
  return gross - strokeAllowanceForHole(ph, holeStrokeIndex, decimals);
}

export function completedHole(
  hole: number,
  scores: Record<number, HoleScore>,
  participantIds: string[],
) {
  const row = scores[hole];
  return !!row && participantIds.length > 0 && participantIds.every((id) => typeof row[id] === "number");
}

export function winnerIdsForHole(
  hole: number,
  course: Course,
  scores: Record<number, HoleScore>,
  comparisonPlayers: Player[],
  pct: number,
  decimals: DecimalMode,
) {
  const ids = comparisonPlayers.map((p) => p.id);
  if (!completedHole(hole, scores, ids)) return [] as string[];
  const holeDef = course.holes.find((h) => h.number === hole);
  if (!holeDef) return [] as string[];
  const row = scores[hole];
  const nets = comparisonPlayers.map((p) => ({
    id: p.id,
    net: netScore(row[p.id] as number, p.id, holeDef.strokeIndex, comparisonPlayers, pct, decimals),
  }));
  const best = Math.min(...nets.map((x) => x.net));
  return nets.filter((x) => Math.abs(x.net - best) < EPS).map((x) => x.id);
}

export type RabbitEvent = {
  hole: number;
  type: "grab" | "hold" | "lose" | "win" | "free" | "accumulate";
  playerId?: string;
  count?: number;
};

export function calculateRabbits(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["rabbits"],
  order: number[],
) {
  const participants = playersByIds(allPlayers, cfg.participantIds);
  const won = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const events: RabbitEvent[] = [];
  if (!cfg.enabled || participants.length < 2) return { events, won, pending: 0 };

  let rabbitHole: 1 | 2 | 3 = 1;
  let holder: string | null = null;
  let pending = 1;

  for (const hole of order) {
    const winners = winnerIdsForHole(hole, course, scores, participants, cfg.hcpPct, cfg.decimals);
    if (!winners.length) continue;

    const uniqueWinner = winners.length === 1 ? winners[0] : null;
    let rabbitWonBy: string | null = null;

    if (rabbitHole === 1) {
      if (uniqueWinner) {
        holder = uniqueWinner;
        events.push({ hole, type: "grab", playerId: holder });
      } else {
        holder = null;
        events.push({ hole, type: "free" });
      }
      rabbitHole = 2;
      continue;
    }

    if (rabbitHole === 2) {
      if (holder) {
        if (winners.includes(holder)) {
          if (uniqueWinner === holder) {
            rabbitWonBy = holder;
          } else {
            events.push({ hole, type: "hold", playerId: holder });
          }
        } else {
          events.push({ hole, type: "lose", playerId: holder });
          holder = null;
        }
      } else if (uniqueWinner) {
        holder = uniqueWinner;
        events.push({ hole, type: "grab", playerId: holder });
      } else {
        events.push({ hole, type: "free" });
      }

      if (rabbitWonBy) {
        won[rabbitWonBy] = (won[rabbitWonBy] ?? 0) + pending;
        events.push({ hole, type: "win", playerId: rabbitWonBy, count: pending });
        pending = 1;
        holder = null;
        rabbitHole = 1;
      } else {
        rabbitHole = 3;
      }
      continue;
    }

    if (holder) {
      if (winners.includes(holder)) rabbitWonBy = holder;
      else events.push({ hole, type: "lose", playerId: holder });
    } else if (uniqueWinner) {
      rabbitWonBy = uniqueWinner;
    } else {
      events.push({ hole, type: "free" });
    }

    if (rabbitWonBy) {
      won[rabbitWonBy] = (won[rabbitWonBy] ?? 0) + pending;
      events.push({ hole, type: "win", playerId: rabbitWonBy, count: pending });
      pending = 1;
    } else if (cfg.accumulate) {
      pending += 1;
      events.push({ hole, type: "accumulate", count: pending });
    } else {
      pending = 1;
    }
    holder = null;
    rabbitHole = 1;
  }

  return { events, won, pending };
}

export function calculateSkins(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["skins"],
  order: number[],
) {
  const participants = playersByIds(allPlayers, cfg.participantIds);
  const won = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const events: { hole: number; winnerId?: string; count: number; carry: number }[] = [];
  if (!cfg.enabled || participants.length < 2) return { won, events, carry: 0 };

  let carry = 1;
  for (const hole of order) {
    const winners = winnerIdsForHole(hole, course, scores, participants, cfg.hcpPct, cfg.decimals);
    if (!winners.length) continue;
    if (winners.length === 1) {
      won[winners[0]] = (won[winners[0]] ?? 0) + carry;
      events.push({ hole, winnerId: winners[0], count: carry, carry: 1 });
      carry = 1;
    } else {
      if (cfg.accumulate) carry += 1;
      events.push({ hole, count: 0, carry });
    }
  }
  return { won, events, carry };
}

function zeroBalances(players: Player[]) {
  return Object.fromEntries(players.map((p) => [p.id, 0])) as Record<string, number>;
}

export function payoutWinnerTakesFromAll(
  participants: Player[],
  wins: Record<string, number>,
  unitValue: number,
) {
  const balances = zeroBalances(participants);
  for (const winner of participants) {
    const count = wins[winner.id] ?? 0;
    if (!count) continue;
    const perRival = count * unitValue;
    for (const rival of participants) {
      if (rival.id === winner.id) continue;
      balances[winner.id] += perRival;
      balances[rival.id] -= perRival;
    }
  }
  return balances;
}

export function calculateUnits(
  allPlayers: Player[],
  unitEvents: UnitEvent[],
  cfg: BetConfig["units"],
) {
  const participants = playersByIds(allPlayers, cfg.participantIds);
  const positive = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const negative = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const net = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const allowed = new Set(cfg.participantIds);

  for (const e of unitEvents) {
    if (!allowed.has(e.playerId)) continue;
    if (e.amount >= 0) positive[e.playerId] += e.amount;
    else negative[e.playerId] += Math.abs(e.amount);
    net[e.playerId] += e.amount;
  }

  const balances = zeroBalances(participants);
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i].id;
      const b = participants[j].id;
      const delta = (net[a] - net[b]) * cfg.value;
      balances[a] += delta;
      balances[b] -= delta;
    }
  }
  return { positive, negative, net, balances };
}

export function segmentDefinitions(order: number[], size: 3 | 6 | 9 | 18): FoursomeSegment[] {
  const result: FoursomeSegment[] = [];
  for (let start = 0; start < order.length; start += size) {
    result.push({
      id: `seg-${start}`,
      startIndex: start,
      endIndex: Math.min(order.length - 1, start + size - 1),
      basePair: [],
    });
  }
  return result;
}

export function opponentPairs(participantIds: string[], basePair: string[]) {
  if (basePair.length !== 2) return [] as [string, string][];
  const base = new Set(basePair);
  const rest = participantIds.filter((id) => !base.has(id));
  const pairs: [string, string][] = [];
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) pairs.push([rest[i], rest[j]]);
  }
  return pairs;
}

export type FoursomeMatchResult = {
  segmentId: string;
  startHole: number;
  endHole: number;
  basePair: [string, string];
  opponentPair: [string, string];
  pointDiff: number;
  fixedMoney: number;
  pointMoney: number;
  totalMoney: number;
  complete: boolean;
  holePoints: { hole: number; points: number }[];
};

function teamHolePoints(teamA: number[], teamB: number[]) {
  const a = [...teamA].sort((x, y) => x - y);
  const b = [...teamB].sort((x, y) => x - y);
  const low = a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0;
  const high = a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0;
  return low + high;
}

export function calculateFoursomes(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["foursome"],
  segments: FoursomeSegment[],
  order: number[],
) {
  const participants = playersByIds(allPlayers, cfg.participantIds);
  const balances = zeroBalances(participants);
  const matches: FoursomeMatchResult[] = [];
  if (!cfg.enabled || participants.length < 4) return { balances, matches };

  for (const segment of segments) {
    if (segment.basePair.length !== 2) continue;
    const opponents = opponentPairs(cfg.participantIds, segment.basePair);
    const holes = order.slice(segment.startIndex, segment.endIndex + 1);

    for (const opponent of opponents) {
      const ids = [...segment.basePair, ...opponent];
      const matchPlayers = playersByIds(allPlayers, ids);
      const holePoints: { hole: number; points: number }[] = [];
      let complete = true;
      let pointDiff = 0;

      for (const hole of holes) {
        if (!completedHole(hole, scores, ids)) {
          complete = false;
          continue;
        }
        const hd = course.holes.find((x) => x.number === hole);
        if (!hd) continue;
        const row = scores[hole];
        const aScores = (segment.basePair as [string, string]).map((id) =>
          netScore(row[id] as number, id, hd.strokeIndex, matchPlayers, cfg.hcpPct, cfg.decimals),
        );
        const bScores = opponent.map((id) =>
          netScore(row[id] as number, id, hd.strokeIndex, matchPlayers, cfg.hcpPct, cfg.decimals),
        );
        const points = teamHolePoints(aScores, bScores);
        pointDiff += points;
        holePoints.push({ hole, points });
      }

      const sign = pointDiff > 0 ? 1 : pointDiff < 0 ? -1 : 0;
      const fixedMoney = complete && (cfg.mode === "fixed" || cfg.mode === "fixed_points") ? sign * cfg.fixedValue : 0;
      const pointMoney = complete && (cfg.mode === "points" || cfg.mode === "fixed_points") ? pointDiff * cfg.pointValue : 0;
      const totalMoney = fixedMoney + pointMoney;

      if (complete) {
        for (const id of segment.basePair as [string, string]) balances[id] = (balances[id] ?? 0) + totalMoney;
        for (const id of opponent) balances[id] = (balances[id] ?? 0) - totalMoney;
      }

      matches.push({
        segmentId: segment.id,
        startHole: holes[0],
        endHole: holes[holes.length - 1],
        basePair: segment.basePair as [string, string],
        opponentPair: opponent,
        pointDiff,
        fixedMoney,
        pointMoney,
        totalMoney,
        complete,
        holePoints,
      });
    }
  }
  return { balances, matches };
}

function buildBallFriendNumber(a: number, b: number, flipped: boolean) {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return flipped ? high * 10 + low : low * 10 + high;
}

export function calculateBallFriend(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["ballFriend"],
  holeSetup: Record<number, BallFriendHole>,
  order: number[],
) {
  const participants = playersByIds(allPlayers, cfg.participantIds);
  const points = zeroBalances(participants);
  const balances = zeroBalances(participants);
  const details: {
    hole: number;
    teamA: [string, string];
    teamB: [string, string];
    restPlayerId?: string;
    numberA: number;
    numberB: number;
    pointDiff: number;
    birdieOrBetterA: boolean;
    birdieOrBetterB: boolean;
  }[] = [];

  if (!cfg.enabled || participants.length < 4) return { points, balances, details };

  for (const hole of order) {
    const setup = holeSetup[hole];
    if (!setup || setup.teamA.length !== 2) continue;
    const activeIds = cfg.participantIds.filter((id) => id !== setup.restPlayerId);
    if (activeIds.length !== 4) continue;
    const teamA = setup.teamA.filter((id) => activeIds.includes(id));
    if (teamA.length !== 2) continue;
    const teamB = activeIds.filter((id) => !teamA.includes(id));
    if (teamB.length !== 2 || !completedHole(hole, scores, activeIds)) continue;

    const hd = course.holes.find((x) => x.number === hole);
    if (!hd) continue;
    const row = scores[hole];

    const adjusted = Object.fromEntries(
      participants.map((p) => {
        const gross = row[p.id];
        if (typeof gross !== "number") return [p.id, null];
        const net = netScore(gross, p.id, hd.strokeIndex, participants, cfg.hcpPct, cfg.decimals);
        return [p.id, Math.min(cfg.maxScore, net)];
      }),
    ) as Record<string, number | null>;

    const birdieOrBetterA = teamA.some((id) => (row[id] as number) < hd.par);
    const birdieOrBetterB = teamB.some((id) => (row[id] as number) < hd.par);

    const numberA = buildBallFriendNumber(adjusted[teamA[0]] as number, adjusted[teamA[1]] as number, birdieOrBetterB);
    const numberB = buildBallFriendNumber(adjusted[teamB[0]] as number, adjusted[teamB[1]] as number, birdieOrBetterA);
    const diff = numberB - numberA;

    for (const id of teamA) points[id] = (points[id] ?? 0) + diff;
    for (const id of teamB) points[id] = (points[id] ?? 0) - diff;

    details.push({
      hole,
      teamA: teamA as [string, string],
      teamB: teamB as [string, string],
      restPlayerId: setup.restPlayerId,
      numberA,
      numberB,
      pointDiff: diff,
      birdieOrBetterA,
      birdieOrBetterB,
    });
  }

  for (const p of participants) balances[p.id] = (points[p.id] ?? 0) * cfg.value;
  return { points, balances, details };
}

function directAllowance(strokes: number, strokeIndex: number) {
  const safe = Math.max(0, strokes);
  const full = Math.floor(safe);
  const cycles = Math.floor(full / 18);
  const remainder = full % 18;
  return cycles + (strokeIndex <= remainder ? 1 : 0);
}

function personalAdjustedScore(
  gross: number,
  playerId: string,
  holeStrokeIndex: number,
  bet: PersonalBet,
) {
  if (!bet.advantageReceiverId || bet.advantageStrokes <= 0) return gross;
  return playerId === bet.advantageReceiverId ? gross - directAllowance(bet.advantageStrokes, holeStrokeIndex) : gross;
}

function signMoney(value: number, stake: number) {
  return value > 0 ? stake : value < 0 ? -stake : 0;
}

export function calculatePersonalBet(
  bet: PersonalBet,
  ownerId: string,
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
) {
  const rivalId = bet.rivalPlayerId;
  const componentMoney = {
    match1: 0,
    medal1: 0,
    match2: 0,
    medal2: 0,
    match18: 0,
    medal18: 0,
  };

  const segment = (holes: number[], multiplier = 1) => {
    let match = 0;
    let medal = 0;
    let complete = true;
    for (const hole of holes) {
      if (!completedHole(hole, scores, [ownerId, rivalId])) {
        complete = false;
        continue;
      }
      const hd = course.holes.find((x) => x.number === hole);
      if (!hd) continue;
      const row = scores[hole];
      const owner = personalAdjustedScore(row[ownerId] as number, ownerId, hd.strokeIndex, bet);
      const rival = personalAdjustedScore(row[rivalId] as number, rivalId, hd.strokeIndex, bet);
      match += owner < rival ? 1 : owner > rival ? -1 : 0;
      medal += rival - owner;
    }
    return { complete, match, medal, matchMoney: signMoney(match, bet.baseValue * multiplier), medalMoney: signMoney(medal, bet.baseValue * multiplier) };
  };

  const first = segment(order.slice(0, 9), 1);
  const second = segment(order.slice(9, 18), Math.max(1, bet.back9Multiplier));
  const total = segment(order.slice(0, 18), 1);

  if (bet.components.match1 && first.complete) componentMoney.match1 = first.matchMoney;
  if (bet.components.medal1 && first.complete) componentMoney.medal1 = first.medalMoney;
  if (bet.components.match2 && second.complete) componentMoney.match2 = second.matchMoney;
  if (bet.components.medal2 && second.complete) componentMoney.medal2 = second.medalMoney;
  if (bet.components.match18 && total.complete) componentMoney.match18 = total.matchMoney;
  if (bet.components.medal18 && total.complete) componentMoney.medal18 = total.medalMoney;

  const totalMoney = Object.values(componentMoney).reduce((a, b) => a + b, 0);
  return {
    betId: bet.id,
    rivalId,
    componentMoney,
    totalMoney,
    matchPoints: { first: first.match, second: second.match, total: total.match },
    medalDiff: { first: first.medal, second: second.medal, total: total.medal },
  };
}

export function calculatePersonalBets(
  bets: PersonalBet[],
  ownerId: string,
  allPlayers: Player[],
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
) {
  const balances = zeroBalances(allPlayers);
  const results = bets.map((b) => calculatePersonalBet(b, ownerId, course, scores, order));
  for (const r of results) {
    balances[ownerId] = (balances[ownerId] ?? 0) + r.totalMoney;
    balances[r.rivalId] = (balances[r.rivalId] ?? 0) - r.totalMoney;
  }
  return { results, balances };
}

export function mergeBalances(players: Player[], ...groups: Record<string, number>[]) {
  const result = zeroBalances(players);
  for (const group of groups) {
    for (const [id, amount] of Object.entries(group)) result[id] = (result[id] ?? 0) + amount;
  }
  return result;
}

export function settleBalances(balances: Record<string, number>): Transfer[] {
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > EPS)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -EPS)
    .map(([id, amount]) => ({ id, amount: -amount }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > EPS) transfers.push({ fromPlayerId: debtors[i].id, toPlayerId: creditors[j].id, amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount <= EPS) i++;
    if (creditors[j].amount <= EPS) j++;
  }
  return transfers;
}

export function expenseTotal(expenses: Expense) {
  return expenses.caddie + expenses.breakfast + expenses.lunch + expenses.drinks + expenses.other;
}
