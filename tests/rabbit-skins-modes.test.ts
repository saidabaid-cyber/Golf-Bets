import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRabbitMode, normalizeSkinsMode } from "../lib/bet-modes";
import { calculateRabbits, calculateSkins, payoutWinnerTakesFromAll } from "../lib/engine";
import { skinHoleNotice } from "../lib/hole-bet-display";
import { initialBets, restoreBetConfig } from "../lib/new-round-bets";
import { restoreRoundSnapshot } from "../lib/round-editing";
import { persistRoundHistory, readStoredJson, STORAGE_KEYS } from "../lib/round-utils";
import type { BetConfig, Course, HoleScore, Player, RoundSnapshot } from "../lib/types";

const players: Player[] = [
  { id: "a", name: "Jugador A", handicap: 0 },
  { id: "b", name: "Jugador B", handicap: 0 },
];
const ids = players.map((player) => player.id);
const order = Array.from({ length: 18 }, (_, index) => index + 1);
const course: Course = {
  id: "mode-test",
  name: "Prueba",
  teeName: "General",
  holes: order.map((number) => ({ number, par: 4, strokeIndex: number })),
};

function rabbits(mode?: BetConfig["rabbits"]["mode"]): BetConfig["rabbits"] {
  return { enabled: true, ...(mode ? { mode } : {}), value: 100, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: ids };
}

function skins(mode?: BetConfig["skins"]["mode"]): BetConfig["skins"] {
  return { enabled: true, ...(mode ? { mode } : {}), value: 50, hcpPct: 100, decimals: "decimal", accumulate: true, participantIds: ids };
}

test("legacy mode values resolve to the original Conejos and Skins behavior", () => {
  assert.equal(normalizeRabbitMode(undefined), "continuous");
  assert.equal(normalizeSkinsMode(undefined), "carry");

  const scores = {
    1: { a: 4, b: 4 },
    2: { a: 4, b: 4 },
    3: { a: 3, b: 4 },
    4: { a: 3, b: 4 },
  };
  assert.deepEqual(
    calculateRabbits(course, scores, players, rabbits(), [1, 2, 3, 4]),
    calculateRabbits(course, scores, players, rabbits("continuous"), [1, 2, 3, 4]),
  );
  assert.deepEqual(
    calculateSkins(course, scores, players, skins(), [1, 2, 3, 4]),
    calculateSkins(course, scores, players, skins("carry"), [1, 2, 3, 4]),
  );
});

test("restoring legacy Skins without a mode preserves its accumulate flag", () => {
  const legacy = {
    enabled: true,
    value: 50,
    hcpPct: 100,
    decimals: "decimal" as const,
    accumulate: false,
    participantIds: ids,
  };
  const restored = restoreBetConfig({ skins: JSON.parse(JSON.stringify(legacy)) }, ids).skins;
  assert.equal(restored.mode, undefined);
  const scores = { 1: { a: 4, b: 4 }, 2: { a: 3, b: 4 } };
  assert.equal(calculateSkins(course, scores, players, restored, [1, 2]).won.a, 1);
});

test("6 Conejos allows at most one settled rabbit in every physical three-hole block", () => {
  const scores: Record<number, HoleScore> = {};
  for (const hole of order) scores[hole] = { a: 3, b: 4 };
  // The final block exercises settlement on H18 after arriving free.
  scores[16] = { a: 4, b: 4 };
  scores[17] = { a: 4, b: 4 };

  const result = calculateRabbits(course, scores, players, rabbits("three_hole_blocks"), order);
  const wins = result.events.filter((event) => event.type === "win");

  assert.equal(wins.length, 6);
  assert.deepEqual(wins.map((event) => event.hole), [2, 5, 8, 11, 14, 18]);
  assert.deepEqual(wins.map((event) => event.rabbitNumber), [1, 2, 3, 4, 5, 6]);
  assert.ok(wins.every((event) => event.count === 1));
  assert.equal(result.events.some((event) => [3, 6, 9, 12, 15].includes(event.hole)), false);
  assert.equal(Object.values(result.won).reduce((sum, count) => sum + count, 0), 6);
});

test("6 Conejos closes a won block, starts clean on the next block, and never carries", () => {
  const scores = {
    1: { a: 3, b: 4 },
    2: { a: 3, b: 4 },
    3: { a: 3, b: 4 },
    4: { a: 4, b: 4 },
    5: { a: 4, b: 4 },
    6: { a: 4, b: 4 },
    7: { a: 3, b: 4 },
    8: { a: 3, b: 4 },
  };
  const result = calculateRabbits(course, scores, players, rabbits("three_hole_blocks"), order.slice(0, 9));

  assert.equal(result.events.some((event) => event.hole === 3), false, "H3 must stay closed after the H2 win");
  assert.equal(result.events.some((event) => event.type === "accumulate"), false);
  assert.deepEqual(result.events.filter((event) => event.type === "win").map((event) => ({ hole: event.hole, count: event.count, rabbit: event.rabbitNumber })), [
    { hole: 2, count: 1, rabbit: 1 },
    { hole: 8, count: 1, rabbit: 3 },
  ]);
  assert.ok(result.events.some((event) => event.hole === 4 && event.rabbitNumber === 2), "H4 starts a clean second opportunity");
  assert.ok(result.events.some((event) => event.hole === 7 && event.rabbitNumber === 3 && event.type === "grab"));
});

test("Skins accumulated and non-accumulated variants settle ties independently", () => {
  const scores = {
    1: { a: 4, b: 4 },
    2: { a: 4, b: 4 },
    3: { a: 3, b: 4 },
  };
  const accumulated = calculateSkins(course, scores, players, skins("carry"), [1, 2, 3]);
  const independent = calculateSkins(course, scores, players, skins("no_carry"), [1, 2, 3]);

  assert.equal(accumulated.won.a, 3);
  assert.equal(accumulated.events[2].count, 3);
  assert.equal(independent.won.a, 1);
  assert.equal(independent.events[2].count, 1);
  assert.ok(independent.events.slice(0, 2).every((event) => event.count === 0 && event.carry === 1));
  assert.deepEqual(skinHoleNotice(independent.events[0], 50, false, (id) => id, "no_carry"), ["⛳ Skin sin ganador · no se acumula"]);
});

test("non-accumulated Skins pays one per unique hole through H18 and remains zero-sum", () => {
  const scores = {
    1: { a: 3, b: 4 },
    2: { a: 4, b: 3 },
    3: { a: 4, b: 4 },
    4: { a: 3, b: 4 },
    18: { a: 4, b: 3 },
  };
  const result = calculateSkins(course, scores, players, skins("no_carry"), [1, 2, 3, 4, 18]);
  assert.deepEqual(result.won, { a: 2, b: 2 });
  assert.ok(result.events.filter((event) => event.winnerId).every((event) => event.count === 1));
  const balances = payoutWinnerTakesFromAll(players, result.won, 50);
  assert.equal(Object.values(balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test("new mode fields survive historical save, reload, and round restoration", () => {
  const bets = initialBets(ids);
  bets.rabbits = { ...bets.rabbits, enabled: true, mode: "three_hole_blocks" };
  bets.skins = { ...bets.skins, enabled: true, mode: "no_carry" };
  const scores = Object.fromEntries(order.map((hole) => [hole, { a: 3, b: 4 }])) as Record<number, HoleScore>;
  const snapshot: RoundSnapshot = {
    id: "round-modes",
    date: "2026-09-05",
    courseName: course.name,
    teeName: course.teeName,
    ownerName: players[0].name,
    ownerId: players[0].id,
    betResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0,
    netResult: 0,
    categoryResults: {},
    players,
    scores,
    courseSnapshot: course,
    order,
    betConfig: bets,
  };
  const values = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string) { values.set(key, value); },
    getItem(key: string) { return values.get(key) ?? null; },
  };
  persistRoundHistory(storage, [snapshot]);
  const loaded = readStoredJson<RoundSnapshot[]>(storage, STORAGE_KEYS.history, []);
  const restored = restoreRoundSnapshot(loaded[0]);

  assert.ok(restored);
  assert.equal(restored.id, "round-modes");
  assert.equal(restored.betConfig?.rabbits.mode, "three_hole_blocks");
  assert.equal(restored.betConfig?.skins.mode, "no_carry");
  assert.equal(restored.betConfig?.rabbits.value, 100);
  assert.equal(restored.betConfig?.skins.value, 50);
  assert.equal(calculateRabbits(course, restored.scores!, players, restored.betConfig!.rabbits, order).events.filter((event) => event.type === "win").length, 6);
  assert.equal(calculateSkins(course, restored.scores!, players, restored.betConfig!.skins, order).won.a, 18);
});
