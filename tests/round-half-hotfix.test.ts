import assert from "node:assert/strict";
import test from "node:test";

import { calculateFoursomes, calculatePolla, playOrder, segmentDefinitions } from "../lib/engine";
import { initialBets } from "../lib/new-round-bets";
import { getRoundHalf, roundHalfHoles } from "../lib/round-half";
import {
  calculateCounterBet,
  counterBetEffectiveUnitValue,
  emptyCounterBetKeepers,
  snapshotCounterBetEvents,
} from "../lib/side-bets";
import type { CounterBetConfig, CounterBetEvent, CounterBetKind, Course, HoleScore, Player } from "../lib/types";

const players: Player[] = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: `Jugador ${id.toUpperCase()}`, handicap: 0 }));
const playerIds = players.map((player) => player.id);
const course: Course = {
  id: "round-half-test",
  name: "Round Half Test",
  teeName: "Prueba",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

function counterConfig(multiplier = 2): CounterBetConfig {
  return {
    enabled: true,
    value: 100,
    settlementMode: "halves",
    secondNinePressed: multiplier > 1,
    secondNineMultiplier: multiplier,
    participantIds: playerIds,
  };
}

test("getRoundHalf clasifica H1–H9 primero cuando la salida es H1", () => {
  const order = playOrder(1);
  assert.deepEqual(roundHalfHoles(order, "first_half"), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(roundHalfHoles(order, "second_half"), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  for (const hole of order.slice(0, 9)) assert.equal(getRoundHalf({ hole, roundHoles: order }), "first_half");
  for (const hole of order.slice(9)) assert.equal(getRoundHalf({ hole, roundHoles: order }), "second_half");
});

test("getRoundHalf clasifica H10–H18 primero cuando la salida es H10", () => {
  const order = playOrder(10);
  assert.deepEqual(roundHalfHoles(order, "first_half"), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(roundHalfHoles(order, "second_half"), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const hole of order.slice(0, 9)) assert.equal(getRoundHalf({ hole, roundHoles: order }), "first_half");
  for (const hole of order.slice(9)) assert.equal(getRoundHalf({ hole, roundHoles: order }), "second_half");
});

for (const kind of ["vipers", "camels", "fish"] as CounterBetKind[]) {
  test(`${kind}: salida H10 usa $100 en H10–H18 y $200 en H1–H9`, () => {
    const order = playOrder(10);
    const config = counterConfig(2);
    const events: CounterBetEvent[] = [
      { id: `${kind}-18`, kind, hole: 18, playerId: "a", quantity: 1 },
      { id: `${kind}-9`, kind, hole: 9, playerId: "b", quantity: 1 },
    ];
    const result = calculateCounterBet(kind, players, config, events, emptyCounterBetKeepers(), order, new Set(order));

    assert.equal(counterBetEffectiveUnitValue(config, 10, order), 100);
    assert.equal(counterBetEffectiveUnitValue(config, 18, order), 100);
    assert.equal(counterBetEffectiveUnitValue(config, 1, order), 200);
    assert.equal(counterBetEffectiveUnitValue(config, 9, order), 200);
    assert.deepEqual(result.halves.map((half) => half.holes), [order.slice(0, 9), order.slice(9)]);
    assert.deepEqual(result.halves.map((half) => half.bagValue), [100, 200]);
    assert.deepEqual(result.halves.map((half) => half.keeperId), ["a", "b"]);
    assert.equal(result.halves.every((half) => Object.values(half.balances).reduce((sum, amount) => sum + amount, 0) === 0), true);
    assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
  });
}

test("salida H1 conserva valores y liquidaciones existentes", () => {
  const order = playOrder(1);
  const config = counterConfig(2);
  const events: CounterBetEvent[] = [
    { id: "v-9", kind: "vipers", hole: 9, playerId: "a", quantity: 2 },
    { id: "v-18", kind: "vipers", hole: 18, playerId: "b", quantity: 3 },
  ];
  const result = calculateCounterBet("vipers", players, config, events, emptyCounterBetKeepers(), order, new Set(order));
  assert.deepEqual(result.halves.map((half) => [half.value, half.bagValue, half.keeperId]), [[100, 200, "a"], [200, 600, "b"]]);
});

test("las liquidaciones por vuelta son independientes y cada una cierra en cero", () => {
  const order = playOrder(10);
  const events: CounterBetEvent[] = [
    { id: "c-10", kind: "camels", hole: 10, playerId: "a", quantity: 4 },
    { id: "c-1", kind: "camels", hole: 1, playerId: "b", quantity: 3 },
  ];
  const result = calculateCounterBet("camels", players, counterConfig(3), events, emptyCounterBetKeepers(), order, new Set(order));
  assert.deepEqual(result.halves.map((half) => half.bagValue), [400, 900]);
  assert.equal(result.halves[0].transfers.length, 4);
  assert.equal(result.halves[1].transfers.length, 4);
  for (const half of result.halves) assert.equal(Object.values(half.balances).reduce((sum, amount) => sum + amount, 0), 0);
  assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test("snapshot de Histórico conserva la misma clasificación y resultado mostrado en ronda", () => {
  const order = playOrder(10);
  const config = counterConfig(2);
  const events: CounterBetEvent[] = [
    { id: "f-12", kind: "fish", hole: 12, playerId: "a", quantity: 2 },
    { id: "f-4", kind: "fish", hole: 4, playerId: "b", quantity: 1 },
  ];
  const configs = { vipers: config, camels: config, fish: config };
  const live = calculateCounterBet("fish", players, config, events, emptyCounterBetKeepers(), order, new Set(order));
  const stored = JSON.parse(JSON.stringify(snapshotCounterBetEvents(events, configs, order))) as CounterBetEvent[];
  const reopened = calculateCounterBet("fish", players, config, stored, emptyCounterBetKeepers(), order, new Set(order));
  assert.deepEqual(reopened.halves, live.halves);
  assert.deepEqual(reopened.balances, live.balances);
});

test("Foursome aplica su multiplicador únicamente a la segunda vuelta jugada", () => {
  const order = playOrder(10);
  const matchPlayers = players.slice(0, 4);
  const scores: Record<number, HoleScore> = Object.fromEntries(order.map((hole) => [hole, { a: 4, b: 4, c: 5, d: 5 }]));
  const config = {
    ...initialBets(matchPlayers.map((player) => player.id)).foursome,
    enabled: true,
    mode: "points" as const,
    pointValue: 10,
    pressureMultiplier: 3 as const,
    pressureNine: "holes_10_18" as const,
  };
  const segments = segmentDefinitions(order, 18).map((segment) => ({ ...segment, basePair: ["a", "b"] }));
  const result = calculateFoursomes(course, scores, matchPlayers, config, segments, order);
  assert.equal(result.matches[0].first9PointDiff, 18);
  assert.equal(result.matches[0].second9PointDiff, 18);
  assert.equal(result.matches[0].pointMoney, 720);
  assert.equal(result.matches[0].pressureNine, "holes_1_9");
  assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test("Polla usa los componentes primera y segunda según el orden real", () => {
  const order = playOrder(10);
  const scores: Record<number, HoleScore> = Object.fromEntries(order.map((hole) => [hole, Object.fromEntries(playerIds.map((id) => [id, 4]))]));
  for (const hole of order.slice(9)) scores[hole].a = 3;
  const polla = initialBets(playerIds).polla;
  polla.first9.enabled = true;
  polla.second9.enabled = true;
  const result = calculatePolla(course, scores, players, polla, order);
  assert.deepEqual(result.details.find((detail) => detail.key === "first9")?.holes, order.slice(0, 9));
  assert.deepEqual(result.details.find((detail) => detail.key === "second9")?.holes, order.slice(9));
});
