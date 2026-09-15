import assert from "node:assert/strict";
import test from "node:test";

import {
  isStatisticsDeleteConfirmation,
  fetchStatisticsResetStatus,
  parseStatisticsReset,
  persistStatisticsReset,
  preserveRoundStatisticsOrigin,
  readStatisticsReset,
  requestStatisticsReset,
  roundsEligibleForStatistics,
} from "../lib/statistics-reset";
import { buildGolfInsights } from "../lib/golf-insights";
import type { Course, RoundSnapshot } from "../lib/types";

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

test("editar una ronda histórica después del reset no resucita estadísticas previas", () => {
  const edited = {
    ...round("old", "2026-01-01T12:00:00.000Z"),
    updatedAt: "2026-09-14T20:00:00.000Z",
  } as RoundSnapshot;
  const legacy = {
    id: "legacy",
    startedAt: "2026-01-02T12:00:00.000Z",
    updatedAt: "2026-09-14T20:00:00.000Z",
    date: "2026-01-02",
  } as RoundSnapshot;
  assert.deepEqual(roundsEligibleForStatistics([edited, legacy], "2026-02-01T12:00:00.000Z"), []);
});

test("corrección histórica conserva instante original aunque save cree completedAt=now", () => {
  const original = { ...round("old", "2026-01-01T12:00:00.000Z"), startedAt: "2026-01-01T08:00:00.000Z" };
  const correction = { ...original, completedAt: "2026-09-15T12:00:00.000Z", startedAt: "2026-09-15T08:00:00.000Z", date: "2026-09-15", updatedAt: "2026-09-15T12:00:00.000Z" };
  const preserved = preserveRoundStatisticsOrigin(correction, original);
  assert.equal(preserved.completedAt, original.completedAt);
  assert.equal(preserved.startedAt, original.startedAt);
  assert.equal(preserved.date, original.date);
  assert.equal(preserved.updatedAt, correction.updatedAt);
  assert.deepEqual(roundsEligibleForStatistics([preserved], "2026-02-01T12:00:00.000Z"), []);

  const legacy = { id: "legacy", date: "2026-01-02" } as RoundSnapshot;
  const correctedLegacy = preserveRoundStatisticsOrigin({ ...legacy, date: "2026-09-15", completedAt: "2026-09-15T12:00:00.000Z" }, legacy);
  assert.equal(correctedLegacy.completedAt, undefined);
  assert.deepEqual(roundsEligibleForStatistics([correctedLegacy], "2026-02-01T12:00:00.000Z"), []);
  assert.equal(preserveRoundStatisticsOrigin(correction, { ...original, id: "different" }).completedAt, correction.completedAt);
});

test("sin reset todas las rondas siguen alimentando Stats", () => {
  const history = [round("one", "2026-01-01T12:00:00.000Z")];
  assert.deepEqual(roundsEligibleForStatistics(history, null), history);
});

test("0 Stats tras reset y reload local: capturas deportivas desaparecen, Histórico/balances permanecen", () => {
  const course: Course = { id: "reset-qa", name: "Campo QA", teeName: "Azules",
    holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })) };
  const old: RoundSnapshot = {
    id: "historical-qa", lifecycleState: "completed", date: "2026-01-01", completedAt: "2026-01-01T18:00:00.000Z",
    courseName: course.name, teeName: course.teeName, ownerName: "Said", ownerId: "owner", roundHoles: 9,
    betResult: 100, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0, netResult: 100, categoryResults: {},
    players: [{ id: "owner", name: "Said", handicap: 0 }], order: course.holes.map((hole) => hole.number), courseSnapshot: course,
    scores: Object.fromEntries(course.holes.map((hole) => [hole.number, { owner: 4 }])),
    putts: Object.fromEntries(course.holes.map((hole) => [hole.number, { owner: 2 }])),
    advancedStats: { 1: { owner: { greenSideBunkerCount: 1, teeDirection: "left", outOfBoundsCount: 1 } } },
  };
  const history = [old];
  const before = buildGolfInsights(history);
  assert.equal(before.scoredRounds, 1);
  assert.equal(before.averagePutts, 18);
  assert.equal(before.capture?.greenSideBunkers, 1);
  assert.equal(before.betBalance, 100);

  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  persistStatisticsReset(storage, "owner-account", { resetAt: "2026-02-01T00:00:00.000Z", strategy: "RESET_FROM_DATE" });
  const reloaded = readStatisticsReset(storage, "owner-account");
  assert.ok(reloaded);
  const sports = buildGolfInsights(roundsEligibleForStatistics(history, reloaded.resetAt));
  assert.equal(sports.rounds, 0);
  assert.equal(sports.scoredRounds, 0);
  assert.equal(sports.averageScore, undefined);
  assert.equal(sports.averagePutts, undefined);
  assert.equal(sports.capture?.greenSideBunkers, 0);
  assert.equal(sports.capture?.outOfBounds, 0);
  assert.equal(sports.betBalance, undefined);
  assert.deepEqual(history, [old], "el histórico financiero y la captura original no se mutan");
  assert.equal(buildGolfInsights(history).betBalance, 100);
});

test("el cliente nunca envía userId y valida sesión antes del request", async () => {
  let called = false;
  await assert.rejects(() => requestStatisticsReset(null, "ELIMINAR", async () => { called = true; throw new Error("unexpected"); }), /Inicia sesión/);
  assert.equal(called, false);
  await assert.rejects(() => requestStatisticsReset("token", "eliminar", async () => { called = true; throw new Error("unexpected"); }), /Escribe ELIMINAR/);
  assert.equal(called, false);

  const requestId = "11111111-1111-4111-8111-111111111111";
  const reset = await requestStatisticsReset("token", "ELIMINAR", async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(payload, { confirmation: "ELIMINAR", requestId });
    assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, "Bearer token");
    assert.ok(init?.signal, "DELETE tiene cancelación acotada");
    return new Response(JSON.stringify({ resetAt: "2026-09-13T20:00:00.000Z", strategy: "RESET_FROM_DATE" }), { status: 200 });
  }, requestId);
  assert.deepEqual(reset, { resetAt: "2026-09-13T20:00:00.000Z", strategy: "RESET_FROM_DATE" });
});

test("lookup autoritativo distingue sin reset de store indisponible", async () => {
  assert.deepEqual(await fetchStatisticsResetStatus("token", async () => Response.json({ resetAt: null, strategy: "RESET_FROM_DATE" })),
    { state: "ready", reset: null });
  const unavailable = await fetchStatisticsResetStatus("token", async () => Response.json({ code: "PENDING_CONTROLLED_DB_APPLY", error: "Migración pendiente" }, { status: 503 }));
  assert.deepEqual(unavailable, { state: "unavailable", code: "PENDING_CONTROLLED_DB_APPLY", error: "Migración pendiente" });
  assert.equal((await fetchStatisticsResetStatus("token", async () => Response.json({ resetAt: "bad", strategy: "RESET_FROM_DATE" }))).state, "unavailable");
});

test("timeout o corte de red no se interpreta como ausencia de reset", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  await assert.rejects(() => requestStatisticsReset("token", "ELIMINAR", async (_input, init) => {
    assert.ok(init?.signal);
    assert.deepEqual(JSON.parse(String(init?.body)), { confirmation: "ELIMINAR", requestId });
    throw new Error("network aborted");
  }, requestId), /Reintenta la misma solicitud/);
  assert.deepEqual(await fetchStatisticsResetStatus("token", async (_input, init) => {
    assert.ok(init?.signal);
    throw new Error("network aborted");
  }), { state: "unavailable", code: "STATISTICS_NETWORK_UNAVAILABLE", error: "No pude confirmar el estado de tus estadísticas. Reintenta cuando haya conexión." });
});

test("respuestas de reset malformadas se rechazan", () => {
  assert.equal(parseStatisticsReset({ resetAt: "bad", strategy: "RESET_FROM_DATE" }), null);
  assert.equal(parseStatisticsReset({ resetAt: "2026-09-13T20:00:00.000Z", strategy: "DELETE_ROUNDS" }), null);
});
