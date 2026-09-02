import assert from "node:assert/strict";
import test from "node:test";

import { persistRoundHistory, resolveHistoricalRoundDeletion, resolvePersonalHistoryDeletion, STORAGE_KEYS } from "../lib/round-utils";
import type { RoundSnapshot } from "../lib/types";

const makeRound = (id: string): RoundSnapshot => ({
  id,
  date: "2026-09-01",
  courseName: id === "round-1" ? "La Vista" : "El Cristo",
  teeName: "General",
  ownerName: "Said",
  betResult: 350,
  expenses: { caddie: 100, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
  expenseTotal: 100,
  netResult: 250,
  categoryResults: { Conejos: 100, Personales: 250 },
  personalResults: [
    { rivalKey: "rival-carlos", rivalName: "Carlos", totalMoney: 300, componentMoney: { match1: 100, medal1: 200 } },
    { rivalKey: "rival-cuau", rivalName: "Cuau", totalMoney: -50, componentMoney: { match1: -50 } },
  ],
});
test("eliminar ronda histórica quita únicamente la ronda elegida", () => {
  const rounds = [makeRound("round-1"), makeRound("round-2")];
  const next = resolveHistoricalRoundDeletion(rounds, "round-1", "delete");
  assert.deepEqual(next.map((round) => round.id), ["round-2"]);
  assert.equal(next[0].courseName, "El Cristo");
});

test("cancelar eliminación de ronda histórica conserva todos los snapshots", () => {
  const rounds = [makeRound("round-1"), makeRound("round-2")];
  assert.equal(resolveHistoricalRoundDeletion(rounds, "round-1", "cancel"), rounds);
});

test("la eliminación histórica persiste en la clave correcta", () => {
  const written = new Map<string, string>();
  const next = resolveHistoricalRoundDeletion([makeRound("round-1"), makeRound("round-2")], "round-1", "delete");
  persistRoundHistory({ setItem: (key, value) => { written.set(key, value); } }, next);
  assert.equal(written.size, 1);
  assert.deepEqual(JSON.parse(written.get(STORAGE_KEYS.history) || "[]").map((round: RoundSnapshot) => round.id), ["round-2"]);
});

test("borrar un registro personal conserva el otro registro y las demás rondas", () => {
  const rounds = [makeRound("round-1"), makeRound("round-2")];
  const next = resolvePersonalHistoryDeletion(rounds, "round-1", 0, "delete");
  assert.equal(next[0].personalResults?.length, 1);
  assert.equal(next[0].personalResults?.[0].rivalName, "Cuau");
  assert.equal(next[1], rounds[1]);
});

test("cancelar borrado personal conserva el historial sin cambios", () => {
  const rounds = [makeRound("round-1")];
  assert.equal(resolvePersonalHistoryDeletion(rounds, "round-1", 0, "cancel"), rounds);
});

test("borrar un registro personal recalcula Personales, apuestas y neto de esa ronda", () => {
  const next = resolvePersonalHistoryDeletion([makeRound("round-1")], "round-1", 0, "delete")[0];
  assert.equal(next.categoryResults.Personales, -50);
  assert.equal(next.categoryResults.Conejos, 100);
  assert.equal(next.betResult, 50);
  assert.equal(next.expenseTotal, 100);
  assert.equal(next.netResult, -50);
});
