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
  RoundHandicapBasis,
  Transfer,
  UnitEvent,
} from "./types";
import { migratePersonalNassau } from "./personal-nassau";
import { handicapBases, isValidRoundHandicapValue, playersMissingRoundHandicap, roundHandicapBases } from "./handicap-base";
import { normalizeRabbitMode, normalizeSkinsMode } from "./bet-modes";
import { isFiniteZeroSum } from "./settlement-integrity";
import { physicalNineForPlayedHalf, roundHalfForHole, roundHalfHoles } from "./round-half";

const EPS = 1e-9;

const HANDICAP_MODES = new Set<HandicapMode>([
  "partial",
  "round",
  "decimal",
  "half_up",
  "half_down",
  "six_up",
  "four_down",
]);
const DECIMAL_MODES = new Set<DecimalMode>(["partial", "round"]);

function hasCleanParticipants(players: Player[], participantIds: unknown, minimum: number, exact?: number) {
  if (!Array.isArray(participantIds) || participantIds.some((id) => typeof id !== "string" || !id)) return false;
  if (new Set(participantIds).size !== participantIds.length) return false;
  const available = new Set(players.map((player) => player.id));
  if (!participantIds.every((id) => available.has(id))) return false;
  return exact === undefined ? participantIds.length >= minimum : participantIds.length === exact;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return isFiniteNonNegative(value) && value > 0;
}

function isValidHcpPct(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isValidHandicapMode(value: unknown): value is HandicapMode {
  return typeof value === "string" && HANDICAP_MODES.has(value as HandicapMode);
}

function isValidDecimalMode(value: unknown): value is DecimalMode {
  return typeof value === "string" && DECIMAL_MODES.has(value as DecimalMode);
}

export function playOrder(startHole: 1 | 10 = 1) {
  return startHole === 1
    ? Array.from({ length: 18 }, (_, i) => i + 1)
    : [...Array.from({ length: 9 }, (_, i) => i + 10), ...Array.from({ length: 9 }, (_, i) => i + 1)];
}

export function playersByIds(players: Player[], ids: string[] | undefined) {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  return players.filter((p) => wanted.has(p.id));
}

export function baseHandicaps(players: Player[], basis: RoundHandicapBasis = "relative") {
  return roundHandicapBases(players, basis);
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
 * Distributes handicap by stroke index. Positive handicaps receive strokes from
 * SI 1 upward; plus handicaps give strokes back from SI 18 downward. Supports
 * multiple 18-hole cycles and, in decimal mode, places the fraction on the next
 * applicable stroke-index hole.
 */
export function strokeAllowanceForHole(playingHcp: number, strokeIndex: number, mode: HandicapMode) {
  if (!Number.isFinite(playingHcp) || !Number.isInteger(strokeIndex) || strokeIndex < 1 || strokeIndex > 18) return 0;
  const direction = playingHcp < -EPS ? -1 : 1;
  const magnitude = Math.abs(playingHcp);
  const full = Math.floor(magnitude);
  const fraction = magnitude - full;
  const cycles = Math.floor(full / 18);
  const remainder = full % 18;
  const receivesWhole = direction > 0
    ? strokeIndex <= remainder
    : strokeIndex > 18 - remainder;
  let allowance = direction * (cycles + (receivesWhole ? 1 : 0));

  if (normalizeHandicapMode(mode) === "decimal" && fraction > EPS) {
    const nextIndex = direction > 0 ? remainder + 1 : 18 - remainder;
    if (strokeIndex === nextIndex) allowance += direction * fraction;
  }
  return Math.abs(allowance) < EPS ? 0 : allowance;
}

/** Preserves the legacy two-threshold Excel engines while supporting plus HCP. */
function excelStrokeAllowanceForHole(playingHcp: number, strokeIndex: number) {
  if (playingHcp >= 0) return Number(playingHcp >= strokeIndex) + Number(playingHcp >= strokeIndex + 18);
  const magnitude = Math.abs(playingHcp);
  const reverseStrokeIndex = 19 - strokeIndex;
  return -(Number(magnitude >= reverseStrokeIndex) + Number(magnitude >= reverseStrokeIndex + 18));
}

export function netScore(
  gross: number,
  playerId: string,
  holeStrokeIndex: number,
  comparisonPlayers: Player[],
  pct: number,
  decimals: HandicapMode,
  basis: RoundHandicapBasis = "relative",
) {
  const bases = baseHandicaps(comparisonPlayers, basis);
  const base = bases[playerId];
  if (base === undefined) return Number.NaN;
  const ph = playingHandicap(base, pct, decimals);
  return gross - strokeAllowanceForHole(ph, holeStrokeIndex, decimals);
}

export function completedHole(
  hole: number,
  scores: Record<number, HoleScore>,
  participantIds: string[],
) {
  const row = scores[hole];
  return !!row && participantIds.length > 0 && participantIds.every((id) => typeof row[id] === "number" && Number.isInteger(row[id]) && (row[id] as number) >= 1);
}

export function winnerIdsForHole(
  hole: number,
  course: Course,
  scores: Record<number, HoleScore>,
  comparisonPlayers: Player[],
  pct: number,
  decimals: HandicapMode,
  basis: RoundHandicapBasis = "relative",
) {
  const ids = comparisonPlayers.map((p) => p.id);
  if (!completedHole(hole, scores, ids)) return [] as string[];
  const holeDef = course.holes.find((h) => h.number === hole);
  if (!holeDef) return [] as string[];
  const row = scores[hole];
  if (playersMissingRoundHandicap(comparisonPlayers).length) return [] as string[];
  const nets = comparisonPlayers.map((p) => ({
    id: p.id,
    net: netScore(row[p.id] as number, p.id, holeDef.strokeIndex, comparisonPlayers, pct, decimals, basis),
  }));
  const best = Math.min(...nets.map((x) => x.net));
  return nets.filter((x) => Math.abs(x.net - best) < EPS).map((x) => x.id);
}

export type RabbitEvent = {
  hole: number;
  type: "grab" | "hold" | "lose" | "win" | "free" | "accumulate";
  playerId?: string;
  count?: number;
  /** Present only in the fixed six-rabbit mode. */
  rabbitNumber?: number;
  blockStart?: number;
  blockEnd?: number;
};

export function calculateRabbits(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["rabbits"],
  order: number[],
  basis: RoundHandicapBasis = "relative",
) {
  const participants = playersByIds(allPlayers, cfg?.participantIds);
  const won = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const events: RabbitEvent[] = [];
  const missingHandicapPlayerIds = playersMissingRoundHandicap(participants).map((player) => player.id);
  const modeIsValid = cfg?.mode === undefined || cfg.mode === "continuous" || cfg.mode === "three_hole_blocks";
  const needsAccumulateFlag = cfg?.mode === undefined || cfg.mode === "continuous";
  const configIsValid = cfg?.enabled !== true || (
    hasCleanParticipants(allPlayers, cfg.participantIds, 2)
    && isFiniteNonNegative(cfg.value)
    && isValidHcpPct(cfg.hcpPct)
    && isValidHandicapMode(cfg.decimals)
    && modeIsValid
    && (!needsAccumulateFlag || typeof cfg.accumulate === "boolean")
  );
  if (cfg?.enabled !== true || !configIsValid || participants.length < 2 || missingHandicapPlayerIds.length) return { events, won, pending: 0, missingHandicapPlayerIds };
  const mode = normalizeRabbitMode(cfg.mode);

  // Excel state machine: every rabbit has Hoyo 1, 2 and (if needed) 3.
  // If it is won on Hoyo 2, a new rabbit starts immediately on the next real hole.
  // If it reaches Hoyo 3 without a winner, the next rabbit starts and one rabbit accumulates.
  let rabbitHole: 1 | 2 | 3 = 1;
  let holder: string | null = null;
  let pending = 1;
  let physicalBlock = -1;
  let blockSettled = false;

  for (const hole of order) {
    if (mode === "three_hole_blocks") {
      const nextBlock = Math.floor((hole - 1) / 3);
      if (nextBlock !== physicalBlock) {
        physicalBlock = nextBlock;
        rabbitHole = 1;
        holder = null;
        pending = 1;
        blockSettled = false;
      }
      if (blockSettled) continue;
    }
    const winners = winnerIdsForHole(hole, course, scores, participants, cfg.hcpPct, cfg.decimals, basis);
    if (!winners.length) continue;

    const uniqueWinner = winners.length === 1 ? winners[0] : null;
    const finalPlayedHole = mode === "three_hole_blocks" ? hole % 3 === 0 : hole === order.at(-1);
    let rabbitWonBy: string | null = null;

    if (rabbitHole === 1) {
      if (uniqueWinner) {
        holder = uniqueWinner;
        events.push({ hole, type: "grab", playerId: holder });
        // A rabbit opened on the last played hole cannot be defended on a
        // later hole. A valid outright grab therefore settles it immediately.
        if (finalPlayedHole) {
          won[holder] = (won[holder] ?? 0) + pending;
          events.push({ hole, type: "win", playerId: holder, count: pending });
          pending = 1;
          holder = null;
          rabbitHole = 1;
          if (mode === "three_hole_blocks") blockSettled = true;
          continue;
        }
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
        if (mode === "three_hole_blocks") blockSettled = true;
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
      if (mode === "three_hole_blocks") blockSettled = true;
    } else if (mode === "continuous" && cfg.accumulate) {
      pending += 1;
      events.push({ hole, type: "accumulate", count: pending });
    } else {
      pending = 1;
    }
    holder = null;
    rabbitHole = 1;
  }

  return {
    events: mode === "three_hole_blocks"
      ? events.map((event) => ({
          ...event,
          rabbitNumber: Math.floor((event.hole - 1) / 3) + 1,
          blockStart: Math.floor((event.hole - 1) / 3) * 3 + 1,
          blockEnd: Math.floor((event.hole - 1) / 3) * 3 + 3,
        }))
      : events,
    won,
    pending,
  };
}

export function calculateSkins(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  cfg: BetConfig["skins"],
  order: number[],
  basis: RoundHandicapBasis = "relative",
) {
  const participants = playersByIds(allPlayers, cfg?.participantIds);
  const won = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const events: { hole: number; winnerId?: string; count: number; carry: number }[] = [];
  const missingHandicapPlayerIds = playersMissingRoundHandicap(participants).map((player) => player.id);
  const modeIsValid = cfg?.mode === undefined || cfg.mode === "carry" || cfg.mode === "no_carry";
  const configIsValid = cfg?.enabled !== true || (
    hasCleanParticipants(allPlayers, cfg.participantIds, 2)
    && isFiniteNonNegative(cfg.value)
    && isValidHcpPct(cfg.hcpPct)
    && isValidHandicapMode(cfg.decimals)
    && modeIsValid
    && (cfg.mode !== undefined || typeof cfg.accumulate === "boolean")
  );
  if (cfg?.enabled !== true || !configIsValid || participants.length < 2 || missingHandicapPlayerIds.length) return { won, events, carry: 0, missingHandicapPlayerIds };

  const mode = normalizeSkinsMode(cfg.mode);
  // `accumulate` is retained only for legacy snapshots that predate the
  // explicit mode. Once a mode exists, it is the sole source of truth.
  const carryEnabled = cfg.mode === undefined ? cfg.accumulate : mode === "carry";
  let carry = 1;
  for (const hole of order) {
    const winners = winnerIdsForHole(hole, course, scores, participants, cfg.hcpPct, cfg.decimals, basis);
    if (!winners.length) continue;
    if (winners.length === 1) {
      won[winners[0]] = (won[winners[0]] ?? 0) + carry;
      events.push({ hole, winnerId: winners[0], count: carry, carry: 1 });
      carry = 1;
    } else {
      if (carryEnabled) carry += 1;
      events.push({ hole, count: 0, carry });
    }
  }
  return { won, events, carry };
}

/** The event's carry includes the next hole's own skin; only the excess is pending. */
export function pendingSkinCarry(event: { winnerId?: string; carry: number }) {
  return event.winnerId ? 0 : Math.max(0, event.carry - 1);
}

function zeroBalances(players: Player[]) {
  return Object.fromEntries(players.map((p) => [p.id, 0])) as Record<string, number>;
}

/** Cálculos E1448/E1450/E1452, F1459:F1461, M1491:M1493. */
export function calculateMonkey(course: Course, scores: Record<number, HoleScore>, allPlayers: Player[], cfg: BetConfig["monkey"], order: number[], basis: RoundHandicapBasis = "relative") {
  const participants = playersByIds(allPlayers, cfg?.participantIds);
  const balances = zeroBalances(participants);
  const points = zeroBalances(participants);
  const details: Array<{hole:number; net:Record<string,number>; points:Record<string,number>}> = [];
  const missingHandicapPlayerIds = playersMissingRoundHandicap(participants).map((player) => player.id);
  const configIsValid = cfg?.enabled !== true || (
    hasCleanParticipants(allPlayers, cfg.participantIds, 3, 3)
    && isFiniteNonNegative(cfg.value)
    // Historical Monkey snapshots predate the percentage control and remain 100%.
    && (cfg.hcpPct === undefined || isValidHcpPct(cfg.hcpPct))
  );
  if (cfg?.enabled !== true || !configIsValid || participants.length !== 3 || missingHandicapPlayerIds.length) return {balances, points, details, valid: cfg?.enabled !== true || (configIsValid && participants.length === 3 && !missingHandicapPlayerIds.length), missingHandicapPlayerIds};
  const bases = baseHandicaps(participants, basis);
  const hcpPct = Number.isFinite(cfg.hcpPct) ? Math.min(100, Math.max(0, cfg.hcpPct as number)) : 100;
  for (const holeNumber of order) {
    const hole=course.holes.find(h=>h.number===holeNumber);
    if (!hole || !completedHole(holeNumber,scores,participants.map(p=>p.id))) continue;
    const net=Object.fromEntries(participants.map(p=>{
      const playingHcp = playingHandicap(bases[p.id], hcpPct, "decimal");
      // Preserve Monkey's original whole-stroke SI/SI+18 thresholds. The new
      // percentage changes the HCP fed into those thresholds, not its point rule.
      const allowance = excelStrokeAllowanceForHole(playingHcp, hole.strokeIndex);
      return [p.id, Number(scores[holeNumber][p.id]) - allowance];
    }));
    const earned=Object.fromEntries(participants.map(p=>[p.id,participants.reduce((sum,rival)=>sum+(rival.id===p.id ? 0 : net[p.id]<net[rival.id] ? 2 : net[p.id]===net[rival.id] ? 1 : 0),0)]));
    for(const p of participants) points[p.id]+=earned[p.id];
    details.push({hole:holeNumber,net,points:earned});
  }
  for(let i=0;i<participants.length;i++) for(let j=i+1;j<participants.length;j++) {
    const a=participants[i].id,b=participants[j].id;
    const amount=(points[a]-points[b])*cfg.value;
    balances[a]+=amount; balances[b]-=amount;
  }
  return {balances, points, details, valid:true, hcpPct};
}

export function payoutWinnerTakesFromAll(
  participants: Player[],
  wins: Record<string, number>,
  unitValue: number,
) {
  const balances = zeroBalances(participants);
  if (!isFiniteNonNegative(unitValue)) return balances;
  for (const winner of participants) {
    const count = wins[winner.id] ?? 0;
    if (!isFiniteNonNegative(count) || !count) continue;
    const perRival = count * unitValue;
    for (const rival of participants) {
      if (rival.id === winner.id) continue;
      balances[winner.id] += perRival;
      balances[rival.id] -= perRival;
    }
  }
  return balances;
}

export function automaticUnitsForScore(gross: number, par: number) {
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
  const participants = playersByIds(allPlayers, cfg?.participantIds);
  const positive = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const negative = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const manualNet = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const copas = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const autoNet = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const autoByHole: Record<number, Record<string, number>> = {};
  const net = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const allowed = new Set(Array.isArray(cfg?.participantIds) ? cfg.participantIds : []);
  const configIsValid = cfg?.enabled !== true || (
    hasCleanParticipants(allPlayers, cfg.participantIds, 2)
    && isFiniteNonNegative(cfg.value)
    // Missing Copa value is a documented legacy fallback to the regular unit value.
    && (cfg.copaValue === undefined || isFiniteNonNegative(cfg.copaValue))
  );

  if (cfg?.enabled !== true || !configIsValid || participants.length < 2) {
    return { positive, negative, manualNet, autoNet, autoByHole, net, registeredTotal: 0, balances: zeroBalances(participants) };
  }

  for (const e of Array.isArray(unitEvents) ? unitEvents : []) {
    if (!e || typeof e !== "object" || !Number.isFinite(e.amount)) continue;
    if (!allowed.has(e.playerId)) continue;
    if (e.amount >= 0) positive[e.playerId] += e.amount;
    else negative[e.playerId] += Math.abs(e.amount);
    manualNet[e.playerId] += e.amount;
    if (e.label === "Copa" && e.amount < 0) copas[e.playerId] += Math.abs(e.amount);
  }

  if (course) {
    for (const hole of order) {
      const hd = course.holes.find((h) => h.number === hole);
      if (!hd) continue;
      const row = scores[hole];
      if (!row) continue;
      for (const p of participants) {
        const gross = row[p.id];
        if (typeof gross !== "number" || !Number.isFinite(gross) || gross < 1) continue;
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
      const delta = (net[a] - net[b]) * cfg.value - (copas[a] - copas[b]) * ((cfg.copaValue ?? cfg.value) - cfg.value);
      balances[a] += delta;
      balances[b] -= delta;
    }
  }
  return { positive, negative, manualNet, autoNet, autoByHole, net, registeredTotal, balances };
}

export function segmentDefinitions(order: number[], size: 3 | 6 | 9 | 18): FoursomeSegment[] {
  const result: FoursomeSegment[] = [];
  const safeSize = [3, 6, 9, 18].includes(size) ? size : 6;
  for (let start = 0; start < order.length; start += safeSize) {
    result.push({
      id: `seg-${start}`,
      startIndex: start,
      endIndex: Math.min(order.length - 1, start + safeSize - 1),
      basePair: [],
    });
  }
  return result;
}

/** Repairs draft-only segment structure while preserving each valid selected pair. */
export function normalizeFoursomeSegments(value: unknown, order: number[], size: 3 | 6 | 9 | 18) {
  const existing = Array.isArray(value) ? value : [];
  return segmentDefinitions(order, size).map((segment, index) => ({
    ...segment,
    basePair: Array.isArray(existing[index]?.basePair) ? [...existing[index].basePair] : [],
  }));
}

export function opponentPairs(participantIds: string[] | undefined, basePair: string[] | undefined) {
  if (!Array.isArray(participantIds) || !Array.isArray(basePair) || basePair.length !== 2) return [] as [string, string][];
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
  holePoints: { hole: number; points: number; netA?: number[]; netB?: number[] }[];
};

/** Cálculos AB194/AB211 and AC195:AC196. Percentage/whole rounding controls
 * in Comienzo are not referenced by this Excel scoring path. */
export function excelFoursomeNet(gross: number, id: string, si: number, matchPlayers: Player[], bases = baseHandicaps(matchPlayers)) {
  const base = bases[id] ?? 0;
  const hcp = Math.round((base + EPS) * 10) / 10;
  return gross - excelStrokeAllowanceForHole(hcp, si);
}

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
  roundOrder: number[],
) {
  const sign = (value: number) => value > 0 ? 1 : value < 0 ? -1 : 0;
  const isPressedHole = (hole: number) => pressureMultiplier > 1 &&
    roundHalfForHole(hole, roundOrder) === "second_half";
  const pointDiff = holePoints.reduce((total, item) => total + item.points, 0);
  const spansBothPlayedHalves = segmentHoles.some((hole) => roundHalfForHole(hole, roundOrder) === "first_half")
    && segmentHoles.some((hole) => roundHalfForHole(hole, roundOrder) === "second_half");

  const fixedMoney = cfg.mode === "fixed" || cfg.mode === "fixed_points"
    ? pressureMultiplier > 1 && spansBothPlayedHalves
      ? [
          { points: holePoints.filter(({ hole }) => roundHalfForHole(hole, roundOrder) === "first_half"), multiplier: 1 },
          { points: holePoints.filter(({ hole }) => roundHalfForHole(hole, roundOrder) === "second_half"), multiplier: pressureMultiplier },
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
  basis: RoundHandicapBasis = "relative",
) {
  const participants = playersByIds(allPlayers, cfg?.participantIds);
  const balances = zeroBalances(participants);
  const provisionalBalances = zeroBalances(participants);
  const matches: FoursomeMatchResult[] = [];
  const missingHandicapPlayerIds = playersMissingRoundHandicap(participants).map((player) => player.id);
  const modeIsValid = cfg?.mode === "fixed" || cfg?.mode === "fixed_points" || cfg?.mode === "points";
  const methodIsValid = cfg?.handicapMethod === undefined || cfg.handicapMethod === "excel" || cfg.handicapMethod === "configured";
  const baseModeIsValid = basis === "course" || cfg?.baseMode === undefined || cfg.baseMode === "fixed" || cfg.baseMode === "moving";
  const usesConfiguredHandicap = cfg?.handicapMethod !== "excel";
  const usesFixedValue = cfg?.mode === "fixed" || cfg?.mode === "fixed_points";
  const usesPointValue = cfg?.mode === "points" || cfg?.mode === "fixed_points";
  const savedPressureMultiplier = cfg?.pressureMultiplier;
  const effectivePressureMultiplier = savedPressureMultiplier ?? (cfg?.pressSecond9 ? 2 : 1);
  const pressureIsApplicable = Array.isArray(order) && order.length >= 18;
  const pressureIsValid = !pressureIsApplicable || (
    (savedPressureMultiplier === undefined || (Number.isInteger(savedPressureMultiplier) && savedPressureMultiplier >= 1 && savedPressureMultiplier <= 5))
    && (savedPressureMultiplier !== undefined || cfg?.pressSecond9 === undefined || typeof cfg.pressSecond9 === "boolean")
    && (effectivePressureMultiplier <= 1 || cfg?.pressureNine === undefined || cfg.pressureNine === "holes_1_9" || cfg.pressureNine === "holes_10_18")
  );
  const configIsValid = cfg?.enabled !== true || (
    hasCleanParticipants(allPlayers, cfg.participantIds, 3)
    && [3, 6, 9, 18].includes(cfg.segmentSize)
    && modeIsValid
    && methodIsValid
    && baseModeIsValid
    && (!usesFixedValue || isFiniteNonNegative(cfg.fixedValue))
    && (!usesPointValue || isFiniteNonNegative(cfg.pointValue))
    && (!usesConfiguredHandicap || (isValidHcpPct(cfg.hcpPct) && isValidDecimalMode(cfg.decimals)))
    && (basis === "course" || cfg.baseMode !== "fixed" || cfg.fixedBaseHandicap === undefined || isValidRoundHandicapValue(cfg.fixedBaseHandicap))
    && pressureIsValid
  );
  if (cfg?.enabled !== true || !configIsValid || participants.length < 3 || missingHandicapPlayerIds.length) return { balances, provisionalBalances, matches, missingHandicapPlayerIds };

  // Pressure is a two-nine option. A residual saved setting must never double a
  // standalone nine-hole round after the user changes the round length.
  const pressureMultiplier = order.length >= 18
    ? Math.min(5, Math.max(1, cfg.pressureMultiplier ?? (cfg.pressSecond9 ? 2 : 1)))
    : 1;
  const pressureNine = physicalNineForPlayedHalf(order, "second_half") ?? cfg.pressureNine ?? "holes_10_18";
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (!segment || typeof segment !== "object") continue;
    const basePair = Array.isArray(segment?.basePair) ? segment.basePair : [];
    if (basePair.length !== 2 || new Set(basePair).size !== 2 || !basePair.every(id => participants.some(p => p.id === id))) continue;
    if (!Number.isInteger(segment.startIndex) || !Number.isInteger(segment.endIndex) || segment.startIndex < 0 || segment.endIndex < segment.startIndex || segment.endIndex >= order.length) continue;
    const opponents = opponentPairs(cfg.participantIds, basePair);
    const holes = order.slice(segment.startIndex, segment.endIndex + 1);
    if (!holes.length) continue;

    for (const opponent of opponents) {
      const ids = [...basePair, ...opponent];
      const ghostPlayerId = opponent.includes(FOURSOME_GHOST_ID)
        ? opponent.find((id) => id !== FOURSOME_GHOST_ID)
        : undefined;
      const realIds = ids.filter((id) => id !== FOURSOME_GHOST_ID);
      const matchPlayers = playersByIds(allPlayers, realIds);
      if (ghostPlayerId) {
        const source = matchPlayers.find((player) => player.id === ghostPlayerId);
        if (source) matchPlayers.push({ ...source, id: FOURSOME_GHOST_ID, name: "Fantasma" });
      }
      const holePoints: FoursomeMatchResult["holePoints"] = [];
      const bases = handicapBases(cfg, matchPlayers, participants, matchPlayers, basis);
      if (matchPlayers.some((player) => !Number.isFinite(bases[player.id]))) continue;
      let complete = true;
      let pointDiff = 0;

      for (const hole of holes) {
        if (!completedHole(hole, scores, realIds)) {
          complete = false;
          continue;
        }
        const hd = course.holes.find((x) => x.number === hole);
        if (!hd) { complete = false; continue; }
        const row = scores[hole];
        const adjusted = (gross: number, id: string) => cfg.handicapMethod === "excel"
          ? excelFoursomeNet(gross, id, hd.strokeIndex, matchPlayers, bases)
          : gross - strokeAllowanceForHole(playingHandicap(bases[id], cfg.hcpPct, cfg.decimals), hd.strokeIndex, cfg.decimals);
        const aScores = (basePair as [string, string]).map((id) =>
          adjusted(row[id] as number, id),
        );
        const bScores = opponent.map((id) => {
          const scoreId = id === FOURSOME_GHOST_ID ? ghostPlayerId as string : id;
          return adjusted(row[scoreId] as number, id);
        },
        );
        const points = teamHolePoints(aScores, bScores);
        pointDiff += points;
        holePoints.push({ hole, points, netA: aScores, netB: bScores });
      }

      const first9PointDiff = holePoints.filter(({ hole }) => roundHalfForHole(hole, order) === "first_half").reduce((total, item) => total + item.points, 0);
      const second9PointDiff = holePoints.filter(({ hole }) => roundHalfForHole(hole, order) === "second_half").reduce((total, item) => total + item.points, 0);
      const second9Pressed = pressureMultiplier > 1;
      const provisional = foursomeEconomics(holePoints, holes, cfg, pressureMultiplier, order);
      const fixedMoney = complete ? provisional.fixedMoney : 0;
      const pointMoney = complete ? provisional.pointMoney : 0;
      const totalMoney = complete ? provisional.totalMoney : 0;

      for (const id of basePair as [string, string]) {
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
        for (const id of basePair as [string, string]) balances[id] = (balances[id] ?? 0) + totalMoney;
        const realOpponents = opponent.filter((id) => id !== FOURSOME_GHOST_ID);
        const opponentShare = realOpponents.length ? totalMoney * 2 / realOpponents.length : 0;
        for (const id of realOpponents) balances[id] = (balances[id] ?? 0) - opponentShare;
      }

      matches.push({
        segmentId: segment.id,
        startHole: holes[0],
        endHole: holes[holes.length - 1],
        basePair: basePair as [string, string],
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
  basis: RoundHandicapBasis = "relative",
) {
  const participants = playersByIds(allPlayers, cfg?.participantIds);
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

  const missingHandicapPlayerIds = playersMissingRoundHandicap(participants).map((player) => player.id);
  const participantCountIsValid = hasCleanParticipants(allPlayers, cfg?.participantIds, 4, 4)
    || hasCleanParticipants(allPlayers, cfg?.participantIds, 5, 5);
  const baseModeIsValid = basis === "course" || cfg?.baseMode === undefined || cfg.baseMode === "fixed" || cfg.baseMode === "moving";
  const configIsValid = cfg?.enabled !== true || (
    participantCountIsValid
    && isFiniteNonNegative(cfg.value)
    && isValidHcpPct(cfg.hcpPct)
    && isValidDecimalMode(cfg.decimals)
    && Number.isInteger(cfg.maxScore)
    && cfg.maxScore >= 1
    && baseModeIsValid
    && (basis === "course" || cfg.baseMode !== "fixed" || cfg.fixedBaseHandicap === undefined || isValidRoundHandicapValue(cfg.fixedBaseHandicap))
  );
  if (cfg?.enabled !== true || !configIsValid || (participants.length !== 4 && participants.length !== 5) || missingHandicapPlayerIds.length) return { points, balances, details, missingHandicapPlayerIds };

  for (const hole of order) {
    const setup = holeSetup && typeof holeSetup === "object" ? holeSetup[hole] : undefined;
    if (!setup || !Array.isArray(setup.teamA) || setup.teamA.length !== 2) continue;
    const activeIds = cfg.participantIds.filter((id) => id !== setup.restPlayerId);
    if (activeIds.length !== 4) continue;
    const teamA = setup.teamA.filter((id) => activeIds.includes(id));
    if (teamA.length !== 2) continue;
    const teamB = activeIds.filter((id) => !teamA.includes(id));
    if (teamB.length !== 2 || !completedHole(hole, scores, activeIds)) continue;

    const hd = course.holes.find((x) => x.number === hole);
    if (!hd) continue;
    const row = scores[hole];

    const activePlayers = playersByIds(participants, activeIds);
    const bases = handicapBases(cfg, activePlayers, participants, participants, basis);
    if (activePlayers.some((player) => !Number.isFinite(bases[player.id]))) continue;
    const adjusted = Object.fromEntries(
      activePlayers.map((p) => {
        const gross = row[p.id];
        if (typeof gross !== "number") return [p.id, null];
        const net = gross - strokeAllowanceForHole(playingHandicap(bases[p.id], cfg.hcpPct, cfg.decimals), hd.strokeIndex, cfg.decimals);
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
  if (!Number.isFinite(value) || !isFiniteNonNegative(stake)) return 0;
  return value > 0 ? stake : value < 0 ? -stake : 0;
}

const PERSONAL_COMPONENT_KEYS = ["match1", "medal1", "match2", "medal2", "match18", "medal18"] as const;
const DISABLED_PERSONAL_COMPONENTS: PersonalBet["components"] = {
  match1: false,
  medal1: false,
  match2: false,
  medal2: false,
  match18: false,
  medal18: false,
};

function hasBooleanPersonalComponents(value: unknown, orderLength: number): value is PersonalBet["components"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const components = value as Record<string, unknown>;
  const requiredKeys = orderLength >= 18 ? PERSONAL_COMPONENT_KEYS : (["match1", "medal1"] as const);
  return requiredKeys.every((key) => typeof components[key] === "boolean");
}

function hasApplicablePersonalComponent(components: PersonalBet["components"], orderLength: number) {
  const applicableKeys = orderLength >= 18 ? PERSONAL_COMPONENT_KEYS : (["match1", "medal1"] as const);
  return applicableKeys.some((key) => components[key]);
}

function isPersonalInstanceId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isExternalRivalId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !/\s/.test(value);
}

function isRoundPlayerId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !/\s/.test(value);
}

function isPersonalScore(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function personalScoreMap(value: unknown): Record<number, number | null> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<number, number | null>
    : {};
}

function personalScoreRows(value: unknown): Record<number, HoleScore> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<number, HoleScore>
    : {};
}

function personalRelevantHoles(components: PersonalBet["components"], order: number[]) {
  const relevant = new Set<number>();
  const first = order.slice(0, 9);
  const second = order.length >= 18 ? order.slice(9, 18) : [];
  if (components.match1 || components.medal1) first.forEach((hole) => relevant.add(hole));
  if (components.match2 || components.medal2) second.forEach((hole) => relevant.add(hole));
  if (components.match18 || components.medal18) order.slice(0, 18).forEach((hole) => relevant.add(hole));
  return [...relevant];
}

type PersonalBetRuntimeContext = {
  availablePlayerIds?: ReadonlySet<string>;
  instanceIdIsUnique?: boolean;
  rosterIsValid?: boolean;
};

function personalBetRuntimeIsSafe(
  inputBet: PersonalBet,
  migratedBet: PersonalBet,
  ownerId: string,
  scores: Record<number, HoleScore>,
  order: number[],
  context?: PersonalBetRuntimeContext,
) {
  if ((inputBet.enabled !== undefined && inputBet.enabled !== true)
    || !isPersonalInstanceId(inputBet.id)
    || context?.instanceIdIsUnique === false
    || context?.rosterIsValid === false
    || !isRoundPlayerId(ownerId)
    || (context?.availablePlayerIds && !context.availablePlayerIds.has(ownerId))
    || !isFiniteNonNegative(migratedBet.baseValue)
    || !Number.isInteger(migratedBet.advantageStrokes)
    || migratedBet.advantageStrokes < 0) return false;

  if (migratedBet.advantageStrokes > 0
    && migratedBet.advantageReceiver !== "owner"
    && migratedBet.advantageReceiver !== "rival") return false;

  const componentsAreSafe = hasBooleanPersonalComponents(migratedBet.components, order.length);
  if (!componentsAreSafe || !hasApplicablePersonalComponent(migratedBet.components, order.length)) return false;

  if (migratedBet.rivalMode === "group") {
    if (!isRoundPlayerId(migratedBet.rivalPlayerId)
      || migratedBet.rivalPlayerId === ownerId
      || (context?.availablePlayerIds && !context.availablePlayerIds.has(migratedBet.rivalPlayerId))) return false;
  } else if (migratedBet.rivalMode === "external") {
    if (typeof migratedBet.rivalName !== "string" || !migratedBet.rivalName.trim()) return false;
    if (migratedBet.externalRivalId !== undefined && !isExternalRivalId(migratedBet.externalRivalId)) return false;
    if (migratedBet.externalScores !== undefined
      && (!migratedBet.externalScores || typeof migratedBet.externalScores !== "object" || Array.isArray(migratedBet.externalScores))) return false;
  } else {
    return false;
  }

  const carryIsRelevant = order.length >= 18 && Boolean(
    (migratedBet.components.match1 && migratedBet.components.match2)
    || (migratedBet.components.medal1 && migratedBet.components.medal2),
  );
  if (carryIsRelevant && typeof migratedBet.carryEnabled !== "boolean") return false;

  const usesSecondNinePressure = order.length >= 18
    && Boolean(migratedBet.components.match2 || migratedBet.components.medal2);
  const configuredPressureMultiplier = inputBet.nassauVersion === 2
    ? inputBet.pressureMultiplier
    : inputBet.pressureMultiplier ?? inputBet.back9Multiplier ?? 1;
  const pressureMultiplierIsValid = typeof configuredPressureMultiplier === "number"
    && Number.isInteger(configuredPressureMultiplier)
    && configuredPressureMultiplier >= 1
    && configuredPressureMultiplier <= 5;
  if (usesSecondNinePressure && !pressureMultiplierIsValid) return false;
  if (usesSecondNinePressure
    && pressureMultiplierIsValid
    && configuredPressureMultiplier > 1
    && migratedBet.pressureNine !== undefined
    && migratedBet.pressureNine !== "holes_1_9"
    && migratedBet.pressureNine !== "holes_10_18") return false;

  const externalScores = personalScoreMap(migratedBet.externalScores);
  for (const hole of personalRelevantHoles(migratedBet.components, order)) {
    const row = scores[hole];
    if (row !== undefined && row !== null && (typeof row !== "object" || Array.isArray(row))) return false;
    const ownerScore = row?.[ownerId];
    if (ownerScore !== undefined && ownerScore !== null && !isPersonalScore(ownerScore)) return false;
    const rivalScore = migratedBet.rivalMode === "group"
      ? row?.[migratedBet.rivalPlayerId as string]
      : externalScores[hole];
    if (rivalScore !== undefined && rivalScore !== null && !isPersonalScore(rivalScore)) return false;
  }
  return true;
}

function inertPersonalBet(inputBet: PersonalBet, migratedBet: PersonalBet, ownerId: string, order: number[], context?: PersonalBetRuntimeContext): PersonalBet {
  const id = isPersonalInstanceId(inputBet.id) ? inputBet.id : "invalid-personal";
  const groupRivalIsSafe = migratedBet.rivalMode === "group"
    && isRoundPlayerId(migratedBet.rivalPlayerId)
    && migratedBet.rivalPlayerId !== ownerId
    && (!context?.availablePlayerIds || context.availablePlayerIds.has(migratedBet.rivalPlayerId));
  const externalRivalId = isExternalRivalId(migratedBet.externalRivalId)
    ? migratedBet.externalRivalId
    : `invalid-${id}`;
  return {
    ...migratedBet,
    id,
    enabled: true,
    rivalMode: groupRivalIsSafe ? "group" : "external",
    rivalPlayerId: groupRivalIsSafe ? migratedBet.rivalPlayerId : undefined,
    externalRivalId,
    rivalName: typeof migratedBet.rivalName === "string" ? migratedBet.rivalName : "",
    externalScores: {},
    baseValue: 0,
    advantageReceiver: "none",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: order[0] === 10 ? "holes_1_9" : "holes_10_18",
    nassauVersion: 2,
    carryEnabled: false,
    components: { ...DISABLED_PERSONAL_COMPONENTS },
  };
}

export function personalRivalKey(bet: PersonalBet) {
  if (bet?.rivalMode === "group" && isRoundPlayerId(bet.rivalPlayerId)) return bet.rivalPlayerId;
  const externalKey = isExternalRivalId(bet?.externalRivalId)
    ? bet.externalRivalId
    : isPersonalInstanceId(bet?.id) ? bet.id : "invalid-personal";
  return `personal:${externalKey}`;
}

export function calculatePersonalBet(
  inputBet: PersonalBet,
  ownerId: string,
  course: Course,
  scores: Record<number, HoleScore>,
  order: number[],
  runtimeContext?: PersonalBetRuntimeContext,
) {
  const rawBet = inputBet && typeof inputBet === "object" && !Array.isArray(inputBet)
    ? inputBet
    : {} as PersonalBet;
  const safeOrder = Array.isArray(order) ? order : [];
  const safeScores = personalScoreRows(scores);
  const migratedBet = migratePersonalNassau(rawBet, safeOrder[0], safeOrder.length);
  const componentsAreSafe = hasBooleanPersonalComponents(migratedBet.components, safeOrder.length);
  const carryIsRelevant = safeOrder.length >= 18 && componentsAreSafe && Boolean(
    (migratedBet.components.match1 && migratedBet.components.match2)
    || (migratedBet.components.medal1 && migratedBet.components.medal2),
  );
  const safeV2Features = rawBet.nassauVersion !== 2 || (
    componentsAreSafe
    && (!carryIsRelevant || typeof migratedBet.carryEnabled === "boolean")
  );
  // The setup gate normally catches this. Keep the deterministic engine safe
  // when called directly with a corrupt persisted V2 wager: truthy strings or
  // partial component maps must never become money.
  const runtimeIsSafe = safeV2Features
    && personalBetRuntimeIsSafe(rawBet, migratedBet, ownerId, safeScores, safeOrder, runtimeContext);
  const migratedPressure = migratedBet.pressureMultiplier ?? migratedBet.back9Multiplier ?? 1;
  const normalizedPressure = typeof migratedPressure === "number"
    && Number.isInteger(migratedPressure)
    && migratedPressure >= 1
    && migratedPressure <= 5
    ? migratedPressure
    : 1;
  const bet = runtimeIsSafe
    ? {
        ...migratedBet,
        externalScores: personalScoreMap(migratedBet.externalScores),
        carryEnabled: typeof migratedBet.carryEnabled === "boolean" ? migratedBet.carryEnabled : false,
        pressureMultiplier: normalizedPressure as 1 | 2 | 3 | 4 | 5,
        pressureNine: migratedBet.pressureNine === "holes_1_9" || migratedBet.pressureNine === "holes_10_18"
          ? migratedBet.pressureNine
          : safeOrder[0] === 10 ? "holes_1_9" : "holes_10_18",
      }
    : inertPersonalBet(rawBet, migratedBet, ownerId, safeOrder, runtimeContext);
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
    if (bet.rivalMode === "group" && bet.rivalPlayerId) return safeScores[hole]?.[bet.rivalPlayerId] ?? null;
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
      ownerGross: number;
      rivalGross: number;
      ownerStrokes: number;
      rivalStrokes: number;
      winner: "owner" | "rival" | "tie";
    }> = [];
    for (const hole of holes) {
      const ownerGross = safeScores[hole]?.[ownerId];
      const rivalRaw = rivalGross(hole);
      if (typeof ownerGross !== "number" || !Number.isInteger(ownerGross) || ownerGross < 1 || typeof rivalRaw !== "number" || !Number.isInteger(rivalRaw) || rivalRaw < 1) {
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
        ownerGross,
        rivalGross: rivalRaw,
        ownerStrokes: ownerGross - owner,
        rivalStrokes: rivalRaw - rival,
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

  const firstHoles = safeOrder.slice(0, 9);
  const secondHoles = safeOrder.length >= 18 ? safeOrder.slice(9, 18) : [];
  const explicitPressure = typeof rawBet.pressureMultiplier === "number" && Number.isFinite(rawBet.pressureMultiplier);
  const pressureMultiplier = bet.pressureMultiplier ?? 1;
  const pressureNine = bet.pressureNine;
  const first = segment(firstHoles);
  const second = segment(secondHoles, pressureMultiplier);
  const total = segment(safeOrder.slice(0, 18), 1);
  // Carry is earned only by a completed tied first component and never mixes Match/Medal.
  const carryFor = (kind: "match" | "medal") => bet.carryEnabled && secondHoles.length && first.complete
    && bet.components[`${kind}1`] && bet.components[`${kind}2`] && first[kind] === 0 ? bet.baseValue : 0;
  const matchCarry = carryFor("match");
  const medalCarry = carryFor("medal");
  second.matchMoney = signMoney(second.match, bet.baseValue * pressureMultiplier + matchCarry);
  second.medalMoney = signMoney(second.medal, bet.baseValue * pressureMultiplier + medalCarry);

  if (bet.components.match1 && first.complete) componentMoney.match1 = first.matchMoney;
  if (bet.components.medal1 && first.complete) componentMoney.medal1 = first.medalMoney;
  if (safeOrder.length >= 18 && bet.components.match2 && second.complete) componentMoney.match2 = second.matchMoney;
  if (safeOrder.length >= 18 && bet.components.medal2 && second.complete) componentMoney.medal2 = second.medalMoney;
  if (safeOrder.length >= 18 && bet.components.match18 && total.complete) componentMoney.match18 = total.matchMoney;
  if (safeOrder.length >= 18 && bet.components.medal18 && total.complete) componentMoney.medal18 = total.medalMoney;

  const componentDefinitions = safeOrder.length >= 18
    ? [
        { key: "match1", label: `Match 1ª · H${firstHoles[0]}–${firstHoles.at(-1)}`, kind: "match", data: first, multiplier: 1, carry: 0, carryOut: matchCarry, holes: firstHoles },
        { key: "medal1", label: `Medal 1ª · H${firstHoles[0]}–${firstHoles.at(-1)}`, kind: "medal", data: first, multiplier: 1, carry: 0, carryOut: medalCarry, holes: firstHoles },
        { key: "match2", label: `Match 2ª · H${secondHoles[0]}–${secondHoles.at(-1)}`, kind: "match", data: second, multiplier: pressureMultiplier, carry: matchCarry, carryOut: 0, holes: secondHoles },
        { key: "medal2", label: `Medal 2ª · H${secondHoles[0]}–${secondHoles.at(-1)}`, kind: "medal", data: second, multiplier: pressureMultiplier, carry: medalCarry, carryOut: 0, holes: secondHoles },
        { key: "match18", label: "Match 18 hoyos", kind: "match", data: total, multiplier: 1, carry: 0, carryOut: 0, holes: safeOrder },
        { key: "medal18", label: "Medal 18 hoyos", kind: "medal", data: total, multiplier: 1, carry: 0, carryOut: 0, holes: safeOrder },
      ] as const
    : [
        { key: "match1", label: `Match ${safeOrder[0] >= 10 ? "H10–18" : "H1–9"}`, kind: "match", data: first, multiplier: 1, carry: 0, carryOut: 0, holes: firstHoles },
        { key: "medal1", label: `Medal ${safeOrder[0] >= 10 ? "H10–18" : "H1–9"}`, kind: "medal", data: first, multiplier: 1, carry: 0, carryOut: 0, holes: firstHoles },
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
  const activeBets = (Array.isArray(bets) ? bets : []).filter((bet) => {
    if (!bet || typeof bet !== "object" || Array.isArray(bet)) return true;
    return bet.enabled === undefined || bet.enabled === true;
  });
  const playerIds = allPlayers.map((player) => player.id);
  const rosterIsValid = playerIds.every(isRoundPlayerId) && new Set(playerIds).size === playerIds.length;
  const availablePlayerIds = new Set(playerIds);
  const instanceCounts = new Map<string, number>();
  for (const bet of activeBets) {
    if (!isPersonalInstanceId(bet?.id)) continue;
    instanceCounts.set(bet.id, (instanceCounts.get(bet.id) ?? 0) + 1);
  }
  const results = activeBets.map((bet) => calculatePersonalBet(bet, ownerId, course, scores, order, {
    availablePlayerIds,
    instanceIdIsUnique: isPersonalInstanceId(bet?.id) && instanceCounts.get(bet.id) === 1,
    rosterIsValid,
  }));
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
  basis: RoundHandicapBasis,
) {
  const totals = Object.fromEntries(participants.map((p) => [p.id, 0])) as Record<string, number>;
  const ids = participants.map((p) => p.id);
  const complete = isFinitePositive(value)
    && isValidHcpPct(hcpPct)
    && isValidDecimalMode(decimals)
    && holes.length > 0
    && !playersMissingRoundHandicap(participants).length
    && holes.every((hole) => course.holes.some((definition) => definition.number === hole) && completedHole(hole, scores, ids));

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
      totals[p.id] += netScore(row[p.id] as number, p.id, hd.strokeIndex, participants, hcpPct, decimals, basis);
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
  basis: RoundHandicapBasis = "relative",
) {
  const balances = zeroBalances(allPlayers);
  const details: MedalPollaDetail[] = [];
  const firstPlayedNine = roundHalfHoles(order, "first_half");
  const secondPlayedNine = roundHalfHoles(order, "second_half");
  const components: Array<[
    Exclude<MedalPollaDetail["key"], "mini">,
    string,
    number[],
    BetConfig["polla"]["first9"] | undefined,
  ]> = [];
  if (firstPlayedNine.length === 9) components.push(["first9", `Polla 1ª vuelta · H${firstPlayedNine[0]}–H${firstPlayedNine.at(-1)}`, firstPlayedNine, cfg?.first9]);
  if (secondPlayedNine.length === 9) components.push(["second9", `Polla 2ª vuelta · H${secondPlayedNine[0]}–H${secondPlayedNine.at(-1)}`, secondPlayedNine, cfg?.second9]);
  if (order.length >= 18) components.push(["total18", "Polla 18 hoyos", order.slice(0, 18), cfg?.total18]);

  for (const [key, label, holes, componentCfg] of components) {
    if (componentCfg?.enabled !== true) continue;
    const participants = playersByIds(allPlayers, componentCfg.participantIds);
    const configIsValid = hasCleanParticipants(allPlayers, componentCfg.participantIds, 2)
      && isFinitePositive(componentCfg.value)
      && isValidHcpPct(componentCfg.hcpPct)
      && isValidDecimalMode(componentCfg.decimals);
    if (!configIsValid || participants.length < 2) continue;
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
      basis,
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
  basis: RoundHandicapBasis = "relative",
) {
  const participants = playersByIds(allPlayers, cfg?.participantIds);
  const balances = zeroBalances(participants);
  const details: MedalPollaDetail[] = [];
  const configIsValid = cfg?.enabled !== true || (
    hasCleanParticipants(allPlayers, cfg.participantIds, 2)
    && isFinitePositive(cfg.value)
    && isValidHcpPct(cfg.hcpPct)
    && isValidDecimalMode(cfg.decimals)
  );
  if (cfg?.enabled !== true || !configIsValid || participants.length < 2) return { balances, details };

  // Always the last three holes actually PLAYED. If starting on 10, these are 7-8-9.
  const result = calculateMedalComponent("mini", "Mini Polla · últimos 3", order.slice(-3), cfg.value, course, scores, participants, cfg.hcpPct, cfg.decimals, basis);
  details.push(result.detail);
  for (const [id, amount] of Object.entries(result.balances)) balances[id] = (balances[id] ?? 0) + amount;
  return { balances, details };
}

export function calculateManualBets(allPlayers: Player[], bets: ManualBet[]) {
  const balances = zeroBalances(allPlayers);
  const activeBets = (Array.isArray(bets) ? bets : []).filter((bet) => bet && typeof bet === "object" && (bet.enabled === undefined || bet.enabled === true));
  const ids = activeBets.map((bet) => bet.id);
  const identitiesAreValid = ids.every(isPersonalInstanceId) && new Set(ids).size === ids.length;
  const details = activeBets.map((bet) => {
    const amounts = bet.amounts && typeof bet.amounts === "object" ? bet.amounts : {};
    const values = allPlayers.map((player) => amounts[player.id] ?? 0);
    const total = values.reduce((sum, amount) => sum + Number(amount), 0);
    const valid = identitiesAreValid
      && typeof bet.name === "string"
      && Boolean(bet.name.trim())
      && values.every((amount) => typeof amount === "number")
      && isFiniteZeroSum(values as number[]);
    if (valid) {
      for (const p of allPlayers) balances[p.id] = (balances[p.id] ?? 0) + Number(amounts[p.id] ?? 0);
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
