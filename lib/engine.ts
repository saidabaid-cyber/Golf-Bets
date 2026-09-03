import {
  BallFriendHole,
  BetConfig,
  Course,
  DecimalMode,
  Expense,
  FoursomeSegment,
  HandicapMode,
  HoleScore,
  ManualBet,
  PersonalBet,
  Player,
  Transfer,
  UnitEvent,
} from "./types";
import { migratePersonalNassau } from "./personal-nassau";

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
  const handicap = (player: Player) => Number(player.handicap ?? 0);
  const best = Math.min(...players.map(handicap));
  return Object.fromEntries(players.map((p) => [p.id, handicap(p) - best])) as Record<string, number>;
}

export function normalizeHandicapMode(mode: HandicapMode | string | null | undefined): Exclude<HandicapMode, DecimalMode> {
  if (mode === "partial") return "decimal";
  if (mode === "round") return "half_up";
  if (mode === "decimal" || mode === "half_up" || mode === "half_down" || mode === "six_up" || mode === "four_down") return mode;
  return "decimal";
}

function roundAtFraction(raw: number, threshold: number, includeThreshold: boolean) {
  const whole = Math.floor(raw);
  const fraction = raw - whole;
  const roundsUp = includeThreshold ? fraction >= threshold - EPS : fraction > threshold + EPS;
  return whole + (roundsUp ? 1 : 0);
}

export function playingHandicap(base: number, pct: number, mode: HandicapMode) {
  const raw = (base * pct) / 100;
  switch (normalizeHandicapMode(mode)) {
    case "decimal": return raw;
    case "half_up": return roundAtFraction(raw, 0.5, true);
    case "half_down": return roundAtFraction(raw, 0.5, false);
    case "six_up": return roundAtFraction(raw, 0.6, true);
    case "four_down": return roundAtFraction(raw, 0.4, false);
  }
}

/**
 * Distributes handicap by stroke index. Supports >18 handicaps and, in partial
 * mode, gives the decimal on the next stroke-index hole exactly as the Excel
 * model does for tie-breaking.
 */
export function strokeAllowanceForHole(playingHcp: number, strokeIndex: number, mode: HandicapMode) {
  const safe = Math.max(0, playingHcp);
  const full = Math.floor(safe);
  const fraction = safe - full;
  const cycles = Math.floor(full / 18);
  const remainder = full % 18;
  let allowance = cycles + (strokeIndex <= remainder ? 1 : 0);

  if (normalizeHandicapMode(mode) === "decimal" && fraction > EPS) {
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
  decimals: HandicapMode,
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
  decimals: HandicapMode,
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

  // Excel state machine: every rabbit has Hoyo 1, 2 and (if needed) 3.
  // If it is won on Hoyo 2, a new rabbit starts immediately on the next real hole.
  // If it reaches Hoyo 3 without a winner, the next rabbit starts and one rabbit accumulates.
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
            rabbitWonBy = holder; // two outright wins in a row
          } else {
            events.push({ hole, type: "hold", playerId: holder });
          }
        } else {
          // Whoever beats the holder only makes it free; they do not grab it on this same hole.
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

    // Hoyo 3: nobody "grabs" here. A holder that ties/wins the best score cashes it.
    // If it arrived free, the unique winner of Hoyo 3 cashes it directly.
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

function automaticUnitsForScore(gross: number, par: number) {
  // HIO has priority and is never added on top of eagle/albatross.
  if (gross === 1) return 3;
  const underPar = par - gross;
  if (underPar >= 3) return 3; // albatross or better
  if (underPar === 2) return 2; // eagle
  if (underPar === 1) return 1; // birdie
  return 0;
}

export function calculateUnits(
  allPlayers: Player[],
  unitEvents: UnitEvent[],
  cfg: BetConfig["units"],
  course?: Course,
  scores: Record<number, HoleScore> = {},
  order: number[] = [],
) {
  const participants = playersByIds(allPlayers, cfg.participantIds);
  const positive = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const negative = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const manualNet = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const autoNet = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const autoByHole: Record<number, Record<string, number>> = {};
  const net = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const allowed = new Set(cfg.participantIds);

  if (!cfg.enabled || participants.length < 2) {
    return { positive, negative, manualNet, autoNet, autoByHole, net, registeredTotal: 0, balances: zeroBalances(participants) };
  }

  for (const e of unitEvents) {
    if (!allowed.has(e.playerId)) continue;
    if (e.amount >= 0) positive[e.playerId] += e.amount;
    else negative[e.playerId] += Math.abs(e.amount);
    manualNet[e.playerId] += e.amount;
  }

  if (course) {
    for (const hole of order) {
      const hd = course.holes.find((h) => h.number === hole);
      if (!hd) continue;
      const row = scores[hole];
      if (!row) continue;
      for (const p of participants) {
        const gross = row[p.id];
        if (typeof gross !== "number") continue;
        const amount = automaticUnitsForScore(gross, hd.par);
        if (!amount) continue;
        autoByHole[hole] ??= {};
        autoByHole[hole][p.id] = amount;
        autoNet[p.id] += amount;
        positive[p.id] += amount;
      }
    }
  }

  for (const p of participants) net[p.id] = manualNet[p.id] + autoNet[p.id];
  const registeredTotal = participants.reduce(
    (total, p) => total + positive[p.id] + negative[p.id],
    0,
  );

  // Everyone pays/charges everyone. Pairwise net is the difference between net units.
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
  return { positive, negative, manualNet, autoNet, autoByHole, net, registeredTotal, balances };
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
  if (participantIds.length === 3 && rest.length === 1) return [[rest[0], FOURSOME_GHOST_ID] as [string, string]];
  const pairs: [string, string][] = [];
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) pairs.push([rest[i], rest[j]]);
  }
  return pairs;
}

export const FOURSOME_GHOST_ID = "__foursome_ghost__";

export type FoursomeMatchResult = {
  segmentId: string;
  startHole: number;
  endHole: number;
  basePair: [string, string];
  opponentPair: [string, string];
  pointDiff: number;
  first9PointDiff: number;
  second9PointDiff: number;
  second9Pressed: boolean;
  pressureMultiplier: number;
  pressureNine: "holes_1_9" | "holes_10_18";
  ghostPlayerId?: string;
  fixedMoney: number;
  pointMoney: number;
  totalMoney: number;
  provisionalFixedMoney: number;
  provisionalPointMoney: number;
  provisionalTotalMoney: number;
  completedHoles: number;
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

function foursomeEconomics(
  holePoints: { hole: number; points: number }[],
  segmentHoles: number[],
  cfg: BetConfig["foursome"],
  pressureMultiplier: number,
  pressureNine: "holes_1_9" | "holes_10_18",
) {
  const sign = (value: number) => value > 0 ? 1 : value < 0 ? -1 : 0;
  const isPressedHole = (hole: number) => pressureMultiplier > 1 &&
    (pressureNine === "holes_1_9" ? hole <= 9 : hole >= 10);
  const pointDiff = holePoints.reduce((total, item) => total + item.points, 0);
  const spansBothPhysicalNines = segmentHoles.some((hole) => hole <= 9) && segmentHoles.some((hole) => hole >= 10);

  const fixedMoney = cfg.mode === "fixed" || cfg.mode === "fixed_points"
    ? pressureMultiplier > 1 && spansBothPhysicalNines
      ? [
          { points: holePoints.filter(({ hole }) => hole <= 9), multiplier: pressureNine === "holes_1_9" ? pressureMultiplier : 1 },
          { points: holePoints.filter(({ hole }) => hole >= 10), multiplier: pressureNine === "holes_10_18" ? pressureMultiplier : 1 },
        ].reduce((money, group) => money + sign(group.points.reduce((sum, item) => sum + item.points, 0)) * cfg.fixedValue * group.multiplier, 0)
      : sign(pointDiff) * cfg.fixedValue * (segmentHoles.every(isPressedHole) ? pressureMultiplier : 1)
    : 0;
  const pointMoney = cfg.mode === "points" || cfg.mode === "fixed_points"
    ? holePoints.reduce((money, item) => money + item.points * cfg.pointValue * (isPressedHole(item.hole) ? pressureMultiplier : 1), 0)
    : 0;

  return { fixedMoney, pointMoney, totalMoney: fixedMoney + pointMoney };
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
  const provisionalBalances = zeroBalances(participants);
  const matches: FoursomeMatchResult[] = [];
  if (!cfg.enabled || participants.length < 3) return { balances, provisionalBalances, matches };

  // Pressure is a two-nine option. A residual saved setting must never double a
  // standalone nine-hole round after the user changes the round length.
  const pressureMultiplier = order.length >= 18
    ? Math.min(5, Math.max(1, cfg.pressureMultiplier ?? (cfg.pressSecond9 ? 2 : 1)))
    : 1;
  const pressureNine = cfg.pressureNine ?? "holes_10_18";
  for (const segment of segments) {
    if (segment.basePair.length !== 2) continue;
    const opponents = opponentPairs(cfg.participantIds, segment.basePair);
    const holes = order.slice(segment.startIndex, segment.endIndex + 1);

    for (const opponent of opponents) {
      const ids = [...segment.basePair, ...opponent];
      const ghostPlayerId = opponent.includes(FOURSOME_GHOST_ID)
        ? opponent.find((id) => id !== FOURSOME_GHOST_ID)
        : undefined;
      const realIds = ids.filter((id) => id !== FOURSOME_GHOST_ID);
      const matchPlayers = playersByIds(allPlayers, realIds);
      if (ghostPlayerId) {
        const source = matchPlayers.find((player) => player.id === ghostPlayerId);
        if (source) matchPlayers.push({ ...source, id: FOURSOME_GHOST_ID, name: "Fantasma" });
      }
      const holePoints: { hole: number; points: number }[] = [];
      let complete = true;
      let pointDiff = 0;

      for (const hole of holes) {
        if (!completedHole(hole, scores, realIds)) {
          complete = false;
          continue;
        }
        const hd = course.holes.find((x) => x.number === hole);
        if (!hd) continue;
        const row = scores[hole];
        const aScores = (segment.basePair as [string, string]).map((id) =>
          netScore(row[id] as number, id, hd.strokeIndex, matchPlayers, cfg.hcpPct, cfg.decimals),
        );
        const bScores = opponent.map((id) => {
          const scoreId = id === FOURSOME_GHOST_ID ? ghostPlayerId as string : id;
          return netScore(row[scoreId] as number, id, hd.strokeIndex, matchPlayers, cfg.hcpPct, cfg.decimals);
        },
        );
        const points = teamHolePoints(aScores, bScores);
        pointDiff += points;
        holePoints.push({ hole, points });
      }

      const first9PointDiff = holePoints.filter(({ hole }) => hole <= 9).reduce((total, item) => total + item.points, 0);
      const second9PointDiff = holePoints.filter(({ hole }) => hole >= 10).reduce((total, item) => total + item.points, 0);
      const second9Pressed = pressureMultiplier > 1 && pressureNine === "holes_10_18";
      const provisional = foursomeEconomics(holePoints, holes, cfg, pressureMultiplier, pressureNine);
      const fixedMoney = complete ? provisional.fixedMoney : 0;
      const pointMoney = complete ? provisional.pointMoney : 0;
      const totalMoney = complete ? provisional.totalMoney : 0;

      for (const id of segment.basePair as [string, string]) {
        provisionalBalances[id] = (provisionalBalances[id] ?? 0) + provisional.totalMoney;
      }
      const provisionalRealOpponents = opponent.filter((id) => id !== FOURSOME_GHOST_ID);
      const provisionalOpponentShare = provisionalRealOpponents.length
        ? provisional.totalMoney * 2 / provisionalRealOpponents.length
        : 0;
      for (const id of provisionalRealOpponents) {
        provisionalBalances[id] = (provisionalBalances[id] ?? 0) - provisionalOpponentShare;
      }

      if (complete) {
        for (const id of segment.basePair as [string, string]) balances[id] = (balances[id] ?? 0) + totalMoney;
        const realOpponents = opponent.filter((id) => id !== FOURSOME_GHOST_ID);
        const opponentShare = realOpponents.length ? totalMoney * 2 / realOpponents.length : 0;
        for (const id of realOpponents) balances[id] = (balances[id] ?? 0) - opponentShare;
      }

      matches.push({
        segmentId: segment.id,
        startHole: holes[0],
        endHole: holes[holes.length - 1],
        basePair: segment.basePair as [string, string],
        opponentPair: opponent,
        pointDiff,
        first9PointDiff,
        second9PointDiff,
        second9Pressed,
        pressureMultiplier,
        pressureNine,
        ghostPlayerId,
        fixedMoney,
        pointMoney,
        totalMoney,
        provisionalFixedMoney: provisional.fixedMoney,
        provisionalPointMoney: provisional.pointMoney,
        provisionalTotalMoney: provisional.totalMoney,
        completedHoles: holePoints.length,
        complete,
        holePoints,
      });
    }
  }
  return { balances, provisionalBalances, matches };
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

    // Excel rule: birdie or better by one team flips the two-digit score of the OTHER team.
    const numberA = buildBallFriendNumber(adjusted[teamA[0]] as number, adjusted[teamA[1]] as number, birdieOrBetterB);
    const numberB = buildBallFriendNumber(adjusted[teamB[0]] as number, adjusted[teamB[1]] as number, birdieOrBetterA);
    const diff = numberB - numberA; // positive = Team A wins points

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
  role: "owner" | "rival",
  holeStrokeIndex: number,
  bet: PersonalBet,
) {
  if (bet.advantageReceiver === "none" || bet.advantageStrokes <= 0) return gross;
  return role === bet.advantageReceiver ? gross - directAllowance(bet.advantageStrokes, holeStrokeIndex) : gross;
}

function signMoney(value: number, stake: number) {
  return value > 0 ? stake : value < 0 ? -stake : 0;
}

export function personalRivalKey(bet: PersonalBet) {
  if (bet.rivalMode === "group" && bet.rivalPlayerId) return bet.rivalPlayerId;
  return `personal:${bet.externalRivalId || bet.id}`;
}

export function calculatePersonalBet(
  inputBet: PersonalBet,
  ownerId: string,
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
) {
  const bet = migratePersonalNassau(inputBet, order[0], order.length);
  const rivalId = personalRivalKey(bet);
  const componentMoney = {
    match1: 0,
    medal1: 0,
    match2: 0,
    medal2: 0,
    match18: 0,
    medal18: 0,
  };

  const rivalGross = (hole: number) => {
    if (bet.rivalMode === "group" && bet.rivalPlayerId) return scores[hole]?.[bet.rivalPlayerId] ?? null;
    return bet.externalScores?.[hole] ?? null;
  };

  const segment = (holes: number[], multiplier = 1) => {
    let match = 0;
    let medal = 0;
    let ownerNetTotal = 0;
    let rivalNetTotal = 0;
    let complete = holes.length > 0;
    const holeResults: Array<{
      hole: number;
      ownerScore: number;
      rivalScore: number;
      winner: "owner" | "rival" | "tie";
    }> = [];
    for (const hole of holes) {
      const ownerGross = scores[hole]?.[ownerId];
      const rivalRaw = rivalGross(hole);
      if (typeof ownerGross !== "number" || typeof rivalRaw !== "number") {
        complete = false;
        continue;
      }
      const hd = course.holes.find((x) => x.number === hole);
      if (!hd) {
        complete = false;
        continue;
      }
      const owner = personalAdjustedScore(ownerGross, "owner", hd.strokeIndex, bet);
      const rival = personalAdjustedScore(rivalRaw, "rival", hd.strokeIndex, bet);
      ownerNetTotal += owner;
      rivalNetTotal += rival;
      match += owner < rival ? 1 : owner > rival ? -1 : 0;
      medal += rival - owner; // positive = owner lower total
      holeResults.push({
        hole,
        ownerScore: owner,
        rivalScore: rival,
        winner: owner < rival ? "owner" : owner > rival ? "rival" : "tie",
      });
    }
    return {
      complete,
      match,
      medal,
      ownerNetTotal,
      rivalNetTotal,
      holeResults,
      matchMoney: signMoney(match, bet.baseValue * multiplier),
      medalMoney: signMoney(medal, bet.baseValue * multiplier),
    };
  };

  const firstHoles = order.slice(0, 9);
  const secondHoles = order.length >= 18 ? order.slice(9, 18) : [];
  const explicitPressure = typeof inputBet.pressureMultiplier === "number";
  const pressureMultiplier = Math.min(5, Math.max(1, bet.pressureMultiplier ?? bet.back9Multiplier ?? 1));
  const pressureNine = bet.pressureNine;
  const first = segment(firstHoles);
  const second = segment(secondHoles, pressureMultiplier);
  const total = segment(order.slice(0, 18), 1);
  // Carry is earned only by a completed tied first component and never mixes Match/Medal.
  const carryFor = (kind: "match" | "medal") => bet.carryEnabled && secondHoles.length && first.complete
    && bet.components[`${kind}1`] && bet.components[`${kind}2`] && first[kind] === 0 ? bet.baseValue : 0;
  const matchCarry = carryFor("match");
  const medalCarry = carryFor("medal");
  second.matchMoney = signMoney(second.match, bet.baseValue * pressureMultiplier + matchCarry);
  second.medalMoney = signMoney(second.medal, bet.baseValue * pressureMultiplier + medalCarry);

  if (bet.components.match1 && first.complete) componentMoney.match1 = first.matchMoney;
  if (bet.components.medal1 && first.complete) componentMoney.medal1 = first.medalMoney;
  if (order.length >= 18 && bet.components.match2 && second.complete) componentMoney.match2 = second.matchMoney;
  if (order.length >= 18 && bet.components.medal2 && second.complete) componentMoney.medal2 = second.medalMoney;
  if (order.length >= 18 && bet.components.match18 && total.complete) componentMoney.match18 = total.matchMoney;
  if (order.length >= 18 && bet.components.medal18 && total.complete) componentMoney.medal18 = total.medalMoney;

  const componentDefinitions = order.length >= 18
    ? [
        { key: "match1", label: `Match 1ª · H${firstHoles[0]}–${firstHoles.at(-1)}`, kind: "match", data: first, multiplier: 1, carry: 0, carryOut: matchCarry, holes: firstHoles },
        { key: "medal1", label: `Medal 1ª · H${firstHoles[0]}–${firstHoles.at(-1)}`, kind: "medal", data: first, multiplier: 1, carry: 0, carryOut: medalCarry, holes: firstHoles },
        { key: "match2", label: `Match 2ª · H${secondHoles[0]}–${secondHoles.at(-1)}`, kind: "match", data: second, multiplier: pressureMultiplier, carry: matchCarry, carryOut: 0, holes: secondHoles },
        { key: "medal2", label: `Medal 2ª · H${secondHoles[0]}–${secondHoles.at(-1)}`, kind: "medal", data: second, multiplier: pressureMultiplier, carry: medalCarry, carryOut: 0, holes: secondHoles },
        { key: "match18", label: "Match 18 hoyos", kind: "match", data: total, multiplier: 1, carry: 0, carryOut: 0, holes: order },
        { key: "medal18", label: "Medal 18 hoyos", kind: "medal", data: total, multiplier: 1, carry: 0, carryOut: 0, holes: order },
      ] as const
    : [
        { key: "match1", label: `Match ${order[0] >= 10 ? "H10–18" : "H1–9"}`, kind: "match", data: first, multiplier: 1, carry: 0, carryOut: 0, holes: firstHoles },
        { key: "medal1", label: `Medal ${order[0] >= 10 ? "H10–18" : "H1–9"}`, kind: "medal", data: first, multiplier: 1, carry: 0, carryOut: 0, holes: firstHoles },
      ] as const;

  const liveComponents = componentDefinitions
    .filter(({ key }) => bet.components[key])
    .map(({ key, label, kind, data, multiplier, carry, carryOut, holes }) => {
      const difference = kind === "match" ? data.match : data.medal;
      return {
        key,
        label,
        kind,
        complete: data.complete,
        playedHoles: data.holeResults.length,
        leader: difference > 0 ? "owner" as const : difference < 0 ? "rival" as const : "tie" as const,
        holes,
        baseStake: bet.baseValue,
        pressureStake: bet.baseValue * multiplier,
        carryIn: carry,
        carryOut,
        stake: bet.baseValue * multiplier + carry,
        ownerMoney: signMoney(difference, bet.baseValue * multiplier + carry),
        matchState: data.match,
        medalDiff: data.medal,
        ownerNetTotal: data.ownerNetTotal,
        rivalNetTotal: data.rivalNetTotal,
        holeResults: data.holeResults,
      };
    });

  const totalMoney = Object.values(componentMoney).reduce((a, b) => a + b, 0);
  const grossOwner = Object.values(componentMoney).reduce((sum, amount) => sum + Math.max(0, amount), 0);
  const grossRival = Object.values(componentMoney).reduce((sum, amount) => sum + Math.max(0, -amount), 0);
  return {
    betId: bet.id,
    rivalId,
    rivalName: bet.rivalMode === "group" ? "" : bet.rivalName,
    componentMoney,
    totalMoney,
    grossOwner,
    grossRival,
    carryEnabled: bet.carryEnabled,
    matchPoints: { first: first.match, second: second.match, total: total.match },
    medalDiff: { first: first.medal, second: second.medal, total: total.medal },
    pressureMultiplier,
    pressureNine,
    migratedLegacyPressure: !explicitPressure,
    liveComponents,
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
  const provisionalBalances = zeroBalances(allPlayers);
  const results = bets.map((b) => calculatePersonalBet(b, ownerId, course, scores, order));
  for (const r of results) {
    balances[ownerId] = (balances[ownerId] ?? 0) + r.totalMoney;
    balances[r.rivalId] = (balances[r.rivalId] ?? 0) - r.totalMoney;
    const provisionalTotal = r.liveComponents.reduce((total, component) => total + component.ownerMoney, 0);
    provisionalBalances[ownerId] = (provisionalBalances[ownerId] ?? 0) + provisionalTotal;
    provisionalBalances[r.rivalId] = (provisionalBalances[r.rivalId] ?? 0) - provisionalTotal;
  }
  return { results, balances, provisionalBalances };
}


export type MedalPollaDetail = {
  key: "first9" | "second9" | "total18" | "mini";
  label: string;
  holes: number[];
  value: number;
  complete: boolean;
  totals: Record<string, number>;
  winnerIds: string[];
  grossPrizePerWinner: number;
};

function calculateMedalComponent(
  key: MedalPollaDetail["key"],
  label: string,
  holes: number[],
  value: number,
  course: Course,
  scores: Record<number, HoleScore>,
  participants: Player[],
  hcpPct: number,
  decimals: DecimalMode,
) {
  const totals = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const ids = participants.map((p) => p.id);
  const complete = value > 0 && holes.length > 0 && holes.every((hole) => completedHole(hole, scores, ids));

  if (!complete) {
    return {
      detail: { key, label, holes, value, complete: false, totals, winnerIds: [], grossPrizePerWinner: 0 } as MedalPollaDetail,
      balances: zeroBalances(participants),
    };
  }

  for (const hole of holes) {
    const hd = course.holes.find((x) => x.number === hole);
    if (!hd) continue;
    const row = scores[hole];
    for (const p of participants) {
      totals[p.id] += netScore(row[p.id] as number, p.id, hd.strokeIndex, participants, hcpPct, decimals);
    }
  }

  const best = Math.min(...Object.values(totals));
  const winnerIds = participants.filter((p) => Math.abs(totals[p.id] - best) < EPS).map((p) => p.id);
  const grossPot = participants.length * value;
  const grossPrizePerWinner = winnerIds.length ? grossPot / winnerIds.length : 0;
  const balances = zeroBalances(participants);

  // Each participant contributes `value` to the pot. If there is a tie, the pot is split.
  // Net balance therefore remains zero-sum and matches "se divide el premio".
  for (const p of participants) balances[p.id] -= value;
  for (const id of winnerIds) balances[id] += grossPrizePerWinner;

  return {
    detail: { key, label, holes, value, complete: true, totals, winnerIds, grossPrizePerWinner } as MedalPollaDetail,
    balances,
  };
}

export function calculatePolla(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["polla"],
  order: number[],
) {
  const balances = zeroBalances(allPlayers);
  const details: MedalPollaDetail[] = [];
  const holes1To9 = order.filter((hole) => hole <= 9);
  const holes10To18 = order.filter((hole) => hole >= 10);
  const components = [
    ...(holes1To9.length === 9
      ? ([["first9", "Polla H1–9", holes1To9, cfg.first9]] as const)
      : []),
    ...(holes10To18.length === 9
      ? ([["second9", "Polla H10–18", holes10To18, cfg.second9]] as const)
      : []),
    ...(order.length >= 18
      ? ([["total18", "Polla 18 hoyos", order.slice(0, 18), cfg.total18]] as const)
      : []),
  ] as const;

  for (const [key, label, holes, componentCfg] of components) {
    if (!componentCfg.enabled) continue;
    const participants = playersByIds(allPlayers, componentCfg.participantIds);
    if (participants.length < 2) continue;
    const result = calculateMedalComponent(
      key,
      label,
      holes,
      componentCfg.value,
      course,
      scores,
      participants,
      componentCfg.hcpPct,
      componentCfg.decimals,
    );
    details.push(result.detail);
    for (const [id, amount] of Object.entries(result.balances)) balances[id] = (balances[id] ?? 0) + amount;
  }
  return { balances, details };
}

export function calculateMiniPolla(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["miniPolla"],
  order: number[],
) {
  const participants = playersByIds(allPlayers, cfg.participantIds);
  const balances = zeroBalances(participants);
  const details: MedalPollaDetail[] = [];
  if (!cfg.enabled || participants.length < 2) return { balances, details };

  // Always the last three holes actually PLAYED. If starting on 10, these are 7-8-9.
  const result = calculateMedalComponent("mini", "Mini Polla · últimos 3", order.slice(-3), cfg.value, course, scores, participants, cfg.hcpPct, cfg.decimals);
  details.push(result.detail);
  for (const [id, amount] of Object.entries(result.balances)) balances[id] = (balances[id] ?? 0) + amount;
  return { balances, details };
}

export function calculateManualBets(allPlayers: Player[], bets: ManualBet[]) {
  const balances = zeroBalances(allPlayers);
  const details = bets.map((bet) => {
    const total = allPlayers.reduce((sum, p) => sum + Number(bet.amounts[p.id] ?? 0), 0);
    const valid = Math.abs(total) < EPS;
    if (valid) {
      for (const p of allPlayers) balances[p.id] = (balances[p.id] ?? 0) + Number(bet.amounts[p.id] ?? 0);
    }
    return { ...bet, total, valid };
  });
  return { balances, details };
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
  return expenses.caddie + expenses.food + expenses.drinks + expenses.greenFee + expenses.cartRental + expenses.other;
}
