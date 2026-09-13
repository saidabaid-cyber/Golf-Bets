import assert from "node:assert/strict";
import test from "node:test";

import {
  isStatisticsDeleteConfirmation,
  parseStatisticsReset,
  requestStatisticsReset,
  roundsEligibleForStatistics,
} from "../lib/statistics-reset";
import type { RoundSnapshot } from "../lib/types";

const round = (id: string, completedAt: string) => ({ id, completedAt, date: completedAt.slice(0, 10) }) as RoundSnapshot;

test("eliminar estadísticas exige exactamente ELIMINAR", () => {
  assert.equal(isStatisticsDeleteConfirmation("ELIMINAR"), true);
  assert.equal(isStatisticsDeleteConfirmation("eliminar"), false);
  assert.equal(isStatisticsDeleteConfirmation(" ELIMINAR "), false);
});

test("RESET_FROM_DATE conserva histórico pero excluye rondas anteriores de Stats", () => {
  const history = [round("old", "2026-01-01T12:00:00.000Z"), round("new", "2026-03-01T12:00:00.000Z")];
  const eligible = roundsEligibleForStatistics(history, "2026-02-01T12:00:00.000Z");
  assert.deepEqual(eligible.map((item) => item.id), ["new"]);
  assert.deepEqual(history.map((item) => item.id), ["old", "new"], "el histórico original no se muta");
});

test("sin reset todas las rondas siguen alimentando Stats", () => {
  const history = [round("one", "2026-01-01T12:00:00.000Z")];
  assert.deepEqual(roundsEligibleForStatistics(history, null), history);
});

test("el cliente nunca envía userId y valida sesión antes del request", async () => {
  let called = false;
  await assert.rejects(() => requestStatisticsReset(null, "ELIMINAR", async () => { called = true; throw new Error("unexpected"); }), /Inicia sesión/);
  assert.equal(called, false);
  await assert.rejects(() => requestStatisticsReset("token", "eliminar", async () => { called = true; throw new Error("unexpected"); }), /Escribe ELIMINAR/);
  assert.equal(called, false);

  const reset = await requestStatisticsReset("token", "ELIMINAR", async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(payload, { confirmation: "ELIMINAR" });
    assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, "Bearer token");
    return new Response(JSON.stringify({ resetAt: "2026-09-13T20:00:00.000Z", strategy: "RESET_FROM_DATE" }), { status: 200 });
  });
  assert.deepEqual(reset, { resetAt: "2026-09-13T20:00:00.000Z", strategy: "RESET_FROM_DATE" });
});

test("respuestas de reset malformadas se rechazan", () => {
  assert.equal(parseStatisticsReset({ resetAt: "bad", strategy: "RESET_FROM_DATE" }), null);
  assert.equal(parseStatisticsReset({ resetAt: "2026-09-13T20:00:00.000Z", strategy: "DELETE_ROUNDS" }), null);
});
