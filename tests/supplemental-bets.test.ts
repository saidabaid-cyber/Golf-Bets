import assert from "node:assert/strict";
import test from "node:test";

import { calculateManualBets, calculatePersonalBets } from "../lib/engine";
import { normalizeRoundDraft } from "../lib/round-utils";
import {
  calculateSupplementalBets,
  createSupplementalBet,
  normalizeSupplementalBets,
  supplementalBalancesAreZero,
} from "../lib/supplemental-bets";
import type { Course, HoleScore, ManualBet, PersonalBet, Player, PuttsByHole, SupplementalBet } from "../lib/types";

const players: Player[] = [
  { id: "a", name: "Jugador A", handicap: 0 },
  { id: "b", name: "Jugador B", handicap: 0 },
  { id: "c", name: "Jugador C", handicap: 0 },
  { id: "d", name: "Jugador D", handicap: 0 },
];

const course: Course = {
  id: "reference",
  name: "Referencia",
  teeName: "General",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

function scores(holes: number[], values: Record<string, number>): Record<number, HoleScore> {
  return Object.fromEntries(holes.map((hole) => [hole, { ...values }]));
}

function calculate(bets: SupplementalBet[], selectedPlayers: Player[], scoreRows: Record<number, HoleScore>, order: number[], putts: PuttsByHole = {}) {
  return calculateSupplementalBets(bets, selectedPlayers, course, scoreRows, putts, order);
}

function assertZero(result: ReturnType<typeof calculateSupplementalBets>) {
  assert.equal(Object.values(result.balances).reduce((total, amount) => total + amount, 0), 0);
  result.results.forEach((item) => assert.equal(supplementalBalancesAreZero(item), true));
}

test("Nassau individual delegates to the validated Personal Match/Medal engine", () => {
  const bet = createSupplementalBet("individual_nassau", players.slice(0, 2), "nassau");
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const result = calculate([bet], players.slice(0, 2), scores(order, { a: 4, b: 5 }), order);
  assert.equal(result.results[0].complete, true);
  assert.deepEqual(result.balances, { a: 600, b: -600 });
  assertZero(result);
});

test("Dollar a Stroke applies direct advantage and pays the net stroke difference", () => {
  const bet = { ...createSupplementalBet("dollar_stroke", players.slice(0, 2), "stroke"), advantageReceiverId: "b", advantageStrokes: 1 } as SupplementalBet;
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const result = calculate([bet], players.slice(0, 2), scores(order, { a: 4, b: 5 }), order);
  assert.deepEqual(result.balances, { a: 170, b: -170 });
  assert.deepEqual(result.results[0].playerAmounts, [
    { playerId: "a", amountWonLost: 170 },
    { playerId: "b", amountWonLost: -170 },
  ]);
  assert.match(result.results[0].lines.join(" "), /Diferencia 17 golpes/);
  assertZero(result);
});

test("Dollar a Stroke: 70 vs 95, ventaja 5 y $10 produce exactamente $200", () => {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const referenceCourse: Course = {
    ...course,
    holes: order.map((number) => ({ number, par: 4, strokeIndex: number })),
  };
  const grossA = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3];
  const grossB = [6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
  assert.equal(grossA.reduce((sum, value) => sum + value, 0), 70);
  assert.equal(grossB.reduce((sum, value) => sum + value, 0), 95);
  const scores = Object.fromEntries(order.map((hole, index) => [hole, { a: grossA[index], b: grossB[index] }]));
  const bet = {
    ...createSupplementalBet("dollar_stroke", players.slice(0, 2), "stroke-reference"),
    valuePerStroke: 10,
    advantageReceiverId: "b",
    advantageStrokes: 5,
  } as Extract<SupplementalBet, { type: "dollar_stroke" }>;
  const result = calculateSupplementalBets([bet], players.slice(0, 2), referenceCourse, scores, {}, order).results[0];
  assert.match(result.lines.join(" "), /Jugador A 70 · Jugador B 90/);
  assert.deepEqual(result.balances, { a: 200, b: -200 });
});

test("Presiones individuales keep ties open and close on the next winner", () => {
  const bet = createSupplementalBet("individual_pressures", players.slice(0, 2), "press");
  const result = calculate([bet], players.slice(0, 2), {
    1: { a: 4, b: 4 },
    2: { a: 3, b: 4 },
    3: { a: 5, b: 4 },
  }, [1, 2, 3]);
  assert.deepEqual(result.balances, { a: 0, b: 0 });
  assert.deepEqual(result.results[0].pressures?.map((item) => [item.startHole, item.endHole, item.winnerIds[0]]), [[1, 2, "a"], [3, 3, "b"]]);
  assertZero(result);
});

test("Presiones individuales carry an open H9 challenge into H10 only when enabled", () => {
  const base = createSupplementalBet("individual_pressures", players.slice(0, 2), "carry");
  const tiedFirstNine = scores(Array.from({ length: 9 }, (_, index) => index + 1), { a: 4, b: 4 });
  const scoreRows = { ...tiedFirstNine, 10: { a: 3, b: 4 } };
  const withCarry = calculate([{ ...base, carryEnabled: true } as SupplementalBet], players.slice(0, 2), scoreRows, Array.from({ length: 10 }, (_, index) => index + 1));
  const withoutCarry = calculate([{ ...base, carryEnabled: false } as SupplementalBet], players.slice(0, 2), scoreRows, Array.from({ length: 10 }, (_, index) => index + 1));
  assert.equal(withCarry.results[0].pressures?.find((item) => !item.open)?.startHole, 1);
  assert.equal(withoutCarry.results[0].pressures?.find((item) => !item.open)?.startHole, 10);
});

test("Mudo and Yo-Yo create the three documented matchups for three real players", () => {
  for (const virtualMode of ["mudo", "yoyo"] as const) {
    const bet = { ...createSupplementalBet("team_pressures", players.slice(0, 3), virtualMode), virtualMode } as SupplementalBet;
    const result = calculate([bet], players.slice(0, 3), { 1: { a: 3, b: 5, c: 6 } }, [1]);
    assert.equal(new Set(result.results[0].pressures?.map((item) => item.label)).size, 3);
    assert.deepEqual(result.balances, { a: 600, b: 0, c: -600 });
    assertZero(result);
  }
});

test("Chicago uses configurable quota/points and settles every pair", () => {
  const bet = createSupplementalBet("chicago", players.slice(0, 3), "chicago");
  const result = calculate([bet], players.slice(0, 3), { 1: { a: 3, b: 4, c: 5 } }, [1]);
  assert.deepEqual(result.balances, { a: 50, b: -10, c: -40 });
  assert.match(result.results[0].lines[0], /4 puntos/);
  assertZero(result);
});

test("Mínimo de Putts splits the loser-funded pot and all-tie pays nothing", () => {
  const selected = players.slice(0, 3);
  const bet = { ...createSupplementalBet("minimum_putts", selected, "putts"), holes: 9 } as SupplementalBet;
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const putts = Object.fromEntries(order.map((hole) => [hole, { a: 1, b: 2, c: 3 }]));
  const result = calculate([bet], selected, {}, order, putts);
  assert.deepEqual(result.balances, { a: 100, b: -50, c: -50 });
  assertZero(result);
  const tiePutts = Object.fromEntries(order.map((hole) => [hole, { a: 2, b: 2, c: 2 }]));
  assert.deepEqual(calculate([bet], selected, {}, order, tiePutts).balances, { a: 0, b: 0, c: 0 });
  const splitPutts = Object.fromEntries(order.map((hole) => [hole, { a: 1, b: 1, c: 2 }]));
  assert.deepEqual(calculate([bet], selected, {}, order, splitPutts).balances, { a: 25, b: 25, c: -50 });
});

test("Presiones por parejas compare Low and High after handicap", () => {
  const bet = createSupplementalBet("team_pressures", players, "teams");
  const result = calculate([bet], players, { 1: { a: 3, b: 4, c: 5, d: 6 } }, [1]);
  assert.deepEqual(result.balances, { a: 200, b: 200, c: -200, d: -200 });
  assertZero(result);
});

test("Presiones por parejas liquidan Low y High como componentes independientes", () => {
  const base = createSupplementalBet("team_pressures", players, "team-components");
  const low = calculate([{ ...base, metric: "low", value: 20 } as SupplementalBet], players, { 1: { a: 3, b: 5, c: 4, d: 6 } }, [1]);
  const high = calculate([{ ...base, metric: "high", value: 20 } as SupplementalBet], players, { 1: { a: 4, b: 5, c: 4, d: 6 } }, [1]);
  assert.deepEqual(low.balances, { a: 20, b: 20, c: -20, d: -20 });
  assert.deepEqual(high.balances, { a: 20, b: 20, c: -20, d: -20 });
  assert.equal(low.results[0].pressures?.[0].component, "Low Ball");
  assert.equal(high.results[0].pressures?.[0].component, "High Ball");
  assertZero(low);
  assertZero(high);
});

test("Low + High conserva resultados cruzados aunque su dinero se compense", () => {
  const bet = { ...createSupplementalBet("team_pressures", players, "team-crossed"), value: 20 } as SupplementalBet;
  const result = calculate([bet], players, { 1: { a: 3, b: 7, c: 4, d: 6 } }, [1]);
  assert.deepEqual(result.balances, { a: 0, b: 0, c: 0, d: 0 });
  assert.deepEqual(result.results[0].pressures?.map((pressure) => [pressure.component, pressure.winnerIds]), [
    ["Low Ball", ["a", "b"]],
    ["High Ball", ["c", "d"]],
  ]);
  assertZero(result);
});

test("un empate Low permanece abierto mientras High se cierra", () => {
  const bet = { ...createSupplementalBet("team_pressures", players, "team-open"), value: 20 } as SupplementalBet;
  const result = calculate([bet], players, { 1: { a: 4, b: 5, c: 4, d: 6 } }, [1]);
  const low = result.results[0].pressures?.find((pressure) => pressure.component === "Low Ball");
  const high = result.results[0].pressures?.find((pressure) => pressure.component === "High Ball");
  assert.equal(low?.open, true);
  assert.equal(high?.open, false);
  assert.deepEqual(result.balances, { a: 20, b: 20, c: -20, d: -20 });
});

test("Presiones por parejas aplican HCP antes de Low y High", () => {
  const handicapPlayers = players.map((player) => ({ ...player, handicap: player.id === "c" || player.id === "d" ? 18 : 0 }));
  const bet = { ...createSupplementalBet("team_pressures", handicapPlayers, "team-hcp"), value: 20, hcpPct: 100 } as SupplementalBet;
  const result = calculate([bet], handicapPlayers, { 1: { a: 4, b: 5, c: 5, d: 6 } }, [1]);
  assert.deepEqual(result.balances, { a: 0, b: 0, c: 0, d: 0 });
  assert.equal(result.results[0].pressures?.filter((pressure) => pressure.open).length, 2);
});

test("cada componente de Presiones por parejas conserva carry entre H9 y H10", () => {
  const base = { ...createSupplementalBet("team_pressures", players, "team-carry"), metric: "low", value: 20 } as SupplementalBet;
  const rows = { ...scores(Array.from({ length: 9 }, (_, index) => index + 1), { a: 4, b: 5, c: 4, d: 6 }), 10: { a: 3, b: 5, c: 4, d: 6 } };
  const order = Array.from({ length: 10 }, (_, index) => index + 1);
  const withCarry = calculate([{ ...base, carryEnabled: true } as SupplementalBet], players, rows, order);
  const withoutCarry = calculate([{ ...base, carryEnabled: false } as SupplementalBet], players, rows, order);
  assert.equal(withCarry.results[0].pressures?.find((pressure) => !pressure.open)?.startHole, 1);
  assert.equal(withoutCarry.results[0].pressures?.find((pressure) => !pressure.open)?.startHole, 10);
});

test("Presiones por parejas use the configured maximum for a player who abandoned", () => {
  const bet = { ...createSupplementalBet("team_pressures", players, "abandoned"), metric: "high", abandonedPlayerIds: ["b"], abandonedMaxScore: 8 } as SupplementalBet;
  const result = calculate([bet], players, { 1: { a: 3, c: 5, d: 6 } }, [1]);
  assert.equal(result.results[0].complete, true);
  assert.deepEqual(result.balances, { a: -100, b: -100, c: 100, d: 100 });
  assertZero(result);
});

test("Vegas concatenates the lower net score first and settles 11 units", () => {
  const bet = createSupplementalBet("vegas", players, "vegas");
  const result = calculate([bet], players, { 1: { a: 4, b: 5, c: 5, d: 6 } }, [1]);
  assert.match(result.results[0].lines[0], /45 vs 56 · 11 unidades/);
  assert.deepEqual(result.balances, { a: 220, b: 220, c: -220, d: -220 });
  assertZero(result);
});

test("Vegas birdie-vs-bogey penalty reverses only the penalized team", () => {
  const bet = { ...createSupplementalBet("vegas", players, "vegas-penalty"), birdiePenalty: true } as SupplementalBet;
  const result = calculate([bet], players, { 1: { a: 3, b: 4, c: 5, d: 6 } }, [1]);
  assert.match(result.results[0].lines[0], /34 vs 65 · 31 unidades/);
  assert.deepEqual(result.balances, { a: 620, b: 620, c: -620, d: -620 });
  assertZero(result);
});

test("OFF preserves Personal, Manual and supplemental data but excludes every result", () => {
  const personal: PersonalBet = {
    id: "personal", enabled: false, rivalMode: "group", rivalPlayerId: "b", rivalName: "Jugador B", externalScores: {}, baseValue: 100,
    advantageReceiver: "rival", advantageStrokes: 0, back9Multiplier: 1, carryEnabled: false,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  };
  const manual: ManualBet = { id: "manual", enabled: false, name: "Guardada", amounts: { a: 300, b: -300 } };
  const supplemental = { ...createSupplementalBet("dollar_stroke", players.slice(0, 2), "stored"), enabled: false } as SupplementalBet;
  const order = [1];
  const scoreRows = { 1: { a: 3, b: 5 } };
  assert.deepEqual(calculatePersonalBets([personal], "a", players.slice(0, 2), course, scoreRows, order).balances, { a: 0, b: 0 });
  assert.deepEqual(calculateManualBets(players.slice(0, 2), [manual]).balances, { a: 0, b: 0 });
  assert.equal(calculate([supplemental], players.slice(0, 2), scoreRows, order).results.length, 0);
  assert.equal(normalizeSupplementalBets([supplemental])[0].enabled, false);
  const restored = { ...normalizeSupplementalBets([supplemental])[0], enabled: true } as SupplementalBet;
  assert.equal(calculate([restored], players.slice(0, 2), scoreRows, order).results.length, 1);
  assert.equal((restored as Extract<SupplementalBet, { type: "dollar_stroke" }>).valuePerStroke, 10);
  assert.equal((normalizeRoundDraft({ players: players.slice(0, 2), supplementalBets: [supplemental], manualBets: [manual], putts: { 1: { a: 2 } } })?.putts as PuttsByHole)[1].a, 2);
});

test("las modalidades conservan configuración y Nassau suplementario migra a la Personal canónica", () => {
  const types: SupplementalBet["type"][] = ["individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts"];
  const configured = types.map((type, index) => ({ ...createSupplementalBet(type, players, `persist-${index}`), enabled: index % 2 === 0 })) as SupplementalBet[];
  const serialized = JSON.parse(JSON.stringify(configured));
  const normalized = normalizeSupplementalBets(serialized);
  assert.deepEqual(normalized, configured);

  const draft = normalizeRoundDraft({
    version: 5,
    ownerId: "a",
    players,
    supplementalBets: configured,
    putts: { 1: { a: 2, b: 1, c: 3, d: 2 } },
  });
  assert.deepEqual(draft?.supplementalBets, configured.filter((bet) => bet.type !== "individual_nassau"));
  assert.equal(draft?.personalBets.length, 1);
  assert.deepEqual(draft?.personalBets[0], {
    id: "persist-0", enabled: true, rivalMode: "group", rivalPlayerId: "b", rivalName: "Jugador B", rivalHandicap: 0,
    externalScores: {}, baseValue: 100, advantageReceiver: "none", advantageStrokes: 0, back9Multiplier: 1,
    pressureMultiplier: 1, pressureNine: "holes_10_18", nassauVersion: 2, carryEnabled: false,
    components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  });
  assert.deepEqual(draft?.putts, { 1: { a: 2, b: 1, c: 3, d: 2 } });
  assert.deepEqual(normalizeRoundDraft({ version: 1, players })?.supplementalBets, []);
});

test("migrar Nassau representable conserva ID, pareja, ventaja y fórmula incluso saliendo por H10", () => {
  const playOrders = [
    Array.from({ length: 18 }, (_, index) => index + 1),
    [...Array.from({ length: 9 }, (_, index) => index + 10), ...Array.from({ length: 9 }, (_, index) => index + 1)],
  ];
  for (const order of playOrders) {
    const startHole = order[0];
    const scoreRows = Object.fromEntries(order.map((hole, index) => [hole, { a: index % 3 === 0 ? 4 : 5, b: index % 4 === 0 ? 6 : 4 }]));
    const legacy = {
      ...createSupplementalBet("individual_nassau", players.slice(0, 2), `legacy-${startHole}`),
      playerAId: "b",
      playerBId: "a",
      value: 50,
      advantageReceiverId: "a",
      advantageStrokes: 5,
      carryEnabled: true,
    } as Extract<SupplementalBet, { type: "individual_nassau" }>;
    const before = calculateSupplementalBets([legacy], players.slice(0, 2), course, scoreRows, {}, order).results[0];
    const migrated = normalizeRoundDraft({ version: 5, ownerId: "a", startHole, players: players.slice(0, 2), supplementalBets: [legacy] });
    assert.equal(migrated?.supplementalBets.length, 0);
    assert.equal(migrated?.personalBets[0]?.id, legacy.id);
    assert.equal(migrated?.personalBets[0]?.rivalPlayerId, "b");
    assert.equal(migrated?.personalBets[0]?.advantageReceiver, "owner");
    assert.equal(migrated?.personalBets[0]?.advantageStrokes, 5);
    assert.equal(migrated?.personalBets[0]?.pressureNine, startHole === 10 ? "holes_1_9" : "holes_10_18");
    const after = calculatePersonalBets(migrated?.personalBets || [], "a", players.slice(0, 2), course, scoreRows, order);
    assert.deepEqual(after.balances, before.balances);
  }
});
