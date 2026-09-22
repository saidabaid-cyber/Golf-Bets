/** Synthetic mathematical fixtures only. Not a course catalog or real scores. */
import { BET_REGISTRY } from "../../lib/bets/registry";
import {
  calculateBallFriend, calculateFoursomes, calculateManualBets, calculateMiniPolla,
  calculateMonkey, calculatePersonalBets, calculatePolla, calculateRabbits,
  calculateSkins, calculateUnits, completedHole, payoutWinnerTakesFromAll, playOrder,
} from "../../lib/engine";
import { initialBets } from "../../lib/new-round-bets";
import { calculateCounterBet, calculateLoba, emptyCounterBetKeepers } from "../../lib/side-bets";
import { calculateSupplementalBets, createSupplementalBet } from "../../lib/supplemental-bets";
import type {
  BetConfig, Course, CounterBetEvent, FoursomeSegment, HandicapMode, HoleScore,
  LobaHole, PersonalBet, Player, PuttsByHole, RoundHandicapBasis, UnitEvent,
} from "../../lib/types";

export type MatrixId = typeof BET_REGISTRY[number]["id"];
export type MatrixScenario = {
  id: string;
  start?: 1 | 10;
  holes?: 9 | 18;
  captured?: number;
  ties?: boolean;
  handicaps?: Array<number | null>;
  pct?: number;
  decimal?: HandicapMode;
  basis?: RoundHandicapBasis;
  stake?: number;
  seed?: number;
  differentTees?: boolean;
};

export const commonScenarios: readonly MatrixScenario[] = [
  { id: "normal-18" },
  { id: "all-tied-push", ties: true, handicaps: [0, 0, 0, 0] },
  { id: "start-10-18", start: 10 },
  { id: "first-nine", holes: 9 },
  { id: "start-10-nine", holes: 9, start: 10 },
  { id: "no-capture", captured: 0 },
  { id: "only-first-hole", captured: 1 },
  { id: "only-start-10", start: 10, captured: 1 },
  { id: "incomplete-eight", captured: 8 },
  { id: "incomplete-seventeen", captured: 17 },
  { id: "cent-stake", stake: 0.01 },
  { id: "decimal-stake", stake: 12.35 },
  { id: "large-finite-stake", stake: 1000000 },
];

export const handicapScenarios: readonly MatrixScenario[] = [
  { id: "hcp-zero-percent", pct: 0 },
  { id: "hcp-eighty-percent", pct: 80 },
  { id: "hcp-decimal-percent", pct: 83.5 },
  { id: "hcp-min-max", handicaps: [-15, 36, 0, 18.5] },
  { id: "hcp-decimal", handicaps: [0, 5.5, 10.5, 18.5] },
  { id: "hcp-missing", handicaps: [0, null, 10, 18] },
  { id: "hcp-course-basis", basis: "course" },
  { id: "per-player-tee-cards", differentTees: true },
];

/** Capability selection is explicit: no pretend handicap coverage for units/putts/manual. */
export function scenariosFor(id: MatrixId): readonly MatrixScenario[] {
  const usesRoundHcp = ["rabbits", "skins", "foursome", "ball_friend", "monkey", "polla_first", "polla_second", "polla_total", "mini_polla", "loba", "individual_pressures", "team_pressures", "chicago", "vegas"].includes(id);
  return [...commonScenarios, ...(usesRoundHcp ? handicapScenarios : []),
    ...Array.from({ length: 16 }, (_, seed) => ({ id: `seed-${seed}`, seed, start: seed % 2 ? 10 as const : 1 as const, holes: seed % 3 ? 18 as const : 9 as const }))];
}

export function matrixFixture(scenario: MatrixScenario = { id: "normal" }) {
  const order = playOrder(scenario.start ?? 1).slice(0, scenario.holes ?? 18);
  const players: Player[] = ["qa-a", "qa-b", "qa-c", "qa-d"].map((id, index) => ({
    id, name: `Synthetic ${index + 1}`, handicap: scenario.handicaps?.[index] ?? (scenario.handicaps?.[index] === null ? null : [0, 8, 12, 18][index]),
  }));
  const ids = players.map((player) => player.id);
  const course: Course = {
    id: "synthetic-mathematical-course", name: "SYNTHETIC QA — never catalog data", teeName: "Fixture only",
    holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
  };
  if (scenario.differentTees) course.playerHoleCards = Object.fromEntries(ids.map((id, index) => [id, course.holes.map((hole) => ({ ...hole, strokeIndex: ((hole.number + index * 4 - 1) % 18) + 1 }))]));
  const scores: Record<number, HoleScore> = {};
  const putts: PuttsByHole = {};
  const captured = order.slice(0, scenario.captured ?? order.length);
  let random = ((scenario.seed ?? 42) + 1) >>> 0;
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
  for (const hole of captured) {
    scores[hole] = Object.fromEntries(ids.map((id, index) => [id, scenario.ties ? 4 : scenario.seed === undefined ? 3 + ((hole + index * 3) % 5) : 1 + (next() % 12)]));
    putts[hole] = Object.fromEntries(ids.map((id, index) => [id, scenario.ties ? 2 : (hole + index) % 4]));
  }
  const stake = scenario.stake ?? 25;
  const config = { enabled: true, value: stake, hcpPct: scenario.pct ?? 100, decimals: scenario.decimal ?? "round", participantIds: ids };
  const bets = initialBets(ids);
  bets.rabbits = { ...bets.rabbits, ...config, accumulate: true };
  bets.skins = { ...bets.skins, ...config, accumulate: true };
  bets.monkey = { enabled: true, value: stake, hcpPct: scenario.pct ?? 100, participantIds: ids.slice(0, 3) };
  bets.units = { ...bets.units, enabled: true, value: stake };
  // Medal engines intentionally accept only their historical two decimal modes.
  const medal = { ...config, decimals: scenario.decimal === "partial" ? "partial" as const : "round" as const };
  bets.foursome = { ...bets.foursome, ...medal, mode: "fixed_points", fixedValue: stake, pointValue: stake, segmentSize: 9 };
  bets.ballFriend = { ...bets.ballFriend, ...medal, maxScore: 9 };
  bets.polla = { first9: { ...medal }, second9: { ...medal }, total18: { ...medal } };
  bets.miniPolla = { ...medal };
  for (const kind of ["vipers", "camels", "fish"] as const) bets[kind] = { ...bets[kind], enabled: true, value: stake, settlementMode: "halves" };
  bets.loba = { ...bets.loba, enabled: true, value: stake, hcpPct: scenario.pct ?? 100, unitsEnabled: false };
  const segments: FoursomeSegment[] = order.reduce<FoursomeSegment[]>((all, _, index) => index % 9 ? all : [...all, { id: `segment-${index}`, startIndex: index, endIndex: Math.min(index + 8, order.length - 1), basePair: ids.slice(0, 2) }], []);
  const ballFriend = Object.fromEntries(order.map((hole) => [hole, { teamA: ids.slice(0, 2) as [string, string] }]));
  const loba: Record<number, LobaHole> = Object.fromEntries(order.map((hole) => [hole, { lobaPlayerId: ids[0], mode: "partner", partnerId: ids[1], fireMultiplier: 1, unitCounts: {} }]));
  const events: CounterBetEvent[] = captured.map((hole, index) => ({ id: `synthetic-counter-${hole}`, hole, playerId: ids[index % 4], kind: "vipers", quantity: scenario.ties ? 0 : 1 + index % 3 }));
  const units: UnitEvent[] = captured.flatMap((hole, index) => scenario.ties ? [] : [{ id: `synthetic-unit-${hole}`, hole, playerId: ids[index % 4], amount: index % 2 ? -1 : 1 }]);
  const personal: PersonalBet = {
    id: "synthetic-personal", enabled: true, rivalMode: "group", rivalPlayerId: ids[1], rivalName: players[1].name, externalScores: {}, baseValue: stake,
    advantageReceiver: "none", advantageStrokes: 0, back9Multiplier: 1, pressureMultiplier: 1, pressureNine: "holes_10_18", nassauVersion: 2, carryEnabled: false,
    components: { match1: true, medal1: true, match2: order.length === 18, medal2: order.length === 18, match18: order.length === 18, medal18: order.length === 18 },
  };
  const supplemental = BET_REGISTRY.flatMap((definition) => {
    if (definition.templateEditor.kind !== "supplemental") return [];
    let bet = createSupplementalBet(definition.templateEditor.type, players, `synthetic-${definition.id}`, order.length === 9 ? 9 : 18);
    if ("hcpPct" in bet) bet = { ...bet, hcpPct: scenario.pct ?? 100 };
    if ("decimals" in bet) bet = { ...bet, decimals: scenario.decimal ?? "round" };
    if ("value" in bet) bet = { ...bet, value: stake };
    if ("valuePerStroke" in bet) bet = { ...bet, valuePerStroke: stake };
    if ("valuePerPoint" in bet) bet = { ...bet, valuePerPoint: stake };
    if ("valuePerUnit" in bet) bet = { ...bet, valuePerUnit: stake };
    if ("ante" in bet) bet = { ...bet, ante: stake };
    return [bet];
  });
  return { scenario, order, players, ids, course, scores, putts, stake, bets, segments, ballFriend, loba, events, units, personal, supplemental, basis: scenario.basis ?? "relative" as RoundHandicapBasis };
}

export type MatrixFixture = ReturnType<typeof matrixFixture>;

export function evaluateMatrix(id: MatrixId, f: MatrixFixture): { balances: Record<string, number>; detail: unknown } {
  const { course, scores, players, bets, order, basis } = f;
  const complete = new Set(order.filter((hole) => completedHole(hole, scores, f.ids)));
  switch (id) {
    case "rabbits": {
      const result = calculateRabbits(course, scores, players, bets.rabbits, order, basis);
      return { balances: payoutWinnerTakesFromAll(players, result.won, bets.rabbits.value), detail: result };
    }
    case "skins": {
      const result = calculateSkins(course, scores, players, bets.skins, order, basis);
      return { balances: payoutWinnerTakesFromAll(players, result.won, bets.skins.value), detail: result };
    }
    case "monkey": { const result = calculateMonkey(course, scores, players, bets.monkey, order, basis); return { balances: result.balances, detail: result }; }
    case "units": { const result = calculateUnits(players, f.units, bets.units, course, scores, order); return { balances: result.balances, detail: result }; }
    case "foursome": { const result = calculateFoursomes(course, scores, players, bets.foursome, f.segments, order, basis); return { balances: result.balances, detail: result }; }
    case "ball_friend": { const result = calculateBallFriend(course, scores, players, bets.ballFriend, f.ballFriend, order, basis); return { balances: result.balances, detail: result }; }
    case "polla_first": case "polla_second": case "polla_total": {
      const key = id === "polla_first" ? "first9" : id === "polla_second" ? "second9" : "total18";
      const config: BetConfig["polla"] = { first9: { ...bets.polla.first9, enabled: false }, second9: { ...bets.polla.second9, enabled: false }, total18: { ...bets.polla.total18, enabled: false }, [key]: bets.polla[key] };
      const result = calculatePolla(course, scores, players, config, order, basis); return { balances: result.balances, detail: result };
    }
    case "mini_polla": { const result = calculateMiniPolla(course, scores, players, bets.miniPolla, order, basis); return { balances: result.balances, detail: result }; }
    case "vipers": case "camels": case "fish": { const result = calculateCounterBet(id, players, bets[id]!, f.events.map((event) => ({ ...event, kind: id })), emptyCounterBetKeepers(), order, complete); return { balances: result.balances, detail: result }; }
    case "loba": { const result = calculateLoba(course, scores, players, bets.loba, f.loba, order, complete, basis); return { balances: result.balances, detail: result }; }
    case "personals": { const result = calculatePersonalBets([f.personal], f.ids[0], players, course, scores, order); return { balances: result.balances, detail: result }; }
    case "manuals": { const result = calculateManualBets(players, [{ id: "synthetic-manual", name: "Synthetic adjustment", amounts: { [f.ids[0]]: f.scenario.ties ? 0 : f.stake, [f.ids[1]]: f.scenario.ties ? 0 : -f.stake } }]); return { balances: result.balances, detail: result }; }
    default: {
      const bet = f.supplemental.find((item) => item.type === id);
      if (!bet) throw new Error(`Unmapped active registry modality: ${id}`);
      const result = calculateSupplementalBets([bet], players, course, scores, f.putts, order, basis);
      return { balances: result.balances, detail: result };
    }
  }
}

export const matrixInventory = BET_REGISTRY.map((definition) => ({
  id: definition.id, label: definition.label, engineAdapter: definition.engineAdapter,
  capabilities: definition.configCapabilities, scenarios: scenariosFor(definition.id).map((scenario) => scenario.id),
}));
