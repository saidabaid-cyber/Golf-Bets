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
  setCounterDistance,
  setCounterQuantity,
  snapshotCounterBetEvents,
} from "../lib/side-bets";
import { calculateBallFriend, calculateFoursomes, calculateMiniPolla, calculateMonkey, calculatePersonalBets, calculatePolla, calculateRabbits, calculateSkins, calculateUnits, mergeBalances, payoutWinnerTakesFromAll, playersByIds } from "../lib/engine";
import type { BetConfig, CounterBetConfig, CounterBetEvent, CounterBetKind, Course, HoleScore, LobaHole, Player } from "../lib/types";
import { fullRoundBallFriend, fullRoundBets, fullRoundCourse, fullRoundOrder, fullRoundPersonal, fullRoundPlayers, fullRoundScores, fullRoundSegments } from "./fixtures/full-round";
import { initialBets, restoreCounterBetConfig } from "../lib/new-round-bets";
import { buildGeneralResultsTable } from "../lib/result-breakdown";

const players: Player[] = ["said", "juan", "pedro", "flavio", "daniel"].map((id, index) => ({ id, name: id, handicap: index * 3 }));
const ids = players.map(player => player.id);
const order = Array.from({ length: 18 }, (_, index) => index + 1);

function counterConfig(multiplier: 1 | 2 | 3 | 4 | 5 = 1, value = 100, participantIds = ids): CounterBetConfig {
  return {
    enabled: true,
    settlementMode: "halves",
    value,
    secondNinePressed: multiplier > 1,
    secondNineMultiplier: multiplier > 1 ? multiplier : 2,
    participantIds,
  };
}

function tenEventsPerHalf(kind: CounterBetKind): CounterBetEvent[] {
  return [
    { id: `${kind}-h2-said`, kind, hole: 2, playerId: "said", quantity: 3 },
    { id: `${kind}-h6-pedro`, kind, hole: 6, playerId: "pedro", quantity: 2 },
    { id: `${kind}-h9-said`, kind, hole: 9, playerId: "said", quantity: 5 },
    { id: `${kind}-h10-juan`, kind, hole: 10, playerId: "juan", quantity: 2 },
    { id: `${kind}-h15-daniel`, kind, hole: 15, playerId: "daniel", quantity: 3 },
    { id: `${kind}-h18-juan`, kind, hole: 18, playerId: "juan", quantity: 5 },
  ];
}

test("Monkey conserva exactamente 6 puntos en sus cuatro distribuciones", () => {
  const monkeyPlayers = players.slice(0, 3).map((player) => ({ ...player, handicap: 0 }));
  const cases = [
    { gross: [4, 5, 5], expected: [4, 1, 1] },
    { gross: [4, 5, 6], expected: [4, 2, 0] },
    { gross: [4, 4, 4], expected: [2, 2, 2] },
    { gross: [4, 4, 5], expected: [3, 3, 0] },
  ];
  for (const [index, sample] of cases.entries()) {
    const hole = index + 1;
    const row = Object.fromEntries(monkeyPlayers.map((player, playerIndex) => [player.id, sample.gross[playerIndex]]));
    const result = calculateMonkey(lobaCourse, { [hole]: row }, monkeyPlayers, { enabled: true, value: 20, hcpPct: 100, participantIds: monkeyPlayers.map((player) => player.id) }, [hole]);
    const earned = monkeyPlayers.map((player) => result.details[0].points[player.id]);
    assert.deepEqual(earned, sample.expected);
    assert.equal(earned.reduce((total, value) => total + value, 0), 6);
  }
});

test("Monkey aplica 100% y 80% al score neto sin cambiar su fórmula de seis puntos", () => {
  const monkeyPlayers: Player[] = [
    { id: "a", name: "Jugador A", handicap: 0 },
    { id: "b", name: "Jugador B", handicap: 5 },
    { id: "c", name: "Jugador C", handicap: 10 },
  ];
  const monkeyCourse: Course = { id: "monkey", name: "Monkey", teeName: "", holes: [{ number: 1, par: 4, strokeIndex: 5 }] };
  const scoreRows = { 1: { a: 4, b: 4, c: 4 } };
  const config = { enabled: true, value: 20, participantIds: ["a", "b", "c"] };
  const hundred = calculateMonkey(monkeyCourse, scoreRows, monkeyPlayers, { ...config, hcpPct: 100 }, [1]);
  const eighty = calculateMonkey(monkeyCourse, scoreRows, monkeyPlayers, { ...config, hcpPct: 80 }, [1]);
  assert.deepEqual(hundred.details[0].net, { a: 4, b: 3, c: 3 });
  assert.deepEqual(hundred.details[0].points, { a: 0, b: 3, c: 3 });
  assert.deepEqual(eighty.details[0].net, { a: 4, b: 4, c: 3 });
  assert.deepEqual(eighty.details[0].points, { a: 1, b: 1, c: 4 });
  assert.equal(Object.values(hundred.details[0].points).reduce((sum, value) => sum + value, 0), 6);
  assert.equal(Object.values(eighty.details[0].points).reduce((sum, value) => sum + value, 0), 6);
});

test("Monkey conserva sus umbrales SI históricos con HCP decimal", () => {
  const monkeyPlayers: Player[] = [
    { id: "a", name: "Jugador A", handicap: 0 },
    { id: "b", name: "Jugador B", handicap: 5.5 },
    { id: "c", name: "Jugador C", handicap: 10.5 },
  ];
  const monkeyCourse: Course = { id: "monkey-decimal", name: "Monkey", teeName: "", holes: [{ number: 1, par: 4, strokeIndex: 6 }] };
  const result = calculateMonkey(monkeyCourse, { 1: { a: 4, b: 4, c: 4 } }, monkeyPlayers, { enabled: true, value: 20, hcpPct: 100, participantIds: ["a", "b", "c"] }, [1]);
  assert.deepEqual(result.details[0].net, { a: 4, b: 4, c: 3 });
  assert.deepEqual(result.details[0].points, { a: 1, b: 1, c: 4 });
});

for (const kind of ["vipers", "camels", "fish"] as CounterBetKind[]) {
  for (const sample of [
    { label: "$100 sin presión", config: counterConfig(1, 100), firstValue: 100, secondValue: 100 },
    { label: "$100 con presión 2x", config: counterConfig(2, 100), firstValue: 100, secondValue: 200 },
    { label: "$200 con presión 3x", config: counterConfig(3, 200), firstValue: 200, secondValue: 600 },
  ]) {
    test(`${kind}: ${sample.label} liquida cada vuelta por separado y en suma cero`, () => {
      const result = calculateCounterBet(kind, players, sample.config, tenEventsPerHalf(kind), emptyCounterBetKeepers(), order, new Set(order));
      const firstBag = sample.firstValue * 10;
      const secondBag = sample.secondValue * 10;
      assert.deepEqual(result.halves.map(half => half.nine), ["first_half", "second_half"]);
      assert.deepEqual(result.halves.map(half => half.quantity), [10, 10]);
      assert.deepEqual(result.halves.map(half => half.value), [sample.firstValue, sample.secondValue]);
      assert.deepEqual(result.halves.map(half => half.bagValue), [firstBag, secondBag]);
      assert.deepEqual(result.halves.map(half => half.keeperId), ["said", "juan"]);
      assert.deepEqual(result.halves[0].balances, { said: -firstBag * 4, juan: firstBag, pedro: firstBag, flavio: firstBag, daniel: firstBag });
      assert.deepEqual(result.halves[1].balances, { said: secondBag, juan: -secondBag * 4, pedro: secondBag, flavio: secondBag, daniel: secondBag });
      assert.equal(isZeroSum(result.halves[0].balances), true);
      assert.equal(isZeroSum(result.halves[1].balances), true);
      assert.equal(result.zeroSum, true);
      assert.equal(result.totalBagValue, firstBag + secondBag);
      assert.equal(result.transfers.length, 8);
      assert.deepEqual(result.transfers.slice(0, 4).map(transfer => transfer.amount), Array(4).fill(firstBag));
      assert.deepEqual(result.transfers.slice(4).map(transfer => transfer.amount), Array(4).fill(secondBag));
    });
  }
}

test("los balances de las dos vueltas llegan al Resumen General sin convertirse en cero", () => {
  const result = calculateCounterBet("vipers", players, counterConfig(2), tenEventsPerHalf("vipers"), emptyCounterBetKeepers(), order, new Set(order));
  const general = buildGeneralResultsTable(ids, [{ key: "vipers", label: "🐍 Víboras", balances: result.balances, active: true, played: true }], result.balances);
  assert.equal(general.categories.length, 1);
  assert.equal(general.rows.every(row => row.consistent), true);
  assert.equal(general.rows.every(row => row.cells.vipers === result.balances[row.playerId]), true);
  assert.equal(general.rows.some(row => row.cells.vipers !== 0), true);
  assert.equal(general.grandTotal, 0);
});

test("snapshot conserva presión, multiplicador y valor efectivo por vuelta", () => {
  const configs = { vipers: counterConfig(2), camels: counterConfig(5), fish: counterConfig(1) };
  const eventRows: CounterBetEvent[] = [
    { id: "v-h9", kind: "vipers", hole: 9, playerId: ids[0], quantity: 2 },
    { id: "v-h10", kind: "vipers", hole: 10, playerId: ids[1], quantity: 3 },
    { id: "c-h18", kind: "camels", hole: 18, playerId: ids[2], quantity: 1 },
    { id: "f-h18", kind: "fish", hole: 18, playerId: ids[3], quantity: 1 },
  ];
  const stored = JSON.parse(JSON.stringify(snapshotCounterBetEvents(eventRows, configs, order))) as CounterBetEvent[];
  assert.deepEqual(stored.map(event => [event.effectiveUnitValue, event.effectiveTotalValue]), [[100, 200], [200, 600], [500, 500], [100, 100]]);
  assert.equal(configs.vipers.secondNinePressed, true);
  assert.equal(configs.fish.secondNinePressed, false);
  const restored = calculateCounterBet("vipers", players, configs.vipers, stored, emptyCounterBetKeepers(), order, new Set(order));
  assert.deepEqual(restored.halves.map(half => half.bagValue), [200, 600]);
});

test("configuración anterior sin presión explícita conserva 1x o infiere su multiplicador guardado", () => {
  const noMultiplier: CounterBetConfig = { enabled: true, settlementMode: "round", value: 100, participantIds: ids };
  const savedMultiplier: CounterBetConfig = { enabled: true, value: 100, secondNineMultiplier: 3, participantIds: ids };
  const eventRows: CounterBetEvent[] = [
    { id: "old-h9", kind: "fish", hole: 9, playerId: ids[0], quantity: 1 },
    { id: "old-h10", kind: "fish", hole: 10, playerId: ids[1], quantity: 1 },
  ];
  assert.deepEqual(calculateCounterBet("fish", players, noMultiplier, eventRows, emptyCounterBetKeepers(), order, new Set(order)).halves.map(half => half.value), [100, 100]);
  assert.deepEqual(calculateCounterBet("fish", players, savedMultiplier, eventRows, emptyCounterBetKeepers(), order, new Set(order)).halves.map(half => half.value), [100, 300]);
});

test("Víboras desempata por menor distancia dentro de cada vuelta y conserva la distancia al editar", () => {
  let eventRows: CounterBetEvent[] = [
    { id: "v-9-a", kind: "vipers", hole: 9, playerId: ids[0], quantity: 1 },
    { id: "v-9-b", kind: "vipers", hole: 9, playerId: ids[1], quantity: 2 },
    { id: "v-18-c", kind: "vipers", hole: 18, playerId: ids[2], quantity: 1 },
  ];
  assert.match(requiredSideBetCapture(9, [{ kind: "vipers", config: counterConfig() }], emptyCounterBetKeepers(), { enabled: false, participantIds: [] }, undefined, eventRows, order), /distancia/);
  eventRows = setCounterDistance(eventRows, "vipers", 9, ids[0], 75);
  eventRows = setCounterDistance(eventRows, "vipers", 9, ids[1], 30);
  eventRows = setCounterQuantity(eventRows, "vipers", 9, ids[1], 3);
  assert.equal(eventRows.find(event => event.playerId === ids[1] && event.hole === 9)?.distanceToHole, 30);
  const result = calculateCounterBet("vipers", players, counterConfig(), eventRows, emptyCounterBetKeepers(), order, new Set(order));
  assert.deepEqual(result.halves.map(half => half.keeperId), [ids[1], ids[2]]);
  assert.equal(requiredSideBetCapture(9, [{ kind: "vipers", config: counterConfig() }], emptyCounterBetKeepers(), { enabled: false, participantIds: [] }, undefined, eventRows, order), "");
});

test("cada bolsa se liquida solo al completar su propia vuelta jugada", () => {
  const eventRows: CounterBetEvent[] = [
    { id: "v-h9", kind: "vipers", hole: 9, playerId: ids[0], quantity: 1 },
    { id: "v-h18", kind: "vipers", hole: 18, playerId: ids[1], quantity: 1 },
  ];
  const afterNine = new Set(order.slice(0, 9));
  const result = calculateCounterBet("vipers", players, counterConfig(2), eventRows, emptyCounterBetKeepers(), order, afterNine);
  assert.equal(result.halves[0].settled, true);
  assert.equal(result.halves[1].settled, false);
  assert.equal(result.transfers.length, 4);
  assert.ok(result.transfers.every(transfer => transfer.metadata?.nine === "first_half"));
});

test("una salida por H10 conserva dos liquidaciones independientes en orden de juego", () => {
  const startAtTen = [...Array.from({ length: 9 }, (_, index) => index + 10), ...Array.from({ length: 9 }, (_, index) => index + 1)];
  const eventRows: CounterBetEvent[] = [
    { id: "camel-18", kind: "camels", hole: 18, playerId: ids[0], quantity: 1 },
    { id: "camel-9", kind: "camels", hole: 9, playerId: ids[1], quantity: 1 },
  ];
  const result = calculateCounterBet("camels", players, counterConfig(), eventRows, emptyCounterBetKeepers(), startAtTen, new Set(startAtTen));
  assert.deepEqual(result.halves.map(half => [half.lastEventHole, half.keeperId]), [[18, ids[0]], [9, ids[1]]]);
});

for (const kind of ["camels", "fish"] as CounterBetKind[]) {
  test(`${kind}: empate del último hoyo usa la selección manual de esa vuelta`, () => {
    const eventRows: CounterBetEvent[] = [
      { id: `${kind}-a`, kind, hole: 18, playerId: ids[0], quantity: 1 },
      { id: `${kind}-b`, kind, hole: 18, playerId: ids[1], quantity: 1 },
    ];
    const keepers = emptyCounterBetKeepers();
    assert.match(requiredSideBetCapture(18, [{ kind, config: counterConfig() }], keepers, { enabled: false, participantIds: [] }, undefined, eventRows, order), /Selecciona quién/);
    keepers[kind].holes_10_18 = ids[1];
    const result = calculateCounterBet(kind, players, counterConfig(), eventRows, keepers, order, new Set(order));
    assert.equal(result.halves[1].keeperId, ids[1]);
    assert.equal(result.zeroSum, true);
  });
}

test("restaurar borradores conserva datos antiguos y las rondas nuevas nacen por vueltas", () => {
  const fresh = initialBets(ids).vipers;
  const saved: CounterBetConfig = { enabled: true, value: 75, secondNineMultiplier: 3, participantIds: ids.slice(0, 4) };
  const restored = restoreCounterBetConfig(fresh, saved);
  assert.equal(restored.settlementMode, undefined);
  assert.equal(restored.secondNineMultiplier, 3);
  assert.equal(restored.value, 75);
  assert.deepEqual(restoreCounterBetConfig(fresh).settlementMode, "halves");
});

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
  let eventRows: CounterBetEvent[] = (["vipers", "camels", "fish"] as CounterBetKind[]).flatMap(kind => [
    { id: `${kind}-9-a`, kind, hole: 9, playerId: "said", quantity: 1 },
    { id: `${kind}-9-b`, kind, hole: 9, playerId: "juan", quantity: 1 },
    { id: `${kind}-18-a`, kind, hole: 18, playerId: "pedro", quantity: 1 },
    { id: `${kind}-18-b`, kind, hole: 18, playerId: "daniel", quantity: 1 },
  ]);
  assert.match(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined, eventRows, order), /🐍 Víbora/);
  eventRows = setCounterDistance(eventRows, "vipers", 9, "said", 20);
  eventRows = setCounterDistance(eventRows, "vipers", 9, "juan", 40);
  assert.match(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined, eventRows, order), /🐫 Camello/);
  keepers.camels.holes_1_9 = "juan";
  assert.match(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined, eventRows, order), /🐟 Pez/);
  keepers.fish.holes_1_9 = "said";
  assert.equal(requiredSideBetCapture(9, enabled, keepers, { enabled: false, participantIds: [] }, undefined, eventRows, order), "");

  assert.match(requiredSideBetCapture(18, enabled, keepers, { enabled: false, participantIds: [] }, undefined, eventRows, order), /🐍 Víbora/);
  eventRows = setCounterDistance(eventRows, "vipers", 18, "pedro", 25);
  eventRows = setCounterDistance(eventRows, "vipers", 18, "daniel", 45);
  keepers.camels.holes_10_18 = "daniel";
  keepers.fish.holes_10_18 = "daniel";
  assert.equal(requiredSideBetCapture(18, enabled, keepers, { enabled: false, participantIds: [] }, undefined, eventRows, order), "");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /const validationErrors = collectHoleValidationErrors/);
  assert.match(page, /setHoleValidationErrors\(validationErrors\)/);
});

const lobaCourse: Course = {
  id: "loba-test", name: "Loba Test", teeName: "", holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

function lobaConfig(patch: Partial<BetConfig["loba"]> = {}): BetConfig["loba"] {
  return { enabled: true, participantIds: ids, value: 100, hcpPct: 100, unitsEnabled: false, unitValue: 100, duplicateUnitsByMode: false, ...patch };
}

function lobaHole(patch: Partial<LobaHole> = {}): LobaHole {
  return { lobaPlayerId: "said", mode: "partner", partnerId: "pedro", fireMultiplier: 1, unitCounts: {}, ...patch };
}

function lobaScores(hole: number, values: Record<string, number>): Record<number, HoleScore> {
  return { [hole]: values };
}

function calculateLobaHole(hole: number, values: Record<string, number>, config: BetConfig["loba"] = lobaConfig(), capture = lobaHole(), matchPlayers = players) {
  return calculateLoba(lobaCourse, lobaScores(hole, values), matchPlayers, config, { [hole]: capture }, [hole], new Set([hole]));
}

test("Loba caso 1: pareja 2 vs 3 gana por mejor neto y liquida jugador contra jugador", () => {
  const result = calculateLobaHole(1, { said: 5, pedro: 5, juan: 6, flavio: 7, daniel: 8 });
  assert.equal(result.details[0].lobaBestNet, 4);
  assert.equal(result.details[0].opponentBestNet, 5);
  assert.equal(result.details[0].winner, "loba_team");
  assert.deepEqual(result.balances, { said: 300, juan: -200, pedro: 300, flavio: -200, daniel: -200 });
  assert.equal(result.transfers.length, 6);
  assert.equal(result.details[0].effectiveValue, 100);
  assert.equal(result.zeroSum, true);
});

test("Loba caso 2: un mejor bruto peor puede ganar por HCP neto", () => {
  const hcpPlayers: Player[] = [
    { id: "said", name: "Said", handicap: 20 }, { id: "daniel", name: "Daniel", handicap: 18 },
    { id: "juan", name: "Juan", handicap: 0 }, { id: "pedro", name: "Pedro", handicap: 2 }, { id: "flavio", name: "Flavio", handicap: 4 },
  ];
  const result = calculateLobaHole(1, { said: 6, daniel: 7, juan: 5, pedro: 6, flavio: 7 }, lobaConfig({ participantIds: hcpPlayers.map(player => player.id) }), lobaHole({ partnerId: "daniel" }), hcpPlayers);
  assert.equal(Math.min(6, 7) > Math.min(5, 6, 7), true);
  assert.equal(result.details[0].lobaBestNet, 4);
  assert.equal(result.details[0].opponentBestNet, 5);
  assert.equal(result.details[0].winner, "loba_team");
});

test("Loba caso 3: empate de mejores netos no paga base", () => {
  const result = calculateLobaHole(1, { said: 4, pedro: 5, juan: 5, flavio: 7, daniel: 8 });
  assert.equal(result.details[0].lobaBestNet, 4);
  assert.equal(result.details[0].opponentBestNet, 4);
  assert.equal(result.details[0].winner, "tie");
  assert.equal(result.transfers.length, 0);
});

test("Loba espera scores completos y no materializa Par visual como resultado", () => {
  const complete = { said: 5, pedro: 5, juan: 6, flavio: 7, daniel: 8 };
  const empty = calculateLoba(lobaCourse, {}, players, lobaConfig(), { 1: lobaHole() }, [1], new Set([1]));
  const partialScores: Record<number, HoleScore> = { 1: { ...complete, daniel: null } };
  const partial = calculateLoba(lobaCourse, partialScores, players, lobaConfig(), { 1: lobaHole() }, [1], new Set([1]));
  const confirmed = calculateLobaHole(1, complete);
  assert.equal(empty.details.length, 0);
  assert.equal(partial.details.length, 0);
  assert.equal(confirmed.details.length, 1);
});

test("Loba casos 4 y 5: sola 2x y sola anticipada 3x funcionan 1 vs 4", () => {
  const solo = calculateLobaHole(2, { said: 4, juan: 6, pedro: 6, flavio: 7, daniel: 8 }, lobaConfig(), lobaHole({ mode: "solo", partnerId: undefined }));
  assert.deepEqual(solo.balances, { said: 800, juan: -200, pedro: -200, flavio: -200, daniel: -200 });
  const anticipated = calculateLobaHole(3, { said: 7, juan: 4, pedro: 6, flavio: 7, daniel: 8 }, lobaConfig(), lobaHole({ mode: "solo_anticipated", partnerId: undefined }));
  assert.deepEqual(anticipated.balances, { said: -1200, juan: 300, pedro: 300, flavio: 300, daniel: 300 });
  assert.ok(isZeroSum(solo.balances) && isZeroSum(anticipated.balances));
});

test("Loba casos 6, 7 y 8: HCP propio 100%, 80% y 0% cambia el neto determinísticamente", () => {
  const capture = lobaHole({ lobaPlayerId: "daniel", partnerId: "flavio" });
  const values = { said: 5, juan: 5, pedro: 5, flavio: 5, daniel: 5 };
  const hundred = calculateLobaHole(11, values, lobaConfig({ hcpPct: 100 }), capture);
  const eighty = calculateLobaHole(11, values, lobaConfig({ hcpPct: 80 }), capture);
  const zero = calculateLobaHole(11, values, lobaConfig({ hcpPct: 0 }), capture);
  assert.equal(hundred.details[0].netScores.daniel, 4);
  assert.equal(hundred.details[0].winner, "loba_team");
  assert.equal(eighty.details[0].netScores.daniel, 5);
  assert.equal(eighty.details[0].winner, "tie");
  assert.ok(Object.values(zero.details[0].netScores).every(score => score === 5));
  assert.equal(zero.details[0].winner, "tie");
});

test("Loba caso 9: reparte el golpe exactamente por Stroke Index", () => {
  const capture = lobaHole({ lobaPlayerId: "daniel", partnerId: "flavio" });
  const same = { said: 5, juan: 5, pedro: 5, flavio: 5, daniel: 5 };
  const atTwelve = calculateLobaHole(12, same, lobaConfig(), capture);
  const atThirteen = calculateLobaHole(13, same, lobaConfig(), capture);
  assert.equal(atTwelve.details[0].netScores.daniel, 4);
  assert.equal(atThirteen.details[0].netScores.daniel, 5);
});

for (const fireMultiplier of [5, 10, 20, 17]) {
  test(`Loba caso 10: 🔥${fireMultiplier}x solo cambia dinero, no ganador deportivo`, () => {
    const result = calculateLobaHole(18, { said: 4, juan: 6, pedro: 6, flavio: 7, daniel: 8 }, lobaConfig({ unitsEnabled: true, unitValue: 100, duplicateUnitsByMode: true }), lobaHole({ mode: "solo", partnerId: undefined, fireMultiplier, unitCounts: { said: 1, juan: 1 } }));
    assert.equal(result.details[0].effectiveValue, 100 * fireMultiplier * 2);
    assert.equal(result.details[0].effectiveUnitValue, 200);
    assert.equal(result.details[0].winner, "loba_team");
    assert.equal(result.zeroSum, true);
  });
}

test("Loba casos 11 y 12: unidades se liquidan independientes del ganador y también en empate", () => {
  const losingBase = calculateLobaHole(7, { said: 8, pedro: 8, juan: 4, flavio: 6, daniel: 7 }, lobaConfig({ unitsEnabled: true, unitValue: 100 }), lobaHole({ unitCounts: { said: 2 } }));
  assert.equal(losingBase.details[0].winner, "opponents");
  assert.ok(losingBase.transfers.some(transfer => transfer.betType === "loba_units" && transfer.toPlayerId === "said"));
  const result = calculateLobaHole(7, { said: 4, pedro: 5, juan: 4, flavio: 7, daniel: 8 }, lobaConfig({ value: 0, unitsEnabled: true, unitValue: 200 }), lobaHole({ mode: "solo", partnerId: undefined, unitCounts: { said: 1, juan: 1, pedro: 2, flavio: 0, daniel: 0 } }));
  assert.equal(result.details[0].winner, "tie");
  assert.equal(result.details[0].lobaUnits, 1);
  assert.equal(result.details[0].opponentUnits, 3);
  assert.deepEqual(result.balances, { said: -1600, juan: 400, pedro: 400, flavio: 400, daniel: 400 });
  assert.equal(result.zeroSum, true);
});

test("Loba caso 13: dos unidades del equipo 2 vs 3 cobran a cada integrante y suman cero", () => {
  const result = calculateLobaHole(1, { said: 4, pedro: 5, juan: 5, flavio: 7, daniel: 8 }, lobaConfig({ value: 0, unitsEnabled: true, unitValue: 100 }), lobaHole({ unitCounts: { said: 2 } }));
  assert.deepEqual(result.balances, { said: 600, juan: -400, pedro: 600, flavio: -400, daniel: -400 });
  assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
});

test("Loba caso 14: base y unidades de ambos equipos conservan suma total cero", () => {
  const result = calculateLobaHole(18, { said: 7, pedro: 7, juan: 4, flavio: 6, daniel: 8 }, lobaConfig({ unitsEnabled: true, unitValue: 100, duplicateUnitsByMode: true }), lobaHole({ mode: "solo_anticipated", partnerId: undefined, fireMultiplier: 20, unitCounts: { said: 2, juan: 1, pedro: 1 } }));
  assert.equal(result.zeroSum, true);
  assert.equal(Object.values(result.balances).reduce((sum, amount) => sum + amount, 0), 0);
  assert.equal(result.details[0].effectiveUnitValue, 300);
});

test("Unidades Loba OFF no liquidan y ON sin duplicar ignora modalidad y fuego", () => {
  const capture = lobaHole({ mode: "solo_anticipated", partnerId: undefined, fireMultiplier: 20, unitCounts: { said: 2, juan: 1, pedro: 1 } });
  const scores = lobaScores(18, { said: 5, juan: 5, pedro: 5, flavio: 5, daniel: 5 });
  const off = calculateLoba(lobaCourse, scores, players, lobaConfig({ value: 0, unitsEnabled: false }), { 18: capture }, [18]);
  assert.deepEqual(off.balances, { said: 0, juan: 0, pedro: 0, flavio: 0, daniel: 0 });
  const on = calculateLoba(lobaCourse, scores, players, lobaConfig({ value: 0, unitsEnabled: true, unitValue: 100, duplicateUnitsByMode: false }), { 18: capture }, [18]);
  assert.equal(on.details[0].effectiveUnitValue, 100);
  assert.equal(on.zeroSum, true);
});

test("Loba ignora winner manual de borradores antiguos y usa scores netos", () => {
  const legacy = calculateLobaHole(1, { said: 5, pedro: 5, juan: 6, flavio: 7, daniel: 8 }, lobaConfig(), lobaHole({ winner: "opponents" }));
  assert.equal(legacy.details[0].winner, "loba_team");
});

test("Loba antigua sin hcpPct migra en cálculo a 100% sin alterar el borrador", () => {
  const legacyConfig = structuredClone(lobaConfig());
  Reflect.deleteProperty(legacyConfig, "hcpPct");
  const result = calculateLobaHole(11, { said: 5, juan: 5, pedro: 5, flavio: 5, daniel: 5 }, legacyConfig, lobaHole({ lobaPlayerId: "daniel", partnerId: "flavio" }));
  assert.equal(result.details[0].hcpPct, 100);
  assert.equal(result.details[0].netScores.daniel, 4);
  assert.equal("hcpPct" in legacyConfig, false);
});

test("captura obligatoria de Loba explica cada dato faltante", () => {
  const keepers = emptyCounterBetKeepers();
  const base = { enabled: true, participantIds: ids };
  assert.match(requiredSideBetCapture(1, [], keepers, { enabled: true, participantIds: ["said"] }, undefined), /al menos dos/);
  assert.match(requiredSideBetCapture(1, [], keepers, base, undefined), /quién es/);
  assert.match(requiredSideBetCapture(1, [], keepers, base, { fireMultiplier: 1, unitCounts: {}, lobaPlayerId: "said" }), /modalidad/);
  assert.match(requiredSideBetCapture(1, [], keepers, base, { fireMultiplier: 1, unitCounts: {}, lobaPlayerId: "said", mode: "partner" }), /pareja/);
  assert.equal(requiredSideBetCapture(1, [], keepers, base, { fireMultiplier: 1, unitCounts: {}, lobaPlayerId: "said", mode: "solo" }), "");
  assert.equal(requiredSideBetCapture(1, [], keepers, base, lobaHole({ winner: undefined })), "");
  const panel = readFileSync("app/components/side-bet-panels.tsx", "utf8");
  assert.doesNotMatch(panel, /Ganó Loba|Ganaron rivales/);
  assert.match(panel, /HCP Loba %/);
  assert.match(panel, /aria-label="HCP Loba %"/);
  assert.match(panel, /Esperando scores/);
  assert.match(panel, /Resultado: Equipo 🐺 gana/);
});

test("ronda integral H1–18 combina motores existentes, 🐍🐫🐟🐺, reload y liquidación cero", () => {
  const ids4 = fullRoundPlayers.map(player => player.id);
  const configured = {
    ...structuredClone(fullRoundBets),
    vipers: { enabled: true, value: 100, secondNineMultiplier: 2, participantIds: ids4 },
    camels: { enabled: true, value: 80, secondNineMultiplier: 3, participantIds: ids4 },
    fish: { enabled: true, value: 50, secondNineMultiplier: 1, participantIds: ids4 },
    loba: { enabled: true, value: 100, hcpPct: 100, unitsEnabled: true, unitValue: 25, duplicateUnitsByMode: true, participantIds: ids4 },
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
    calculateLoba(fullRoundCourse, fullRoundScores, fullRoundPlayers, configured.loba, restored.lobaHoles, fullRoundOrder, complete).balances,
  );
  assert.equal(Object.values(balances).reduce((sum, amount) => sum + amount, 0), 0);
  assert.ok(Object.values(balances).some(amount => amount !== 0));
});
