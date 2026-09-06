import assert from "node:assert/strict";
import test from "node:test";

import { calculateManualBets, calculatePersonalBets } from "../lib/engine";
import { normalizeRoundDraft } from "../lib/round-utils";
import {
  calculateSupplementalBets,
  createSupplementalBet,
  normalizeSupplementalBets,
  supplementalBetsForRoundHoles,
  supplementalBalancesAreZero,
} from "../lib/supplemental-bets";
import type { Course, HandicapMode, HoleScore, ManualBet, PersonalBet, Player, PuttsByHole, SupplementalBet } from "../lib/types";

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
  assert.equal(withCarry.results[0].pressures?.find((item) => item.winnerIds.length)?.startHole, 1);
  assert.equal(withoutCarry.results[0].pressures?.find((item) => item.winnerIds.length)?.startHole, 10);
  assert.equal(withoutCarry.results[0].pressures?.find((item) => item.tied)?.endHole, 9);
});

test("Presiones individuales liquidan un empate terminal sin cobro y conservan lo ya ganado", () => {
  const bet = createSupplementalBet("individual_pressures", players.slice(0, 2), "press-final-tie");
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 4, b: 4 });
  scoreRows[1] = { a: 3, b: 4 };
  const result = calculate([bet], players.slice(0, 2), scoreRows, order).results[0];
  const tiedPressure = result.pressures?.find((pressure) => pressure.tied);
  assert.deepEqual(result.balances, { a: 100, b: -100 });
  assert.deepEqual(result.pressures?.filter((pressure) => pressure.winnerIds.length).map((pressure) => [pressure.startHole, pressure.endHole]), [[1, 1]]);
  assert.equal(tiedPressure?.startHole, 2);
  assert.equal(tiedPressure?.endHole, 9);
  assert.equal(tiedPressure?.open, false);
  assert.equal(result.complete, true);
  assert.equal(result.audit?.components.at(-1)?.status, "final");
  assert.match(result.lines.at(-1) || "", /empate final · sin cobro/);
});

test("Presiones individuales cierran sin cobro el empate de 18 hoyos y respetan orden y carry", () => {
  const bet = createSupplementalBet("individual_pressures", players.slice(0, 2), "press-full-tie");
  for (const order of [
    Array.from({ length: 18 }, (_, index) => index + 1),
    [...Array.from({ length: 9 }, (_, index) => index + 10), ...Array.from({ length: 9 }, (_, index) => index + 1)],
  ]) {
    for (const carryEnabled of [true, false]) {
      const result = calculate([{ ...bet, carryEnabled } as SupplementalBet], players.slice(0, 2), scores(order, { a: 4, b: 4 }), order).results[0];
      const expectedStart = carryEnabled ? order[0] : order[9];
      assert.equal(result.pressures?.some((pressure) => pressure.open), false);
      assert.equal(result.pressures?.at(-1)?.startHole, expectedStart);
      assert.equal(result.pressures?.at(-1)?.endHole, order.at(-1));
      assert.equal(result.pressures?.every((pressure) => pressure.tied), true);
      assert.equal(result.pressures?.length, carryEnabled ? 1 : 2);
      assert.equal(result.complete, true);
    }
  }
});

test("Presiones individuales sí cierran cuando el último hoyo rompe el empate", () => {
  const bet = createSupplementalBet("individual_pressures", players.slice(0, 2), "press-last-hole");
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 4, b: 4 });
  scoreRows[9] = { a: 3, b: 4 };
  const result = calculate([bet], players.slice(0, 2), scoreRows, order).results[0];
  assert.equal(result.pressures?.some((pressure) => pressure.open), false);
  assert.equal(result.pressures?.[0]?.endHole, 9);
  assert.equal(result.complete, true);
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

test("Chicago aplica el HCP % a la cuota y una ronda antigua sin porcentaje conserva 100%", () => {
  const selected: Player[] = [
    { id: "a", name: "Jugador A", handicap: 10 },
    { id: "b", name: "Jugador B", handicap: 0 },
  ];
  const base = createSupplementalBet("chicago", selected, "chicago-hcp");
  const scoreRows = { 1: { a: 4, b: 4 } };
  const hundred = calculate([{ ...base, hcpPct: 100 } as SupplementalBet], selected, scoreRows, [1]);
  const eighty = calculate([{ ...base, hcpPct: 80 } as SupplementalBet], selected, scoreRows, [1]);
  const legacy = structuredClone(base) as SupplementalBet;
  Reflect.deleteProperty(legacy, "hcpPct");
  const historical = calculate([legacy], selected, scoreRows, [1]);
  assert.deepEqual(hundred.balances, { a: 100, b: -100 });
  assert.deepEqual(eighty.balances, { a: 80, b: -80 });
  assert.deepEqual(historical.balances, hundred.balances);
  assertZero(hundred);
  assertZero(eighty);

  for (const hcpPct of [Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
    const invalid = calculate([{ ...base, hcpPct } as SupplementalBet], selected, scoreRows, [1]);
    assert.equal(invalid.results[0].complete, false, String(hcpPct));
    assert.deepEqual(invalid.balances, { a: 0, b: 0 }, String(hcpPct));
  }
});

test("Mínimo de Putts usa la duración explícita de una ronda de 9 hoyos", () => {
  const selected = players.slice(0, 3);
  const bet = createSupplementalBet("minimum_putts", selected, "putts-9", 9);
  assert.equal(bet.type === "minimum_putts" && bet.holes, 9);
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const putts = Object.fromEntries(order.map((hole) => [hole, { a: 1, b: 2, c: 3 }]));
  const result = calculate([bet], selected, {}, order, putts);
  assert.equal(result.results[0].complete, true);
  assert.deepEqual(result.balances, { a: 100, b: -50, c: -50 });
  assertZero(result);

  const incomplete = calculate([bet], selected, {}, order, Object.fromEntries(Object.entries(putts).slice(0, 8)));
  assert.equal(incomplete.results[0].complete, false);
  assert.deepEqual(incomplete.balances, { a: 0, b: 0, c: 0 });

  const tiePutts = Object.fromEntries(order.map((hole) => [hole, { a: 2, b: 2, c: 2 }]));
  assert.deepEqual(calculate([bet], selected, {}, order, tiePutts).balances, { a: 0, b: 0, c: 0 });
  const splitPutts = Object.fromEntries(order.map((hole) => [hole, { a: 1, b: 1, c: 2 }]));
  assert.deepEqual(calculate([bet], selected, {}, order, splitPutts).balances, { a: 25, b: 25, c: -50 });

  const backNine = Array.from({ length: 9 }, (_, index) => index + 10);
  const backNinePutts = Object.fromEntries(backNine.map((hole) => [hole, { a: 1, b: 2, c: 3 }]));
  assert.deepEqual(calculate([bet], selected, {}, backNine, backNinePutts).balances, { a: 100, b: -50, c: -50 });
});

test("Mínimo de Putts conserva exactamente configuración, snapshot y liquidación de 18 hoyos", () => {
  const selected = players.slice(0, 3);
  const bet = createSupplementalBet("minimum_putts", selected, "putts-18");
  assert.equal(bet.type === "minimum_putts" && bet.holes, 18);
  const serialized = JSON.parse(JSON.stringify([bet]));
  assert.deepEqual(normalizeSupplementalBets(serialized, 18), [bet]);
  assert.strictEqual(supplementalBetsForRoundHoles([bet], 18)[0], bet);

  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const putts = Object.fromEntries(order.map((hole) => [hole, { a: 1, b: 2, c: 3 }]));
  const result = calculate([bet], selected, {}, order, putts);
  assert.equal(result.results[0].complete, true);
  assert.deepEqual(result.balances, { a: 100, b: -50, c: -50 });
  assertZero(result);

  const tied = Object.fromEntries(order.map((hole) => [hole, { a: 2, b: 2, c: 2 }]));
  assert.deepEqual(calculate([bet], selected, {}, order, tied).balances, { a: 0, b: 0, c: 0 });
});

test("una configuración imposible de 18 putts se repara solo al abrir o convertir una ronda de 9", () => {
  const bet = createSupplementalBet("minimum_putts", players.slice(0, 3), "putts-repair");
  const chicago = createSupplementalBet("chicago", players.slice(0, 3), "chicago-unchanged");
  const fittedBets = supplementalBetsForRoundHoles([chicago, bet], 9);
  assert.strictEqual(fittedBets[0], chicago);
  const fitted = fittedBets[1];
  assert.equal(fitted.type === "minimum_putts" && fitted.holes, 9);
  assert.equal((normalizeSupplementalBets([bet], 9)[0] as Extract<SupplementalBet, { type: "minimum_putts" }>).holes, 9);
  assert.deepEqual(normalizeSupplementalBets([bet], 18), [bet]);
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
  assert.equal(result.results[0].complete, false);
  assert.deepEqual(result.balances, { a: 20, b: 20, c: -20, d: -20 });
});

test("Presiones por parejas liquidan un componente terminal empatado sin cobro", () => {
  const bet = { ...createSupplementalBet("team_pressures", players, "team-final-tie"), metric: "low" } as SupplementalBet;
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const result = calculate([bet], players, scores(order, { a: 4, b: 5, c: 4, d: 6 }), order).results[0];
  assert.equal(result.pressures?.length, 1);
  assert.equal(result.pressures?.[0]?.component, "Low Ball");
  assert.equal(result.pressures?.[0]?.startHole, 1);
  assert.equal(result.pressures?.[0]?.endHole, 9);
  assert.equal(result.pressures?.[0]?.open, false);
  assert.equal(result.pressures?.[0]?.tied, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.balances, { a: 0, b: 0, c: 0, d: 0 });
  assert.match(result.lines[0], /empate final · sin cobro/);
});

test("Presiones por parejas cierran empates de 18 hoyos por vuelta y desde H10", () => {
  const bet = { ...createSupplementalBet("team_pressures", players, "team-full-tie"), metric: "low" } as SupplementalBet;
  for (const order of [
    Array.from({ length: 18 }, (_, index) => index + 1),
    [...Array.from({ length: 9 }, (_, index) => index + 10), ...Array.from({ length: 9 }, (_, index) => index + 1)],
  ]) {
    for (const carryEnabled of [true, false]) {
      const result = calculate([{ ...bet, carryEnabled } as SupplementalBet], players, scores(order, { a: 4, b: 5, c: 4, d: 6 }), order).results[0];
      assert.equal(result.complete, true);
      assert.equal(result.pressures?.some((pressure) => pressure.open), false);
      assert.equal(result.pressures?.every((pressure) => pressure.tied), true);
      assert.equal(result.pressures?.length, carryEnabled ? 1 : 2);
      assert.equal(result.pressures?.at(-1)?.startHole, carryEnabled ? order[0] : order[9]);
      assert.equal(result.pressures?.at(-1)?.endHole, order.at(-1));
    }
  }
});

test("Presiones por parejas sí cierran cuando el último hoyo es decisivo", () => {
  const bet = { ...createSupplementalBet("team_pressures", players, "team-last-hole"), metric: "low" } as SupplementalBet;
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 4, b: 5, c: 4, d: 6 });
  scoreRows[9] = { a: 3, b: 5, c: 4, d: 6 };
  const result = calculate([bet], players, scoreRows, order).results[0];
  assert.equal(result.pressures?.some((pressure) => pressure.open), false);
  assert.equal(result.pressures?.[0]?.endHole, 9);
  assert.equal(result.complete, true);
});

test("Presiones fallan cerradas si el campo omite o duplica un hoyo jugado", () => {
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 4, b: 4, c: 4, d: 5 });
  const missingHoleCourse = { ...course, holes: course.holes.filter((hole) => hole.number !== 9) };
  const duplicateHoleCourse = { ...course, holes: course.holes.map((hole) => hole.number === 9 ? { ...hole, number: 8 } : hole) };
  const individual = createSupplementalBet("individual_pressures", players.slice(0, 2), "press-missing-hole");
  const team = { ...createSupplementalBet("team_pressures", players, "team-duplicate-hole"), metric: "low" } as SupplementalBet;
  const individualResult = calculateSupplementalBets([individual], players.slice(0, 2), missingHoleCourse, scoreRows, {}, order).results[0];
  const teamResult = calculateSupplementalBets([team], players, duplicateHoleCourse, scoreRows, {}, order).results[0];
  for (const result of [individualResult, teamResult]) {
    assert.equal(result.complete, false);
    assert.equal(result.pressures?.some((pressure) => pressure.open), true);
    assertZero({ balances: result.balances, results: [result] });
  }
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
  assert.equal(withCarry.results[0].pressures?.find((pressure) => pressure.winnerIds.length)?.startHole, 1);
  assert.equal(withoutCarry.results[0].pressures?.find((pressure) => pressure.winnerIds.length)?.startHole, 10);
  assert.equal(withoutCarry.results[0].pressures?.find((pressure) => pressure.tied)?.endHole, 9);
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

test("normalización hace explícito el redondeo legacy y preserva valores corruptos para fallar cerrado", () => {
  for (const type of ["individual_pressures", "team_pressures", "vegas"] as const) {
    const bet = createSupplementalBet(type, players, `legacy-decimals-${type}`);
    delete (bet as SupplementalBet & { decimals?: string }).decimals;
    const restored = normalizeSupplementalBets([JSON.parse(JSON.stringify(bet))])[0] as SupplementalBet & { decimals?: string };
    assert.equal(restored.decimals, "decimal");
    const corrupt = normalizeSupplementalBets([{ ...bet, decimals: "corrupt" } as unknown as SupplementalBet])[0] as SupplementalBet & { decimals?: string };
    assert.equal(corrupt.decimals, "corrupt");
  }
});

test("flags y redondeos suplementarios corruptos fallan cerrados sin salida monetaria", () => {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 3, b: 4, c: 5, d: 6 });
  const zero = { a: 0, b: 0, c: 0, d: 0 };
  const assertFailsClosed = (bet: SupplementalBet) => {
    const result = calculate([bet], players, scoreRows, order);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].complete, false);
    assert.deepEqual(result.results[0].balances, zero);
    assert.deepEqual(result.balances, zero);
    assert.ok(Object.values(result.results[0].balances).every(Number.isFinite));
    assert.ok(Object.values(result.balances).every(Number.isFinite));
  };

  for (const invalidEnabled of ["true", 1, null, {}]) {
    const bet = { ...createSupplementalBet("dollar_stroke", players, `invalid-enabled-${String(invalidEnabled)}`), enabled: invalidEnabled } as unknown as SupplementalBet;
    assertFailsClosed(bet);
    const restored = normalizeSupplementalBets([bet])[0];
    assert.equal((restored as unknown as { enabled: unknown }).enabled, invalidEnabled);
    assertFailsClosed(restored);
  }

  const disabled = { ...createSupplementalBet("dollar_stroke", players, "explicitly-disabled"), enabled: false } as SupplementalBet;
  assert.equal(calculate([disabled], players, scoreRows, order).results.length, 0);
  const legacyEnabled = createSupplementalBet("dollar_stroke", players, "legacy-enabled") as Extract<SupplementalBet, { type: "dollar_stroke" }>;
  delete (legacyEnabled as Partial<typeof legacyEnabled>).enabled;
  assert.equal(calculate([legacyEnabled], players, scoreRows, order).results[0].complete, true);
  assert.equal(normalizeSupplementalBets([legacyEnabled])[0].enabled, true);

  const nassau = createSupplementalBet("individual_nassau", players, "invalid-nassau-carry") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  nassau.carryEnabled = "yes" as unknown as boolean;
  assertFailsClosed(nassau);

  const individualCarry = createSupplementalBet("individual_pressures", players, "invalid-individual-carry") as Extract<SupplementalBet, { type: "individual_pressures" }>;
  individualCarry.carryEnabled = "yes" as unknown as boolean;
  assertFailsClosed(individualCarry);
  const individualMatch = createSupplementalBet("individual_pressures", players, "invalid-individual-match") as Extract<SupplementalBet, { type: "individual_pressures" }>;
  individualMatch.matchPlayEnabled = 1 as unknown as boolean;
  assertFailsClosed(individualMatch);

  const team = createSupplementalBet("team_pressures", players, "invalid-team-carry") as Extract<SupplementalBet, { type: "team_pressures" }>;
  team.carryEnabled = null as unknown as boolean;
  assertFailsClosed(team);

  const vegas = createSupplementalBet("vegas", players, "invalid-vegas-penalty") as Extract<SupplementalBet, { type: "vegas" }>;
  vegas.birdiePenalty = "false" as unknown as boolean;
  assertFailsClosed(vegas);

  for (const type of ["individual_pressures", "team_pressures", "vegas"] as const) {
    const bet = createSupplementalBet(type, players, `invalid-decimals-${type}`) as SupplementalBet & { decimals: HandicapMode };
    bet.decimals = "corrupt" as HandicapMode;
    assertFailsClosed(bet);
    const restored = normalizeSupplementalBets([bet])[0] as SupplementalBet & { decimals: unknown };
    assert.equal(restored.decimals, "corrupt");
    assertFailsClosed(restored);
  }
});

test("Nassau exige booleanos literales únicamente en componentes aplicables", () => {
  const fullOrder = Array.from({ length: 18 }, (_, index) => index + 1);
  const fullScores = scores(fullOrder, { a: 3, b: 4 });
  const zero = { a: 0, b: 0 };
  const assertFailsClosed = (bet: SupplementalBet, order: number[]) => {
    const result = calculate([bet], players.slice(0, 2), fullScores, order);
    assert.equal(result.results[0].complete, false);
    assert.deepEqual(result.results[0].balances, zero);
    assert.deepEqual(result.balances, zero);
    assert.ok(Object.values(result.results[0].balances).every(Number.isFinite));
    assert.ok(Object.values(result.balances).every(Number.isFinite));
  };

  for (const key of ["match1", "medal1", "match2", "medal2", "match18", "medal18"] as const) {
    const bet = createSupplementalBet("individual_nassau", players, `invalid-component-18-${key}`) as Extract<SupplementalBet, { type: "individual_nassau" }>;
    (bet.components as unknown as Record<string, unknown>)[key] = "true";
    assertFailsClosed(bet, fullOrder);
  }

  const firstNine = fullOrder.slice(0, 9);
  for (const key of ["match1", "medal1"] as const) {
    const bet = createSupplementalBet("individual_nassau", players, `invalid-component-9-${key}`) as Extract<SupplementalBet, { type: "individual_nassau" }>;
    (bet.components as unknown as Record<string, unknown>)[key] = 1;
    assertFailsClosed(bet, firstNine);
  }

  const ignoredComponents = createSupplementalBet("individual_nassau", players, "ignored-components-9") as Extract<SupplementalBet, { type: "individual_nassau" }>;
  for (const key of ["match2", "medal2", "match18", "medal18"] as const) {
    (ignoredComponents.components as unknown as Record<string, unknown>)[key] = "legacy";
  }
  const validNine = calculate([ignoredComponents], players.slice(0, 2), fullScores, firstNine);
  assert.equal(validNine.results[0].complete, true);
  assert.deepEqual(validNine.balances, { a: 200, b: -200 });
  assertZero(validNine);
});

test("enums suplementarios corruptos fallan cerrados solo cuando son aplicables", () => {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 3, b: 4, c: 5, d: 6 });
  const zero = { a: 0, b: 0, c: 0, d: 0 };
  const assertFailsClosed = (bet: SupplementalBet) => {
    const result = calculate([bet], players, scoreRows, order);
    assert.equal(result.results[0].complete, false);
    assert.deepEqual(result.results[0].balances, zero);
    assert.deepEqual(result.balances, zero);
    assert.ok(Object.values(result.results[0].balances).every(Number.isFinite));
    assert.ok(Object.values(result.balances).every(Number.isFinite));
  };

  const invalidMetric = createSupplementalBet("team_pressures", players, "invalid-team-metric") as Extract<SupplementalBet, { type: "team_pressures" }>;
  invalidMetric.metric = "average" as typeof invalidMetric.metric;
  assertFailsClosed(invalidMetric);

  const invalidVirtualMode = createSupplementalBet("team_pressures", players, "invalid-team-virtual") as Extract<SupplementalBet, { type: "team_pressures" }>;
  invalidVirtualMode.virtualMode = "ghost" as typeof invalidVirtualMode.virtualMode;
  assertFailsClosed(invalidVirtualMode);

  const invalidRotation = createSupplementalBet("vegas", players, "invalid-vegas-rotation") as Extract<SupplementalBet, { type: "vegas" }>;
  invalidRotation.rotation = "random" as typeof invalidRotation.rotation;
  assertFailsClosed(invalidRotation);

  const invalidBlockSize = createSupplementalBet("vegas", players, "invalid-vegas-block") as Extract<SupplementalBet, { type: "vegas" }>;
  invalidBlockSize.rotation = "blocks";
  invalidBlockSize.blockSize = 4 as typeof invalidBlockSize.blockSize;
  assertFailsClosed(invalidBlockSize);

  for (const rotation of ["fixed", "each_hole"] as const) {
    const legacy = createSupplementalBet("vegas", players, `legacy-vegas-${rotation}`) as Extract<SupplementalBet, { type: "vegas" }>;
    legacy.rotation = rotation;
    delete (legacy as Partial<typeof legacy>).blockSize;
    const result = calculate([legacy], players, scoreRows, order);
    assert.equal(result.results[0].complete, true, rotation);
    assert.ok(Object.values(result.balances).every(Number.isFinite));
    assertZero(result);
  }
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

test("una colisión de ID entre Personal y Nassau supplemental conserva ambas apuestas", () => {
  const personal: PersonalBet = {
    id: "shared-id",
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: "c",
    rivalName: "Jugador C",
    rivalHandicap: 0,
    externalScores: {},
    baseValue: 275,
    advantageReceiver: "rival",
    advantageStrokes: 3,
    back9Multiplier: 1,
    pressureMultiplier: 1,
    pressureNine: "holes_10_18",
    nassauVersion: 2,
    carryEnabled: true,
    components: { match1: true, medal1: false, match2: true, medal2: false, match18: true, medal18: false },
  };
  const supplemental = {
    ...createSupplementalBet("individual_nassau", players.slice(0, 2), "shared-id"),
    value: 50,
  } as Extract<SupplementalBet, { type: "individual_nassau" }>;
  const migratable = createSupplementalBet("individual_nassau", [players[0], players[3]], "migratable-id");
  const serialized = JSON.parse(JSON.stringify({
    version: 5,
    ownerId: "a",
    players,
    personalBets: [personal],
    supplementalBets: [supplemental, migratable],
  }));

  const normalized = normalizeRoundDraft(serialized);

  assert.deepEqual(normalized?.personalBets[0], personal);
  assert.deepEqual(normalized?.personalBets.map((bet: PersonalBet) => bet.id), ["shared-id", "migratable-id"]);
  assert.deepEqual(normalized?.supplementalBets, [supplemental]);
  const normalizedAgain = normalizeRoundDraft(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(normalizedAgain?.personalBets, normalized?.personalBets);
  assert.deepEqual(normalizedAgain?.supplementalBets, [supplemental]);
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

test("migrar Nassau conserva flags e identidad corruptos para fallar cerrado", () => {
  const legacy = {
    ...createSupplementalBet("individual_nassau", players.slice(0, 2), "corrupt-legacy"),
    enabled: "false",
    advantageReceiverId: "missing-player",
  } as unknown as Extract<SupplementalBet, { type: "individual_nassau" }>;
  const normalized = normalizeRoundDraft({
    ownerId: "a",
    players: players.slice(0, 2),
    supplementalBets: [legacy],
  });
  const migrated = normalized?.personalBets[0] as unknown as Record<string, unknown>;

  assert.equal(migrated.enabled, "false");
  assert.equal(migrated.advantageReceiver, "missing-player");
  const result = calculatePersonalBets(normalized?.personalBets || [], "a", players.slice(0, 2), course, {}, [1]);
  assert.deepEqual(result.balances, { a: 0, b: 0 });
});

test("Manual falla cerrado ante IDs activos duplicados o vacíos y nombres corruptos", () => {
  const base: ManualBet = {
    id: "manual-valid",
    enabled: true,
    name: "Ajuste válido",
    amounts: { a: 100, b: -100 },
  };
  const cases: Array<{ label: string; bets: ManualBet[] }> = [
    {
      label: "IDs duplicados",
      bets: [base, { ...base, name: "Otro ajuste" }],
    },
    {
      label: "ID vacío",
      bets: [{ ...base, id: "" }],
    },
    {
      label: "nombre no textual",
      bets: [{ ...base, name: 7 } as unknown as ManualBet],
    },
  ];

  for (const { label, bets } of cases) {
    const result = calculateManualBets(players.slice(0, 2), bets);
    assert.deepEqual(result.balances, { a: 0, b: 0 }, label);
    assert.equal(result.details.length, bets.length, label);
    assert.equal(result.details.every((detail) => detail.valid === false), true, label);
    assert.equal(Object.values(result.balances).every(Number.isFinite), true, label);
  }
});

test("el agregado supplemental invalida toda identidad activa duplicada o vacía", () => {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 3, b: 5 });
  const base = createSupplementalBet("dollar_stroke", players.slice(0, 2), "supplemental-valid");
  const cases: Array<{ label: string; bets: SupplementalBet[] }> = [
    {
      label: "IDs duplicados",
      bets: [base, { ...base }],
    },
    {
      label: "ID vacío",
      bets: [{ ...base, id: "" }],
    },
  ];

  for (const { label, bets } of cases) {
    const result = calculate(bets, players.slice(0, 2), scoreRows, order);
    assert.deepEqual(result.balances, { a: 0, b: 0 }, label);
    assert.equal(result.results.length, bets.length, label);
    assert.equal(result.results.every((item) => item.complete === false), true, label);
    assert.equal(result.results.every((item) => Object.values(item.balances).every((amount) => amount === 0 && Number.isFinite(amount))), true, label);
  }
});

test("participantIds duplicados o fuera del roster fallan cerrados en apuestas suplementarias grupales", () => {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  const scoreRows = scores(order, { a: 3, b: 4, c: 5, d: 6 });
  const putts = Object.fromEntries(order.map((hole) => [hole, { a: 1, b: 2, c: 3, d: 4 }])) as PuttsByHole;
  const types = ["individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts"] as const;

  for (const type of types) {
    const base = createSupplementalBet(type, players, `participants-${type}`);
    const invalidParticipantLists = [
      ["a", "a", "c", "d"],
      ["a", "b", "c", "missing-player"],
    ];

    for (const participantIds of invalidParticipantLists) {
      const bet = { ...base, participantIds } as SupplementalBet;
      const result = calculate([bet], players, scoreRows, order, putts);
      assert.equal(result.results.length, 1, `${type}: ${participantIds.join(",")}`);
      assert.equal(result.results[0].complete, false, `${type}: ${participantIds.join(",")}`);
      assert.deepEqual(result.balances, { a: 0, b: 0, c: 0, d: 0 }, `${type}: ${participantIds.join(",")}`);
      assert.equal(Object.values(result.results[0].balances).every((amount) => amount === 0 && Number.isFinite(amount)), true, type);
    }
  }

  const team = createSupplementalBet("team_pressures", players, "invalid-team") as Extract<SupplementalBet, { type: "team_pressures" }>;
  const vegas = createSupplementalBet("vegas", players, "invalid-vegas-team") as Extract<SupplementalBet, { type: "vegas" }>;
  for (const bet of [
    { ...team, teamA: ["a", "b", "missing-player"] },
    { ...team, teamA: ["a", "a"] },
    { ...team, abandonedPlayerIds: ["a", "a"] },
    { ...team, abandonedPlayerIds: ["missing-player"] },
    { ...vegas, teamA: ["a", "b", "missing-player"] },
    { ...vegas, teamA: ["a", "a"] },
  ] as SupplementalBet[]) {
    const result = calculate([bet], players, scoreRows, order, putts);
    assert.equal(result.results[0].complete, false, `${bet.type}: ${bet.id}`);
    assert.deepEqual(result.balances, { a: 0, b: 0, c: 0, d: 0 }, `${bet.type}: ${bet.id}`);
  }
});
