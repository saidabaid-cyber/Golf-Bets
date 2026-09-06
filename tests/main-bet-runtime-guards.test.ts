import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBallFriend,
  calculateFoursomes,
  calculateManualBets,
  calculateMiniPolla,
  calculateMonkey,
  calculatePersonalBet,
  calculatePersonalBets,
  calculatePolla,
  calculateRabbits,
  calculateSkins,
  calculateUnits,
  payoutWinnerTakesFromAll,
} from "../lib/engine";
import { initialBets } from "../lib/new-round-bets";
import { calculateCounterBet, calculateLoba, emptyCounterBetKeepers, requiredSideBetCaptures } from "../lib/side-bets";
import type { BetConfig, CounterBetConfig, Course, FoursomeSegment, LobaHole, ManualBet, PersonalBet, Player } from "../lib/types";

const players: Player[] = [
  { id: "a", name: "A", handicap: 0 },
  { id: "b", name: "B", handicap: 3 },
  { id: "c", name: "C", handicap: 6 },
  { id: "d", name: "D", handicap: 9 },
  { id: "e", name: "E", handicap: 12 },
];
const ids = players.map((player) => player.id);
const order = Array.from({ length: 18 }, (_, index) => index + 1);
const course: Course = {
  id: "runtime-guards",
  name: "Runtime guards",
  teeName: "Test",
  holes: order.map((hole) => ({ number: hole, par: 4, strokeIndex: hole })),
};
const scores = Object.fromEntries(order.map((hole) => [hole, { a: 3, b: 4, c: 5, d: 6, e: 7 }]));

function unsafe<T>(value: unknown) {
  return value as T;
}

function assertFiniteNumbers(value: unknown, path = "result") {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) assertFiniteNumbers(item, `${path}.${key}`);
}

function assertZeroRecord(record: Record<string, number>) {
  assert.equal(Object.values(record).every((value) => value === 0), true);
  assertFiniteNumbers(record);
}

test("Monkey rejects malformed active stakes and HCP while preserving the missing-HCP legacy default", () => {
  const base = { ...initialBets(ids).monkey!, enabled: true, participantIds: ids.slice(0, 3) };
  const malformed = [
    { ...base, value: undefined },
    { ...base, value: Number.NaN },
    { ...base, hcpPct: Number.POSITIVE_INFINITY },
    { ...base, participantIds: ["a", "a", "b"] },
  ];

  for (const config of malformed) {
    const result = calculateMonkey(course, scores, players, unsafe<BetConfig["monkey"]>(config), order);
    assert.equal(result.valid, false);
    assert.deepEqual(result.details, []);
    assertZeroRecord(result.balances);
    assertFiniteNumbers(result);
  }

  const legacy = calculateMonkey(
    course,
    scores,
    players,
    unsafe<BetConfig["monkey"]>({ enabled: true, value: 20, participantIds: ids.slice(0, 3) }),
    [1],
  );
  assert.equal(legacy.valid, true);
  assert.equal(legacy.hcpPct, 100);
  assert.equal(legacy.details.length, 1);
  assertFiniteNumbers(legacy);
});

test("Rabbits and Skins fail closed on incomplete active economics or HCP settings", () => {
  const defaults = initialBets(ids);
  const rabbits = { ...defaults.rabbits, enabled: true };
  const skins = { ...defaults.skins, enabled: true };
  const malformedRabbits = [
    { ...rabbits, value: undefined },
    { ...rabbits, hcpPct: Number.NaN },
    { ...rabbits, decimals: "unknown" },
    { ...rabbits, mode: "unknown" },
    { ...rabbits, mode: undefined, accumulate: undefined },
  ];
  const malformedSkins = [
    { ...skins, value: Number.NEGATIVE_INFINITY },
    { ...skins, hcpPct: 101 },
    { ...skins, decimals: undefined },
    { ...skins, mode: "unknown" },
    { ...skins, mode: undefined, accumulate: undefined },
  ];

  for (const config of malformedRabbits) {
    const result = calculateRabbits(course, scores, players, unsafe<BetConfig["rabbits"]>(config), order);
    assert.deepEqual(result.events, []);
    assertZeroRecord(result.won);
    assertFiniteNumbers(result);
  }
  for (const config of malformedSkins) {
    const result = calculateSkins(course, scores, players, unsafe<BetConfig["skins"]>(config), order);
    assert.deepEqual(result.events, []);
    assertZeroRecord(result.won);
    assertFiniteNumbers(result);
  }

  const legacyRabbits = calculateRabbits(course, scores, players, { ...rabbits, mode: undefined }, [1, 2]);
  const legacySkins = calculateSkins(course, scores, players, { ...skins, mode: undefined }, [1, 2]);
  assert.equal(legacyRabbits.events.length > 0, true);
  assert.equal(legacySkins.events.length, 2);
});

test("Units reject malformed active values and discard non-finite capture events", () => {
  const base = { ...initialBets(ids).units, enabled: true };
  for (const config of [
    { ...base, value: undefined },
    { ...base, value: Number.NaN },
    { ...base, copaValue: Number.POSITIVE_INFINITY },
    { ...base, participantIds: ["a", "a"] },
  ]) {
    const result = calculateUnits(players, [{ id: "u", hole: 1, playerId: "a", amount: 2 }], unsafe<BetConfig["units"]>(config));
    assertZeroRecord(result.balances);
    assertZeroRecord(result.net);
    assertFiniteNumbers(result);
  }

  const corruptEvents = calculateUnits(players, [
    unsafe({ id: "nan", hole: 1, playerId: "a", amount: Number.NaN }),
    unsafe({ id: "infinity", hole: 1, playerId: "b", amount: Number.POSITIVE_INFINITY }),
  ], base);
  assertZeroRecord(corruptEvents.balances);
  assertFiniteNumbers(corruptEvents);
  assertZeroRecord(payoutWinnerTakesFromAll(players, { a: 1 }, Number.NaN));
  assertZeroRecord(payoutWinnerTakesFromAll(players, { a: Number.POSITIVE_INFINITY }, 100));
});

test("Foursome and Ball Friend reject incomplete active configuration without provisional money", () => {
  const four = players.slice(0, 4);
  const fourIds = four.map((player) => player.id);
  const defaults = initialBets(fourIds);
  const foursome = { ...defaults.foursome, enabled: true, mode: "fixed_points" as const };
  const segment: FoursomeSegment[] = [{ id: "seg-0", startIndex: 0, endIndex: 17, basePair: ["a", "b"] }];
  const malformedFoursomes = [
    { ...foursome, segmentSize: undefined },
    { ...foursome, mode: undefined },
    { ...foursome, fixedValue: Number.NaN },
    { ...foursome, pointValue: undefined },
    { ...foursome, hcpPct: Number.NaN },
    { ...foursome, decimals: "unknown" },
    { ...foursome, pressureMultiplier: Number.POSITIVE_INFINITY },
    { ...foursome, baseMode: "fixed", fixedBaseHandicap: Number.NaN },
    { ...foursome, baseMode: "fixed", fixedBaseHandicap: 999 },
    { ...foursome, participantIds: ["a", "a", "b", "c"] },
  ];
  for (const config of malformedFoursomes) {
    const result = calculateFoursomes(course, scores, four, unsafe<BetConfig["foursome"]>(config), segment, order);
    assert.deepEqual(result.matches, []);
    assertZeroRecord(result.balances);
    assertZeroRecord(result.provisionalBalances);
    assertFiniteNumbers(result);
  }

  const malformedSegment = calculateFoursomes(course, scores, four, foursome, [unsafe({ id: "bad", startIndex: Number.NaN, endIndex: 17, basePair: ["a", "b"] })], order);
  assert.deepEqual(malformedSegment.matches, []);
  assertFiniteNumbers(malformedSegment);

  const courseBasisFoursome = calculateFoursomes(
    course,
    scores,
    four,
    unsafe({ ...foursome, baseMode: "hidden-corrupt" }),
    segment,
    order,
    "course",
  );
  assert.equal(courseBasisFoursome.matches.length, 1);
  assertFiniteNumbers(courseBasisFoursome);

  const ballFriend = { ...initialBets(ids).ballFriend, enabled: true };
  const setup = Object.fromEntries(order.map((hole) => [hole, { restPlayerId: "e", teamA: ["a", "b"] }]));
  const malformedBallFriend = [
    { ...ballFriend, value: undefined },
    { ...ballFriend, hcpPct: Number.NaN },
    { ...ballFriend, decimals: "unknown" },
    { ...ballFriend, maxScore: Number.POSITIVE_INFINITY },
    { ...ballFriend, baseMode: "fixed", fixedBaseHandicap: Number.NaN },
    { ...ballFriend, baseMode: "fixed", fixedBaseHandicap: 999 },
    { ...ballFriend, participantIds: ["a", "a", "b", "c"] },
  ];
  for (const config of malformedBallFriend) {
    const result = calculateBallFriend(course, scores, players, unsafe<BetConfig["ballFriend"]>(config), setup, order);
    assert.deepEqual(result.details, []);
    assertZeroRecord(result.balances);
    assertFiniteNumbers(result);
  }

  const legacyBase = calculateBallFriend(course, scores, players, unsafe({ ...ballFriend, baseMode: undefined }), setup, [1]);
  assert.equal(legacyBase.details.length, 1);
  assertFiniteNumbers(legacyBase);

  const courseBasisBallFriend = calculateBallFriend(
    course,
    scores,
    players,
    unsafe({ ...ballFriend, baseMode: "hidden-corrupt" }),
    setup,
    [1],
    "course",
  );
  assert.equal(courseBasisBallFriend.details.length, 1);
  assertFiniteNumbers(courseBasisBallFriend);
});

test("Polla components and Mini Polla never declare winners from malformed active inputs", () => {
  const defaults = initialBets(ids);
  const disabled = {
    first9: { ...defaults.polla.first9, enabled: false },
    second9: { ...defaults.polla.second9, enabled: false },
    total18: { ...defaults.polla.total18, enabled: false },
  };
  const first9 = { ...defaults.polla.first9, enabled: true };
  for (const component of [
    { ...first9, value: undefined },
    { ...first9, value: 0 },
    { ...first9, value: Number.NaN },
    { ...first9, hcpPct: undefined },
    { ...first9, hcpPct: Number.POSITIVE_INFINITY },
    { ...first9, decimals: "unknown" },
    { ...first9, participantIds: ["a", "a"] },
  ]) {
    const result = calculatePolla(course, scores, players, unsafe<BetConfig["polla"]>({ ...disabled, first9: component }), order);
    assert.deepEqual(result.details, []);
    assertZeroRecord(result.balances);
    assertFiniteNumbers(result);
  }
  const absentComponents = calculatePolla(course, scores, players, unsafe<BetConfig["polla"]>({}), order);
  assert.deepEqual(absentComponents.details, []);
  assertFiniteNumbers(absentComponents);

  const mini = { ...defaults.miniPolla, enabled: true };
  for (const config of [
    { ...mini, value: undefined },
    { ...mini, value: 0 },
    { ...mini, hcpPct: Number.NaN },
    { ...mini, decimals: undefined },
    { ...mini, participantIds: ["a", "a"] },
  ]) {
    const result = calculateMiniPolla(course, scores, players, unsafe<BetConfig["miniPolla"]>(config), order);
    assert.deepEqual(result.details, []);
    assertZeroRecord(result.balances);
    assertFiniteNumbers(result);
  }

  const courseWithoutH9 = { ...course, holes: course.holes.filter((hole) => hole.number !== 9) };
  const incomplete = calculatePolla(courseWithoutH9, scores, players, { ...disabled, first9 }, order);
  assert.equal(incomplete.details[0].complete, false);
  assert.deepEqual(incomplete.details[0].winnerIds, []);
  assertZeroRecord(incomplete.balances);
});

test("Counter bets and Loba keep malformed active configurations unsettled and finite", () => {
  const counter: CounterBetConfig = { ...initialBets(ids).vipers, enabled: true };
  const counterEvents = [{ id: "v-9", kind: "vipers" as const, hole: 9, playerId: "a", quantity: 2 }];
  for (const config of [
    { ...counter, value: undefined },
    { ...counter, value: Number.NaN },
    { ...counter, secondNinePressed: true, secondNineMultiplier: Number.POSITIVE_INFINITY },
    { ...counter, participantIds: ["a", "a"] },
  ]) {
    const result = calculateCounterBet("vipers", players, unsafe<CounterBetConfig>(config), counterEvents, emptyCounterBetKeepers(), order, new Set(order));
    assert.equal(result.halves.every((half) => !half.settled), true);
    assert.deepEqual(result.transfers, []);
    assertZeroRecord(result.balances);
    assertFiniteNumbers(result);
  }
  const malformedEvents = calculateCounterBet("vipers", players, counter, [
    unsafe({ ...counterEvents[0], id: "nan", quantity: Number.NaN, distanceToHole: Number.NaN }),
    unsafe({ ...counterEvents[0], id: "infinity", quantity: Number.POSITIVE_INFINITY }),
  ], emptyCounterBetKeepers(), order, new Set(order));
  assert.equal(malformedEvents.totalQuantity, 0);
  assertFiniteNumbers(malformedEvents);

  const loba = { ...initialBets(ids).loba, enabled: true };
  const capture: LobaHole = { lobaPlayerId: "a", partnerId: "b", mode: "partner", fireMultiplier: 1, unitCounts: {} };
  for (const config of [
    { ...loba, value: undefined },
    { ...loba, value: Number.NaN },
    { ...loba, hcpPct: Number.POSITIVE_INFINITY },
    { ...loba, participantIds: ["a", "a"] },
    { ...loba, unitsEnabled: true, unitValue: undefined },
    { ...loba, unitsEnabled: true, unitValue: Number.NaN },
    { ...loba, value: 0, unitsEnabled: "true", unitValue: 100 },
    { ...loba, value: 0, unitsEnabled: true, unitValue: 100, duplicateUnitsByMode: "false" },
  ]) {
    const result = calculateLoba(course, scores, players, unsafe<BetConfig["loba"]>(config), { 1: capture }, [1], new Set([1]));
    assert.deepEqual(result.details, []);
    assert.deepEqual(result.transfers, []);
    assertZeroRecord(result.balances);
    assertFiniteNumbers(result);
  }

  const legacyHcp = calculateLoba(course, scores, players, unsafe({ ...loba, hcpPct: undefined }), { 1: capture }, [1], new Set([1]));
  assert.equal(legacyHcp.details.length, 1);
  assert.equal(legacyHcp.details[0].hcpPct, 100);
  const malformedUnitCapture = calculateLoba(
    course,
    scores,
    players,
    { ...loba, unitsEnabled: true, unitValue: 100 },
    { 1: { ...capture, unitCounts: { a: Number.POSITIVE_INFINITY } } },
    [1],
    new Set([1]),
  );
  assert.equal(malformedUnitCapture.details[0].playerUnits.a.manual, 0);
  assertFiniteNumbers(malformedUnitCapture);
});

test("main bets and side counters execute only when enabled is literal true", () => {
  const corruptEnabled = unsafe<boolean>("true");
  const defaults = initialBets(ids);

  const rabbits = calculateRabbits(course, scores, players, { ...defaults.rabbits, enabled: corruptEnabled }, [1]);
  assert.deepEqual(rabbits.events, []);
  assertZeroRecord(rabbits.won);

  const skins = calculateSkins(course, scores, players, { ...defaults.skins, enabled: corruptEnabled }, [1]);
  assert.deepEqual(skins.events, []);
  assertZeroRecord(skins.won);

  const monkey = calculateMonkey(course, scores, players, { ...defaults.monkey!, enabled: corruptEnabled }, [1]);
  assert.deepEqual(monkey.details, []);
  assertZeroRecord(monkey.balances);

  const units = calculateUnits(players, [{ id: "unit", hole: 1, playerId: "a", amount: 2 }], { ...defaults.units, enabled: corruptEnabled }, course, scores, [1]);
  assertZeroRecord(units.balances);
  assertZeroRecord(units.net);

  const fourPlayers = players.slice(0, 4);
  const foursomeConfig = {
    ...initialBets(fourPlayers.map((player) => player.id)).foursome,
    enabled: corruptEnabled,
    mode: "fixed_points" as const,
  };
  const foursome = calculateFoursomes(course, scores, fourPlayers, foursomeConfig, [{ id: "all", startIndex: 0, endIndex: 17, basePair: ["a", "b"] }], order);
  assert.deepEqual(foursome.matches, []);
  assertZeroRecord(foursome.balances);

  const ballFriendSetup = Object.fromEntries(order.map((hole) => [hole, { restPlayerId: "e", teamA: ["a", "b"] }]));
  const ballFriend = calculateBallFriend(course, scores, players, { ...defaults.ballFriend, enabled: corruptEnabled }, ballFriendSetup, [1]);
  assert.deepEqual(ballFriend.details, []);
  assertZeroRecord(ballFriend.balances);

  const polla = calculatePolla(course, scores, players, unsafe({
    first9: { ...defaults.polla.first9, enabled: "true" },
    second9: { ...defaults.polla.second9, enabled: false },
    total18: { ...defaults.polla.total18, enabled: false },
  }), order);
  assert.deepEqual(polla.details, []);
  assertZeroRecord(polla.balances);

  const miniPolla = calculateMiniPolla(course, scores, players, { ...defaults.miniPolla, enabled: corruptEnabled }, order);
  assert.deepEqual(miniPolla.details, []);
  assertZeroRecord(miniPolla.balances);

  const counterEvents = [{ id: "camel", kind: "camels" as const, hole: 9, playerId: "a", quantity: 2 }];
  const counter = calculateCounterBet("camels", players, { ...defaults.camels, enabled: corruptEnabled }, counterEvents, emptyCounterBetKeepers(), order, new Set(order));
  assert.equal(counter.halves.every((half) => !half.settled), true);
  assert.deepEqual(counter.transfers, []);
  assertZeroRecord(counter.balances);

  const lobaCapture: LobaHole = { lobaPlayerId: "a", partnerId: "b", mode: "partner", fireMultiplier: 1, unitCounts: {} };
  const loba = calculateLoba(course, scores, players, { ...defaults.loba, enabled: corruptEnabled }, { 1: lobaCapture }, [1], new Set([1]));
  assert.deepEqual(loba.details, []);
  assert.deepEqual(loba.transfers, []);
  assertZeroRecord(loba.balances);

  const captureErrors = requiredSideBetCaptures(
    9,
    [{ kind: "camels", config: { ...defaults.camels, enabled: corruptEnabled } }],
    emptyCounterBetKeepers(),
    unsafe({ ...defaults.loba, enabled: "true" }),
    undefined,
    [
      { id: "camel-a", kind: "camels", hole: 9, playerId: "a", quantity: 1 },
      { id: "camel-b", kind: "camels", hole: 9, playerId: "b", quantity: 1 },
    ],
    order,
  );
  assert.deepEqual(captureErrors, []);
});

test("Personal and Manual keep missing enabled active for legacy, but reject every non-boolean flag", () => {
  const personal: PersonalBet = {
    id: "personal-enabled",
    rivalMode: "group",
    rivalPlayerId: "b",
    rivalName: "B",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "none",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    nassauVersion: 2,
    carryEnabled: false,
    components: { match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false },
  };
  const manual: ManualBet = { id: "manual-enabled", name: "Manual", amounts: { a: 100, b: -100 } };
  const selected = players.slice(0, 2);

  const legacyPersonal = calculatePersonalBets([personal], "a", selected, course, scores, order);
  assert.equal(legacyPersonal.results.length, 1);
  assert.deepEqual(legacyPersonal.balances, { a: 100, b: -100 });
  const legacyManual = calculateManualBets(selected, [manual]);
  assert.equal(legacyManual.details.length, 1);
  assert.deepEqual(legacyManual.balances, { a: 100, b: -100 });

  for (const enabled of ["true", 1, null, {}, []]) {
    const corruptPersonal = calculatePersonalBets([{ ...personal, enabled: unsafe(enabled) }], "a", selected, course, scores, order);
    assert.deepEqual(corruptPersonal.results, [], `Personal executed for ${JSON.stringify(enabled)}`);
    assertZeroRecord(corruptPersonal.balances);

    const corruptManual = calculateManualBets(selected, [{ ...manual, enabled: unsafe(enabled) }]);
    assert.deepEqual(corruptManual.details, [], `Manual executed for ${JSON.stringify(enabled)}`);
    assertZeroRecord(corruptManual.balances);
  }

  assert.equal(calculatePersonalBets([{ ...personal, enabled: true }], "a", selected, course, scores, order).results.length, 1);
  assert.equal(calculateManualBets(selected, [{ ...manual, enabled: true }]).details.length, 1);
  assert.deepEqual(calculatePersonalBets([{ ...personal, enabled: false }], "a", selected, course, scores, order).results, []);
  assert.deepEqual(calculateManualBets(selected, [{ ...manual, enabled: false }]).details, []);
});

test("Personal V2 feature flags and component maps cannot create money through truthiness", () => {
  const personal: PersonalBet = {
    id: "personal-feature-shape",
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: "b",
    rivalName: "B",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "none",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    nassauVersion: 2,
    carryEnabled: false,
    components: { match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false },
  };
  const corruptBets = [
    { ...personal, carryEnabled: "false", components: { ...personal.components, match2: true } },
    { ...personal, components: { ...personal.components, match1: "false" } },
    { ...personal, components: { match1: true } },
  ];

  for (const corrupt of corruptBets) {
    const result = calculatePersonalBet(unsafe<PersonalBet>(corrupt), "a", course, scores, order);
    assert.equal(result.totalMoney, 0);
    assert.equal(Object.values(result.componentMoney).every((amount) => amount === 0), true);
    assert.deepEqual(result.liveComponents, []);
    assertFiniteNumbers(result);
  }

  const valid = calculatePersonalBet(personal, "a", course, scores, order);
  assert.equal(valid.totalMoney, 100);
  assert.deepEqual(valid.componentMoney, { match1: 100, medal1: 0, match2: 0, medal2: 0, match18: 0, medal18: 0 });
});

test("Personal fails closed for every malformed economic or rival term", () => {
  const personal: PersonalBet = {
    id: "personal-runtime",
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: "b",
    rivalName: "B",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "owner",
    advantageStrokes: 2,
    back9Multiplier: 1,
    pressureMultiplier: 2,
    pressureNine: "holes_10_18",
    nassauVersion: 2,
    carryEnabled: false,
    components: { match1: true, medal1: false, match2: true, medal2: false, match18: false, medal18: false },
  };
  const malformed: Array<[string, unknown]> = [
    ["missing value", { ...personal, baseValue: undefined }],
    ["NaN value", { ...personal, baseValue: Number.NaN }],
    ["infinite value", { ...personal, baseValue: Number.POSITIVE_INFINITY }],
    ["negative value", { ...personal, baseValue: -1 }],
    ["missing bet identity", { ...personal, id: undefined }],
    ["blank bet identity", { ...personal, id: "  " }],
    ["unknown V2 rival mode", { ...personal, rivalMode: undefined }],
    ["missing group rival", { ...personal, rivalPlayerId: undefined }],
    ["owner as group rival", { ...personal, rivalPlayerId: "a" }],
    ["missing advantage", { ...personal, advantageStrokes: undefined }],
    ["NaN advantage", { ...personal, advantageStrokes: Number.NaN }],
    ["fractional advantage", { ...personal, advantageStrokes: 1.5 }],
    ["negative advantage", { ...personal, advantageStrokes: -1 }],
    ["missing advantage receiver", { ...personal, advantageReceiver: undefined }],
    ["missing pressure multiplier", { ...personal, pressureMultiplier: undefined }],
    ["NaN pressure multiplier", { ...personal, pressureMultiplier: Number.NaN }],
    ["fractional pressure multiplier", { ...personal, pressureMultiplier: 1.5 }],
    ["oversized pressure multiplier", { ...personal, pressureMultiplier: 6 }],
    ["invalid explicit pressure nine", { ...personal, pressureNine: "unknown" }],
    ["blank external name", { ...personal, rivalMode: "external", rivalPlayerId: undefined, rivalName: " ", externalScores: {} }],
    ["invalid external identity", { ...personal, rivalMode: "external", rivalPlayerId: undefined, rivalName: "Rival", externalRivalId: 42, externalScores: {} }],
    ["padded external identity", { ...personal, rivalMode: "external", rivalPlayerId: undefined, rivalName: "Rival", externalRivalId: " padded", externalScores: {} }],
    ["spaced external identity", { ...personal, rivalMode: "external", rivalPlayerId: undefined, rivalName: "Rival", externalRivalId: "rival id", externalScores: {} }],
    ["invalid external score map", { ...personal, rivalMode: "external", rivalPlayerId: undefined, rivalName: "Rival", externalScores: "scores" }],
  ];

  for (const [label, corrupt] of malformed) {
    const result = calculatePersonalBet(unsafe<PersonalBet>(corrupt), "a", course, scores, order);
    assert.equal(result.totalMoney, 0, label);
    assert.equal(Object.values(result.componentMoney).every((amount) => amount === 0), true, label);
    assert.equal(result.liveComponents.every((component) => component.ownerMoney === 0), true, label);
    assertFiniteNumbers(result, label);
  }

  for (const [label, corruptScores] of [
    ["NaN owner score", { ...scores, 1: { ...scores[1], a: Number.NaN } }],
    ["zero rival score", { ...scores, 1: { ...scores[1], b: 0 } }],
  ] as const) {
    const result = calculatePersonalBet(personal, "a", course, corruptScores, order);
    assert.equal(result.totalMoney, 0, label);
    assert.deepEqual(result.liveComponents, [], label);
    assertFiniteNumbers(result, label);
  }
});

test("Personal aggregate rejects missing roster identities and duplicate instances", () => {
  const personal: PersonalBet = {
    id: "personal-aggregate",
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: "b",
    rivalName: "B",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: "none",
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    nassauVersion: 2,
    carryEnabled: false,
    components: { match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false },
  };
  const selected = players.slice(0, 2);
  const malformed = [
    calculatePersonalBets([{ ...personal, rivalPlayerId: "missing" }], "a", selected, course, scores, order),
    calculatePersonalBets([personal], "missing", selected, course, scores, order),
    calculatePersonalBets([personal, { ...personal }], "a", selected, course, scores, order),
  ];
  for (const result of malformed) {
    assert.equal(result.results.every((item) => item.totalMoney === 0), true);
    assertZeroRecord(result.balances);
    assertZeroRecord(result.provisionalBalances);
    assertFiniteNumbers(result);
  }
});

test("Personal preserves zero-stroke, pressure relevance and legacy defaults", () => {
  const firstNineOnly: PersonalBet = {
    id: "personal-compatible",
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: "b",
    rivalName: "B",
    externalScores: {},
    baseValue: 100,
    advantageReceiver: unsafe(undefined),
    advantageStrokes: 0,
    back9Multiplier: 1,
    pressureMultiplier: unsafe(Number.NaN),
    pressureNine: unsafe("irrelevant"),
    nassauVersion: 2,
    carryEnabled: unsafe("irrelevant"),
    components: { match1: true, medal1: false, match2: false, medal2: false, match18: false, medal18: false },
  };
  const current = calculatePersonalBet(firstNineOnly, "a", course, scores, order);
  assert.equal(current.totalMoney, 100);
  assert.equal(current.pressureMultiplier, 1);
  assertFiniteNumbers(current);

  const legacy = calculatePersonalBet(unsafe<PersonalBet>({
    ...firstNineOnly,
    rivalMode: undefined,
    nassauVersion: undefined,
    components: undefined,
    carryEnabled: undefined,
    pressureMultiplier: undefined,
    pressureNine: undefined,
    back9Multiplier: undefined,
    advantageReceiver: "none",
  }), "a", course, scores, order);
  assert.equal(legacy.totalMoney, 600);
  assert.equal(legacy.pressureMultiplier, 1);
  assertFiniteNumbers(legacy);

  const missingLegacyPressureNine = calculatePersonalBet({
    ...firstNineOnly,
    advantageReceiver: "none",
    pressureMultiplier: 2,
    pressureNine: undefined,
    carryEnabled: false,
    components: { ...firstNineOnly.components, match2: true },
  }, "a", course, scores, order);
  assert.equal(missingLegacyPressureNine.totalMoney, 300);
  assert.equal(missingLegacyPressureNine.pressureNine, "holes_10_18");
  assertFiniteNumbers(missingLegacyPressureNine);
});
