import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateCounterBet,
  calculateLoba,
  counterQuantity,
  emptyCounterBetKeepers,
  isZeroSum,
  requiredSideBetCapture,
  setCounterQuantity,
} from "../lib/side-bets";
import { calculateBallFriend, calculateFoursomes, calculateMiniPolla, calculatePersonalBets, calculatePolla, calculateRabbits, calculateSkins, calculateUnits, mergeBalances, payoutWinnerTakesFromAll, playersByIds } from "../lib/engine";
import type { CounterBetConfig, CounterBetEvent, CounterBetKind, LobaHole, Player } from "../lib/types";
import { fullRoundBallFriend, fullRoundBets, fullRoundCourse, fullRoundOrder, fullRoundPersonal, fullRoundPlayers, fullRoundScores, fullRoundSegments } from "./fixtures/full-round";

const players: Player[] = ["said", "juan", "pedro", "flavio", "daniel"].map((id, index) => ({ id, name: id, handicap: index * 3 }));
const ids = players.map(player => player.id);
const order = Array.from({ length: 18 }, (_, index) => index + 1);

function counterConfig(multiplier = 1): CounterBetConfig {
  return { enabled: true, value: 100, secondNineMultiplier: multiplier, participantIds: ids };
}

function events(kind: CounterBetKind): CounterBetEvent[] {
  return [
    { id: "a", kind, hole: 1, playerId: "juan", quantity: 2 },
    { id: "b", kind, hole: 1, playerId: "said", quantity: 3 },
    { id: "c", kind, hole: 8, playerId: "pedro", quantity: 5 },
    { id: "d", kind, hole: 10, playerId: "flavio", quantity: 2 },
    { id: "e", kind, hole: 18, playerId: "daniel", quantity: 1 },
  ];
}

for (const kind of ["vipers", "camels", "fish"] as CounterBetKind[]) {
  test(`${kind}: admite múltiples eventos por jugador/hoyo y liquida ambas vueltas en suma cero`, () => {
    const keepers = emptyCounterBetKeepers();
    keepers[kind] = { holes_1_9: "said", holes_10_18: "juan" };
    const result = calculateCounterBet(kind, players, counterConfig(2), events(kind), keepers, order);

    assert.equal(result.halves[0].quantity, 10);
    assert.equal(result.halves[0].value, 100);
    assert.deepEqual(result.halves[0].balances, { said: -4000, juan: 1000, pedro: 1000, flavio: 1000, daniel: 1000 });
    assert.equal(result.halves[1].quantity, 3);
    assert.equal(result.halves[1].value, 200);
    assert.deepEqual(result.halves[1].balances, { said: 600, juan: -2400, pedro: 600, flavio: 600, daniel: 600 });
    assert.equal(result.zeroSum, true);
    assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
  });

  test(`${kind}: segunda vuelta 3x, H9/H18 y captura pendiente no se liquidan antes de tiempo`, () => {
    const keepers = emptyCounterBetKeepers();
    keepers[kind] = { holes_1_9: "said", holes_10_18: "juan" };
    const completed = new Set(order.filter(hole => hole !== 18));
    const result = calculateCounterBet(kind, players, counterConfig(3), events(kind), keepers, order, completed);
    assert.equal(result.halves[0].settled, true);
    assert.equal(result.halves[1].settled, false);
    assert.ok(result.transfers.every(transfer => transfer.metadata?.nine === "holes_1_9"));
    assert.equal(requiredSideBetCapture(9, [{ kind, config: counterConfig() }], emptyCounterBetKeepers(), { enabled: false, participantIds: [] }, undefined).includes("Selecciona quién"), true);
    assert.equal(requiredSideBetCapture(18, [{ kind, config: counterConfig() }], keepers, { enabled: false, participantIds: [] }, undefined), "");
  });
}

test("contadores rápidos conservan cantidad numérica, permiten borrar y no duplican la llave", () => {
  let state: CounterBetEvent[] = [];
  state = setCounterQuantity(state, "vipers", 4, "said", 3, "first");
  state = setCounterQuantity(state, "vipers", 4, "said", 5, "second");
  assert.equal(state.length, 1);
  assert.equal(counterQuantity(state, "vipers", 4, "said"), 5);
  state = setCounterQuantity(state, "vipers", 4, "said", 0);
  assert.deepEqual(state, []);
});

test("H9 y H18 identifican cada keeper faltante con varias apuestas activas", () => {
  const enabled = (["vipers", "camels", "fish"] as CounterBetKind[]).map((kind) => ({ kind, config: counterConfig() }));
  const keepers = emptyCounterBetKeepers();
  assert.match(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined), /🐍 Víboras/);
  keepers.vipers.holes_1_9 = "said";
  assert.match(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined), /🐫 Camellos/);
  keepers.camels.holes_1_9 = "juan";
  assert.match(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined), /🐟 Peces/);
  keepers.fish.holes_1_9 = "pedro";
  assert.equal(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined), "");

  assert.match(requiredSideBetCapture(18, enabled, keepers, { enabled: false, participantIds: [] }, undefined), /🐍 Víboras/);
  for (const kind of ["vipers", "camels", "fish"] as CounterBetKind[]) keepers[kind].holes_10_18 = "daniel";
  assert.equal(requiredSideBetCapture(18, enabled, keepers, { enabled: false, participantIds: [] }, undefined), "");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /const sideBetError = requiredSideBetCapture/);
  assert.match(page, /if \(sideBetError\) \{ setFeedback\(sideBetError\); return; \}/);
});

function lobaConfig(patch: Partial<{ value: number; unitsEnabled: boolean; unitValue: number; duplicateUnitsByMode: boolean }> = {}) {
  return { enabled: true, participantIds: ids, value: 100, unitsEnabled: false, unitValue: 100, duplicateUnitsByMode: false, ...patch };
}

function lobaHole(patch: Partial<LobaHole> = {}): LobaHole {
  return { lobaPlayerId: "said", mode: "partner", partnerId: "pedro", fireMultiplier: 1, winner: "loba_team", unitCounts: {}, ...patch };
}

test("Loba con pareja 1x distribuye 2 vs 3 mediante transferencias jugador contra jugador", () => {
  const result = calculateLoba(players, lobaConfig(), { 1: lobaHole() }, [1]);
  assert.deepEqual(result.balances, { said: 300, juan: -200, pedro: 300, flavio: -200, daniel: -200 });
  assert.equal(result.transfers.length, 6);
  assert.equal(result.details[0].effectiveValue, 100);
  assert.equal(result.zeroSum, true);
});

test("Loba sola 2x y sola anticipada 3x funcionan 1 vs 4", () => {
  const solo = calculateLoba(players, lobaConfig(), { 2: lobaHole({ mode: "solo", partnerId: undefined, winner: "loba_team" }) }, [2]);
  assert.deepEqual(solo.balances, { said: 800, juan: -200, pedro: -200, flavio: -200, daniel: -200 });
  const anticipated = calculateLoba(players, lobaConfig(), { 3: lobaHole({ mode: "solo_anticipated", partnerId: undefined, winner: "opponents" }) }, [3]);
  assert.deepEqual(anticipated.balances, { said: -1200, juan: 300, pedro: 300, flavio: 300, daniel: 300 });
  assert.ok(isZeroSum(solo.balances) && isZeroSum(anticipated.balances));
});

for (const fireMultiplier of [5, 10, 20, 17]) {
  test(`Loba aplica 🔥${fireMultiplier}x solo al valor base`, () => {
    const result = calculateLoba(players, lobaConfig({ unitsEnabled: true, unitValue: 100, duplicateUnitsByMode: true }), {
      18: lobaHole({ mode: "solo", partnerId: undefined, fireMultiplier, unitCounts: { said: 1, juan: 1 } }),
    }, [18]);
    assert.equal(result.details[0].effectiveValue, 100 * fireMultiplier * 2);
    assert.equal(result.details[0].effectiveUnitValue, 200);
    assert.equal(result.zeroSum, true);
  });
}

test("Unidades Loba pertenecen al equipo y reproducen el caso 1 vs 4 exacto", () => {
  const result = calculateLoba(players, lobaConfig({ value: 0, unitsEnabled: true, unitValue: 200 }), {
    7: lobaHole({ mode: "solo", partnerId: undefined, winner: "tie", unitCounts: { said: 1, juan: 1, pedro: 2, flavio: 0, daniel: 0 } }),
  }, [7]);
  assert.equal(result.details[0].lobaUnits, 1);
  assert.equal(result.details[0].opponentUnits, 3);
  assert.deepEqual(result.balances, { said: -1600, juan: 400, pedro: 400, flavio: 400, daniel: 400 });
  assert.equal(result.zeroSum, true);
});

test("Unidades Loba OFF no liquidan y ON sin duplicar ignora modalidad y fuego", () => {
  const capture = lobaHole({ mode: "solo_anticipated", partnerId: undefined, fireMultiplier: 20, winner: "tie", unitCounts: { said: 2, juan: 1, pedro: 1 } });
  const off = calculateLoba(players, lobaConfig({ value: 0, unitsEnabled: false }), { 18: capture }, [18]);
  assert.deepEqual(off.balances, { said: 0, juan: 0, pedro: 0, flavio: 0, daniel: 0 });
  const on = calculateLoba(players, lobaConfig({ value: 0, unitsEnabled: true, unitValue: 100, duplicateUnitsByMode: false }), { 18: capture }, [18]);
  assert.equal(on.details[0].effectiveUnitValue, 100);
  assert.equal(on.zeroSum, true);
});

test("captura obligatoria de Loba explica cada dato faltante", () => {
  const keepers = emptyCounterBetKeepers();
  const base = { enabled: true, participantIds: ids };
  assert.match(requiredSideBetCapture(1, [], keepers, base, undefined), /quién es/);
  assert.match(requiredSideBetCapture(1, [], keepers, base, { fireMultiplier: 1, unitCounts: {}, lobaPlayerId: "said" }), /modalidad/);
  assert.match(requiredSideBetCapture(1, [], keepers, base, { fireMultiplier: 1, unitCounts: {}, lobaPlayerId: "said", mode: "partner" }), /pareja/);
  assert.match(requiredSideBetCapture(1, [], keepers, base, { fireMultiplier: 1, unitCounts: {}, lobaPlayerId: "said", mode: "solo" }), /resultado/);
  assert.equal(requiredSideBetCapture(1, [], keepers, base, lobaHole()), "");
});

test("ronda integral H1–18 combina motores existentes, 🐍🐫🐟🐺, reload y liquidación cero", () => {
  const ids4 = fullRoundPlayers.map(player => player.id);
  const configured = {
    ...structuredClone(fullRoundBets),
    vipers: { enabled: true, value: 100, secondNineMultiplier: 2, participantIds: ids4 },
    camels: { enabled: true, value: 80, secondNineMultiplier: 3, participantIds: ids4 },
    fish: { enabled: true, value: 50, secondNineMultiplier: 1, participantIds: ids4 },
    loba: { enabled: true, value: 100, unitsEnabled: true, unitValue: 25, duplicateUnitsByMode: true, participantIds: ids4 },
  };
  const counterEvents: CounterBetEvent[] = (["vipers", "camels", "fish"] as CounterBetKind[]).flatMap((kind, index) => [
    { id: `${kind}-1`, kind, hole: 1, playerId: ids4[index], quantity: index + 1 },
    { id: `${kind}-18`, kind, hole: 18, playerId: ids4[index + 1], quantity: index + 2 },
  ]);
  const keepers = emptyCounterBetKeepers();
  for (const kind of ["vipers", "camels", "fish"] as CounterBetKind[]) keepers[kind] = { holes_1_9: "said", holes_10_18: "cuau" };
  const lobaHoles: Record<number, LobaHole> = Object.fromEntries(fullRoundOrder.map(hole => [hole, {
    lobaPlayerId: "said", mode: hole % 3 === 0 ? "solo_anticipated" : "partner", partnerId: hole % 3 === 0 ? undefined : "cuau",
    fireMultiplier: hole === 18 ? 20 : 1, winner: hole % 2 === 0 ? "opponents" : "loba_team", unitCounts: { said: hole % 2, armando: hole % 3 === 0 ? 2 : 0 },
  } satisfies LobaHole]));
  const restored = JSON.parse(JSON.stringify({ counterEvents, keepers, lobaHoles })) as { counterEvents: CounterBetEvent[]; keepers: typeof keepers; lobaHoles: Record<number, LobaHole> };
  assert.deepEqual(restored.counterEvents, counterEvents);
  const complete = new Set(fullRoundOrder);
  const rabbits = calculateRabbits(fullRoundCourse, fullRoundScores, fullRoundPlayers, configured.rabbits, fullRoundOrder);
  const skins = calculateSkins(fullRoundCourse, fullRoundScores, fullRoundPlayers, configured.skins, fullRoundOrder);
  const rabbitBalances = payoutWinnerTakesFromAll(playersByIds(fullRoundPlayers, configured.rabbits.participantIds), rabbits.won, configured.rabbits.value);
  const skinBalances = payoutWinnerTakesFromAll(playersByIds(fullRoundPlayers, configured.skins.participantIds), skins.won, configured.skins.value);
  const balances = mergeBalances(fullRoundPlayers,
    rabbitBalances, skinBalances,
    calculateUnits(fullRoundPlayers, [], configured.units, fullRoundCourse, fullRoundScores, fullRoundOrder).balances,
    calculateFoursomes(fullRoundCourse, fullRoundScores, fullRoundPlayers, configured.foursome, fullRoundSegments, fullRoundOrder).balances,
    calculateBallFriend(fullRoundCourse, fullRoundScores, fullRoundPlayers, configured.ballFriend, fullRoundBallFriend, fullRoundOrder).balances,
    calculatePolla(fullRoundCourse, fullRoundScores, fullRoundPlayers, configured.polla, fullRoundOrder).balances,
    calculateMiniPolla(fullRoundCourse, fullRoundScores, fullRoundPlayers, configured.miniPolla, fullRoundOrder).balances,
    calculatePersonalBets([fullRoundPersonal], "said", fullRoundPlayers, fullRoundCourse, fullRoundScores, fullRoundOrder).balances,
    calculateCounterBet("vipers", fullRoundPlayers, configured.vipers, restored.counterEvents, restored.keepers, fullRoundOrder, complete).balances,
    calculateCounterBet("camels", fullRoundPlayers, configured.camels, restored.counterEvents, restored.keepers, fullRoundOrder, complete).balances,
    calculateCounterBet("fish", fullRoundPlayers, configured.fish, restored.counterEvents, restored.keepers, fullRoundOrder, complete).balances,
    calculateLoba(fullRoundPlayers, configured.loba, restored.lobaHoles, fullRoundOrder, complete).balances,
  );
  assert.equal(Object.values(balances).reduce((sum, amount) => sum + amount, 0), 0);
  assert.ok(Object.values(balances).some(amount => amount !== 0));
});
