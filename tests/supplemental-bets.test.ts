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
    assert.deepEqual(result.balances, { a: 300, b: 0, c: -300 });
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

test("Presiones por parejas use the configured maximum for a player who abandoned", () => {
  const bet = { ...createSupplementalBet("team_pressures", players, "abandoned"), metric: "high", abandonedPlayerIds: ["b"], abandonedMaxScore: 8 } as SupplementalBet;
  const result = calculate([bet], players, { 1: { a: 3, c: 5, d: 6 } }, [1]);
  assert.equal(result.results[0].complete, true);
  assert.deepEqual(result.balances, { a: -200, b: -200, c: 200, d: 200 });
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
