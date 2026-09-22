import assert from "node:assert/strict";
import test from "node:test";
import { BET_REGISTRY } from "../lib/bets/registry";
import { calculateSkins, calculateMonkey, calculatePersonalBets, calculateFoursomes, calculateUnits, calculatePolla, calculateManualBets, payoutWinnerTakesFromAll } from "../lib/engine";
import { calculateSupplementalBets, createSupplementalBet, SUPPLEMENTAL_BET_LABELS } from "../lib/supplemental-bets";
import { calculateCounterBet, emptyCounterBetKeepers } from "../lib/side-bets";
import { createGroupGameTemplate, instantiateGroupGameTemplate, templateWithoutPlayerAssignments } from "../lib/group-game-template";
import { evaluateMatrix, matrixFixture, matrixInventory, scenariosFor, type MatrixFixture, type MatrixId } from "./fixtures/games-matrix";
import type { HandicapMode, SupplementalBet } from "../lib/types";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

function assertZeroSum(balances: Record<string, number>) {
  assert.ok(Object.values(balances).every(Number.isFinite), "No NaN/Infinity money");
  const gross = Object.values(balances).reduce((sum, value) => sum + Math.abs(value), 0);
  const net = Object.values(balances).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(net) <= Math.max(1e-8, gross * 1e-12), `Money must conserve: ${net}`);
}

for (const definition of BET_REGISTRY) {
  for (const scenario of scenariosFor(definition.id)) {
    test(`games matrix ${definition.id} / ${scenario.id}: deterministic, immutable, zero-sum, replay`, () => {
      const fixture = freeze(matrixFixture(scenario));
      const snapshot = JSON.stringify(fixture);
      const result = evaluateMatrix(definition.id, fixture);
      assertZeroSum(result.balances);
      assert.deepEqual(evaluateMatrix(definition.id, fixture), result, "retry must recompute, never accumulate");
      assert.deepEqual(evaluateMatrix(definition.id, JSON.parse(snapshot) as MatrixFixture), result, "serialized history roundtrip");
      assert.equal(JSON.stringify(fixture), snapshot, "engine must never mutate its input/history");
      if (scenario.ties) assert.ok(Object.values(result.balances).every((value) => value === 0), "equal handicaps, scores and counters push");
      if (scenario.captured === 0 && definition.id !== "manuals") assert.ok(Object.values(result.balances).every((value) => value === 0), "no capture cannot settle money");
      if (scenario.id === "hcp-missing") assert.ok(Object.values(result.balances).every((value) => value === 0), "missing required HCP must not silently become zero");
      if (scenario.holes === 9 && ["polla_second", "polla_total"].includes(definition.id)) assert.ok(Object.values(result.balances).every((value) => value === 0), "9 holes cannot settle a nonexistent second half or 18-hole component");
    });
  }
}

test("matrix fails closed when an active registry modality lacks an adapter or scenarios", () => {
  assert.equal(new Set(matrixInventory.map((entry) => entry.id)).size, BET_REGISTRY.length);
  assert.deepEqual(matrixInventory.map((entry) => entry.id), BET_REGISTRY.map((entry) => entry.id));
  for (const entry of matrixInventory) {
    assert.ok(entry.scenarios.length >= 29);
    assert.equal(new Set(entry.scenarios).size, entry.scenarios.length);
    assert.ok(scenariosFor(entry.id).some((scenario) => Object.values(evaluateMatrix(entry.id, matrixFixture(scenario)).balances).some((value) => value !== 0)), `${entry.id}: matrix must exercise real settlement, not only inert configurations`);
  }
});

for (const { id } of BET_REGISTRY) {
  test(`explicit participant mapping is independent of roster storage order: ${id}`, () => {
    const original = matrixFixture({ id: "roster-order", seed: 3 });
    const reordered = structuredClone(original);
    reordered.players.reverse();
    const before = evaluateMatrix(id, original).balances;
    const after = evaluateMatrix(id, reordered).balances;
    for (const player of original.players) assert.ok(Math.abs((before[player.id] ?? 0) - (after[player.id] ?? 0)) < 1e-8, player.id);
  });
}

test("habitual template instantiates all general defaults without carrying prior player identities or results", () => {
  const f = matrixFixture();
  const source = { ownerId: f.ids[0], players: f.players, startHole: 1 as const, roundHoles: 18 as const, roundHandicapBasis: f.basis, bets: f.bets, segments: f.segments, personalBets: [f.personal], supplementalBets: f.supplemental, manualBets: [{ id: "manual", name: "Synthetic", amounts: { "qa-a": 10, "qa-b": -10 } }] };
  const template = templateWithoutPlayerAssignments(createGroupGameTemplate(source, Object.fromEntries(f.ids.map((id) => [id, `member-${id}`]))));
  const before = JSON.stringify(template);
  for (const id of f.ids) assert.equal(before.includes(id), false, "habitual template cannot depend on concrete old players");
  let sequence = 0;
  const result = instantiateGroupGameTemplate({ id: "synthetic-group", name: "Synthetic group", privacy: "invite_only", players: f.players.map((p, index) => ({ memberId: `new-member-${index}`, kind: "guest" as const, name: p.name, handicap: p.handicap })), gameTemplate: template, uses: 0, updatedAt: "2026-09-22T00:00:00Z" }, () => `new-id-${sequence++}`);
  const newIds = result.players.map((player) => player.id);
  assert.deepEqual(result.bets.skins.participantIds, newIds);
  assert.deepEqual(result.bets.monkey?.participantIds, newIds.slice(0, 3));
  for (const bet of result.supplementalBets) {
    if (bet.type === "individual_nassau" || bet.type === "dollar_stroke") assert.ok(!bet.playerAId && !bet.playerBId, "head-to-head assignment remains an explicit setup decision");
    else assert.deepEqual(bet.participantIds, newIds);
    if ("teamA" in bet) assert.deepEqual(bet.teamA, []);
  }
  assert.equal(JSON.stringify(template), before);
  const scores = Object.fromEntries(f.order.map((hole) => [hole, Object.fromEntries(newIds.map((id, index) => [id, index === 0 ? 3 : 5]))]));
  const resultWithNewPlayers = calculateSkins(f.course, scores, result.players.map((p) => ({ ...p, handicap: 0 })), result.bets.skins, f.order);
  assert.equal(resultWithNewPlayers.won[newIds[0]], 18);
});

test("independent engine evaluation order cannot affect any result", () => {
  const fixture = freeze(matrixFixture());
  const forward = Object.fromEntries(BET_REGISTRY.map(({ id }) => [id, evaluateMatrix(id, fixture)]));
  const reverse = Object.fromEntries([...BET_REGISTRY].reverse().map(({ id }) => [id, evaluateMatrix(id, fixture)]));
  assert.deepEqual(reverse, forward);
});

test("catalog/tee changes cannot change an already serialized engine snapshot", () => {
  const current = matrixFixture({ id: "tees", differentTees: true });
  const historical = freeze(structuredClone(current));
  const before = BET_REGISTRY.map(({ id }) => evaluateMatrix(id, historical));
  current.course.holes.forEach((hole) => { hole.par = 5; hole.strokeIndex = 19 - hole.strokeIndex; });
  current.players.forEach((player) => { player.handicap = 36; });
  current.course.playerHoleCards = {};
  assert.deepEqual(BET_REGISTRY.map(({ id }) => evaluateMatrix(id, historical)), before);
});

test("the player's frozen tee stroke index changes allowance, not the shared course card", () => {
  const f = matrixFixture({ id: "tee-oracle", handicaps: [0, 1, 0, 0] });
  const players = f.players.slice(0, 2);
  const config = { ...f.bets.skins, participantIds: players.map((p) => p.id) };
  const scores = { 1: { "qa-a": 4, "qa-b": 5 } };
  const shared = calculateSkins(f.course, scores, players, config, [1]);
  assert.equal(shared.events[0].winnerId, undefined, "SI1 gives B one stroke and ties");
  f.course.playerHoleCards = { "qa-b": f.course.holes.map((hole) => ({ ...hole, strokeIndex: 19 - hole.number })) };
  const playerCard = calculateSkins(f.course, scores, players, config, [1]);
  assert.equal(playerCard.events[0].winnerId, "qa-a", "B's SI18 tee gives no allowance on hole 1");
});

test("supplemental display labels cannot change mathematical settlement", () => {
  const fixture = matrixFixture();
  for (const bet of fixture.supplemental) {
    const before = evaluateMatrix(bet.type, fixture).balances;
    const previous = SUPPLEMENTAL_BET_LABELS[bet.type];
    try {
      SUPPLEMENTAL_BET_LABELS[bet.type] = "Synthetic changed label";
      assert.deepEqual(evaluateMatrix(bet.type, fixture).balances, before);
    } finally { SUPPLEMENTAL_BET_LABELS[bet.type] = previous; }
  }
});

for (const mode of ["partial", "round", "decimal", "half_up", "half_down", "six_up", "four_down"] as HandicapMode[]) {
  for (const id of ["rabbits", "skins", "individual_pressures", "team_pressures", "vegas"] as MatrixId[]) {
    test(`games handicap rounding ${id}/${mode}`, () => {
      const fixture = freeze(matrixFixture({ id: mode, handicaps: [0, 5.5, 10.5, 18.5], pct: 80, decimal: mode }));
      const result = evaluateMatrix(id, fixture);
      assertZeroSum(result.balances);
      assert.deepEqual(evaluateMatrix(id, fixture), result);
    });
  }
}

for (const start of [1, 10] as const) {
  for (const carry of [false, true]) {
    test(`Skins oracle start ${start}, carry ${carry}: two pushes then a unique winner`, () => {
      const f = matrixFixture({ id: "skin-oracle", start, ties: true, handicaps: [0, 0, 0, 0] });
      f.scores[f.order[2]][f.ids[0]] = 3;
      const result = calculateSkins(f.course, f.scores, f.players, { ...f.bets.skins, mode: carry ? "carry" : "no_carry" }, f.order.slice(0, 3));
      assert.equal(result.won[f.ids[0]], carry ? 3 : 1);
      assert.deepEqual(payoutWinnerTakesFromAll(f.players, result.won, 10), { "qa-a": carry ? 90 : 30, "qa-b": carry ? -30 : -10, "qa-c": carry ? -30 : -10, "qa-d": carry ? -30 : -10 });
    });
  }
}

for (const start of [1, 10] as const) {
  test(`Polla expected winner and incomplete last hole start ${start}`, () => {
    const f = matrixFixture({ id: "medal", start, ties: true, handicaps: [0, 0, 0, 0] });
    for (const hole of f.order) f.scores[hole][f.ids[0]] = 3;
    const result = calculatePolla(f.course, f.scores, f.players, f.bets.polla, f.order);
    assert.deepEqual(result.balances, { "qa-a": 225, "qa-b": -75, "qa-c": -75, "qa-d": -75 });
    delete f.scores[f.order[17]];
    const incomplete = calculatePolla(f.course, f.scores, f.players, f.bets.polla, f.order);
    assert.deepEqual(incomplete.balances, { "qa-a": 75, "qa-b": -25, "qa-c": -25, "qa-d": -25 }, "only the completed first nine may settle");
  });
}

test("Monkey exhaustive 1-hole score orderings preserve six points and independent pairwise money", () => {
  const f = matrixFixture({ id: "monkey", handicaps: [0, 0, 0, 0] });
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) for (let c = 1; c <= 12; c++) {
    const scores = { 1: { "qa-a": a, "qa-b": b, "qa-c": c } };
    const result = calculateMonkey(f.course, scores, f.players, f.bets.monkey, [1]);
    const points = result.details[0].points;
    assert.equal(Object.values(points).reduce((sum, value) => sum + value, 0), 6);
    assertZeroSum(result.balances);
    for (const id of f.ids.slice(0, 3)) {
      const expected = f.ids.slice(0, 3).filter((rival) => rival !== id).reduce((sum, rival) => sum + (points[id] - points[rival]) * f.stake, 0);
      assert.equal(result.balances[id], expected);
    }
  }
});

for (const kind of ["vipers", "camels", "fish"] as const) for (const start of [1, 10] as const) {
  for (const multiplier of [1, 2, 3, 4, 5] as const) {
    test(`counter expected-value oracle ${kind}, start ${start}, press ${multiplier}`, () => {
      const f = matrixFixture({ id: "counter", start });
      const cfg = { ...f.bets[kind]!, value: 0.25, secondNinePressed: multiplier > 1, secondNineMultiplier: multiplier };
      const events = [{ id: "first", kind, hole: f.order[8], playerId: f.ids[0], quantity: 2 }, { id: "second", kind, hole: f.order[17], playerId: f.ids[1], quantity: 3 }];
      const result = calculateCounterBet(kind, f.players, cfg, events, emptyCounterBetKeepers(), f.order, new Set(f.order));
      const second = 0.75 * multiplier;
      assert.deepEqual(result.balances, { "qa-a": -1.5 + second, "qa-b": 0.5 - 3 * second, "qa-c": 0.5 + second, "qa-d": 0.5 + second });
      assertZeroSum(result.balances);
      assert.deepEqual(calculateCounterBet(kind, f.players, cfg, [...events].reverse(), emptyCounterBetKeepers(), f.order, new Set(f.order)).balances, result.balances);
    });
  }
}

test("signed units independent pairwise oracle is zero-sum at decimal stakes", () => {
  const f = matrixFixture({ id: "units", stake: 1.25 });
  const events = [{ id: "u1", hole: 1, playerId: "qa-a", amount: 2 }, { id: "u2", hole: 1, playerId: "qa-b", amount: -1 }];
  const result = calculateUnits(f.players, events, f.bets.units);
  assert.deepEqual(result.balances, { "qa-a": 8.75, "qa-b": -6.25, "qa-c": -1.25, "qa-d": -1.25 });
});

test("manual duplicate instance IDs fail closed instead of paying twice", () => {
  const f = matrixFixture();
  const bet = { id: "manual-retry", name: "Synthetic", amounts: { "qa-a": 10, "qa-b": -10 } };
  const result = calculateManualBets(f.players, [bet, structuredClone(bet)]);
  assert.ok(result.details.every((detail) => !detail.valid));
  assert.ok(Object.values(result.balances).every((value) => value === 0));
});

for (const type of ["individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts"] as const) {
  test(`supplemental duplicate-instance retry ${type} cannot duplicate money`, () => {
    const f = matrixFixture();
    const bet = createSupplementalBet(type, f.players, "same-instance");
    const result = calculateSupplementalBets([bet, structuredClone(bet)], f.players, f.course, f.scores, f.putts, f.order);
    assert.ok(Object.values(result.balances).every((value) => value === 0));
    assert.ok(result.results.every((item) => !item.complete));
  });
}

for (const start of [1, 10] as const) {
  test(`Nassau carry/press and foursome match presses remain deterministic start ${start}`, () => {
    const f = matrixFixture({ id: "press", start, ties: true, handicaps: [0, 0, 0, 0] });
    for (const hole of f.order.slice(9)) f.scores[hole][f.ids[0]] = 3;
    const noCarry = calculatePersonalBets([f.personal], f.ids[0], f.players, f.course, f.scores, f.order);
    const carry = calculatePersonalBets([{ ...f.personal, carryEnabled: true, pressureMultiplier: 2 }], f.ids[0], f.players, f.course, f.scores, f.order);
    assertZeroSum(noCarry.balances); assertZeroSum(carry.balances);
    assert.ok(carry.balances[f.ids[0]] >= noCarry.balances[f.ids[0]], "carry/pressure cannot reduce the sole winner's return");
    const config = { ...f.bets.foursome, mode: "match" as const, matchPresses: [{ id: "press", scope: "second" as const, startHole: f.order[10], multiplier: 2 as const }] };
    const result = calculateFoursomes(f.course, f.scores, f.players, config, f.segments, f.order);
    assertZeroSum(result.balances);
    assert.deepEqual(calculateFoursomes(f.course, f.scores, f.players, config, f.segments, f.order), result);
  });
}

for (const start of [1, 10] as const) for (const virtualMode of ["standard", "mudo", "yoyo"] as const) {
  test(`team abandonment explicit contract ${virtualMode} start ${start}`, () => {
    const f = matrixFixture({ id: "abandoned", start });
    const players = virtualMode === "standard" ? f.players : f.players.slice(0, 3);
    const base = createSupplementalBet("team_pressures", players, "abandoned") as Extract<SupplementalBet, { type: "team_pressures" }>;
    const bet = { ...base, virtualMode, abandonedPlayerIds: [players.at(-1)!.id] };
    const absent = structuredClone(f.scores);
    for (const hole of f.order) delete absent[hole][players.at(-1)!.id];
    const result = calculateSupplementalBets([bet], players, f.course, absent, {}, f.order);
    assertZeroSum(result.balances);
    assert.deepEqual(calculateSupplementalBets([bet], players, f.course, absent, {}, f.order), result);
  });
}
