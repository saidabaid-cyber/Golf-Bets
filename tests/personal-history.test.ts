import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalHistory, snapshotPersonalResult } from "../lib/personal-history";
import { applySavedPersonalRivalTemplate, updateSavedPersonalRivalTemplate } from "../lib/frequent-templates";
import { resolvePersonalHistoryDeletion } from "../lib/round-utils";
import type { PersonalBet, PersonalHistoryResult, RoundSnapshot } from "../lib/types";

const today = "2026-09-02";
const bet: PersonalBet = {
  id: "bet", rivalMode: "external", externalRivalId: "carlos", rivalName: "Carlos", rivalHandicap: 11,
  externalScores: {}, baseValue: 100, advantageReceiver: "rival", advantageStrokes: 2,
  back9Multiplier: 1, pressureMultiplier: 2, pressureNine: "holes_10_18",
  components: { match1: true, medal1: true, match2: true, medal2: true, match18: false, medal18: false },
};
function result(id: string, value: number, name = "Carlos"): PersonalHistoryResult {
  return { rivalKey: id, rivalName: name, totalMoney: value, componentMoney: { match1: value } };
}
function round(id: string, date: string, personalResults: PersonalHistoryResult[]): RoundSnapshot {
  const total = personalResults.reduce((sum, item) => sum + item.totalMoney, 0);
  return { id, date, courseName: "La Vista", teeName: "Azules", ownerName: "Said", betResult: total, expenseTotal: 0, netResult: total, categoryResults: { Personales: total }, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, personalResults };
}

test("histórico une IDs de ronda distintos por nombre normalizado y conserva perspectiva del principal", () => {
  const rows = buildPersonalHistory([round("a", today, [result("new-id", 500, " CARLOS ")]), round("b", "2026-08-25", [result("old-id", -300, "carlos")])], today);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].total, rows[0].rounds, rows[0].wins, rows[0].losses, rows[0].ties], [200, 2, 1, 1, 0]);
  assert.equal(rows[0].records[0].totalMoney, 500);
  assert.equal(rows[0].records[0].ownerName, "Said");
});

test("varias personales en la misma ronda cuentan una ronda y clasifican su resultado conjunto", () => {
  const rows = buildPersonalHistory([round("a", today, [result("x", 100), result("y", -100)])], today);
  assert.deepEqual([rows[0].rounds, rows[0].wins, rows[0].losses, rows[0].ties], [1, 0, 0, 1]);
  assert.equal(rows[0].records[0].entries.length, 2);
});

test("snapshot conserva nombre, HCP, configuración y resultado después de editar rival frecuente", () => {
  const template = { id: "carlos", name: "Carlos", handicap: 11, baseValue: 100 };
  const active = applySavedPersonalRivalTemplate(bet, template);
  const snapshot = snapshotPersonalResult(active, { totalMoney: 300, componentMoney: { match2: 200, medal1: 100 } }, []);
  const saved = JSON.stringify(snapshot);
  const edited = updateSavedPersonalRivalTemplate([template], "carlos", { name: "Carlos nuevo", handicap: 5, baseValue: 500 }, today);
  assert.equal(edited[0].name, "Carlos nuevo");
  active.components.match1 = false;
  active.externalScores[1] = 8;
  assert.equal(JSON.stringify(snapshot), saved);
  assert.equal(snapshot.rivalHandicap, 11);
  assert.equal(snapshot.betSnapshot?.baseValue, 100);
});

test("rival frecuente renombrado mantiene identidad y nombre histórico de cada jugada", () => {
  const before = snapshotPersonalResult(bet, { totalMoney: 100, componentMoney: { match1: 100 } }, []);
  const after = snapshotPersonalResult({ ...bet, rivalName: "Carlos nuevo" }, { totalMoney: -200, componentMoney: { medal1: -200 } }, []);
  const rows = buildPersonalHistory([round("a", "2026-08-25", [before]), round("b", today, [after])], today);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, -100);
  assert.deepEqual(rows[0].records.map((record) => record.entries[0].rivalName), ["Carlos nuevo", "Carlos"]);
});

test("no mezcla dos rivales frecuentes explícitamente distintos aunque compartan nombre", () => {
  const first = snapshotPersonalResult(bet, { totalMoney: 100, componentMoney: {} }, []);
  const second = snapshotPersonalResult({ ...bet, externalRivalId: "otro-carlos" }, { totalMoney: -200, componentMoney: {} }, []);
  assert.equal(buildPersonalHistory([round("a", today, [first, second])], today).length, 2);
});

test("eliminar personal recalcula balance, rondas, ganadas/perdidas/empatadas y componentes tras reload", () => {
  const source = [round("a", today, [result("x", 100), result("y", -100)]), round("b", "2026-08-25", [result("z", 500)])];
  const removed = resolvePersonalHistoryDeletion(source, "a", 1, "delete", today);
  const reloaded = JSON.parse(JSON.stringify(removed)) as RoundSnapshot[];
  const row = buildPersonalHistory(reloaded, today)[0];
  assert.deepEqual([row.total, row.rounds, row.wins, row.losses, row.ties, row.matchMoney], [600, 2, 2, 0, 0, 600]);
  assert.equal(removed[1], source[1]);
  assert.equal(source[0].personalResults?.length, 2);
  assert.equal(removed[0].betResult, 100);
});

test("cancelar eliminación personal mantiene el mismo historial y balance", () => {
  const source = [round("a", today, [result("x", -100)])];
  assert.equal(resolvePersonalHistoryDeletion(source, "a", 0, "cancel"), source);
  assert.equal(buildPersonalHistory(source, today)[0].total, -100);
});

test("filtros año/mes y órdenes no modifican snapshots", () => {
  const history = [round("a", today, [result("x", 100, "Carlos")]), round("b", "2026-08-25", [result("y", -300, "Jorge")]), round("c", "2025-01-01", [result("z", 500, "Carlos")])];
  const original = JSON.stringify(history);
  assert.equal(buildPersonalHistory(history, today, "month").length, 1);
  assert.equal(buildPersonalHistory(history, today, "year").reduce((sum, rival) => sum + rival.rounds, 0), 2);
  assert.equal(buildPersonalHistory(history, today, "all", "played")[0].name, "Carlos");
  assert.equal(buildPersonalHistory(history, today, "all", "lost")[0].name, "Jorge");
  assert.equal(buildPersonalHistory(history, today, "all", "won")[0].total, 600);
  assert.equal(JSON.stringify(history), original);
});

test("Match y Medal suman importes ya presionados sin aplicar otra vez el multiplicador", () => {
  const snapshot = snapshotPersonalResult(bet, { totalMoney: 600, componentMoney: { match1: 100, match2: 200, medal1: 100, medal2: 200 } }, []);
  const row = buildPersonalHistory([round("a", today, [snapshot])], today)[0];
  assert.deepEqual([row.total, row.matchMoney, row.medalMoney], [600, 300, 300]);
});

test("análisis por rival separa apuestas, ganado, perdido, press y tramos sin duplicar rondas", () => {
  const pressured = snapshotPersonalResult(bet, {
    totalMoney: 600,
    componentMoney: { match1: 100, medal1: -100, match2: 300, medal2: 200, match18: 100 },
  }, []);
  const loss = snapshotPersonalResult(bet, {
    totalMoney: -250,
    componentMoney: { match1: -100, medal1: -150 },
  }, []);
  const row = buildPersonalHistory([
    round("same-round", today, [pressured, loss]),
  ], today)[0];
  assert.deepEqual({
    rounds: row.rounds,
    bets: row.bets,
    wonMoney: row.wonMoney,
    lostMoney: row.lostMoney,
    net: row.total,
    first: row.firstMoney,
    second: row.secondMoney,
    total18: row.total18Money,
    pressure: row.pressureMoney,
  }, {
    rounds: 1,
    bets: 2,
    wonMoney: 600,
    lostMoney: 250,
    net: 350,
    first: -250,
    second: 500,
    total18: 100,
    pressure: 200,
  });
});

test("compatibilidad legacy recupera configuración por identidad y nunca por índice tras borrar", () => {
  const source = round("a", today, [result("personal:carlos", 100), result("personal:jorge", 200, "Jorge")]);
  source.personalBets = [bet, { ...bet, id: "other", externalRivalId: "jorge", rivalName: "Jorge", rivalHandicap: 7 }];
  const remaining = resolvePersonalHistoryDeletion([source], "a", 0, "delete");
  const row = buildPersonalHistory(remaining, today)[0];
  assert.equal(row.records[0].entries[0].betSnapshot?.id, "other");
  assert.equal(row.records[0].entries[0].rivalHandicap, 7);
});
