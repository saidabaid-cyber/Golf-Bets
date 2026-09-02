import assert from "node:assert/strict";
import test from "node:test";

import { buildHoleSummary, hasRoundProgress, historicalGolfStats, mergeCoursesPreservingEdits, migrateDraftPressures, privateLeaderboard, pushUndoState, readStoredJson, roundSnapshotToCsv, upsertFrequentPlayers } from "../lib/round-utils";
import type { Course, RoundSnapshot } from "../lib/types";

const original: Course = {
  id: "temporal",
  name: "La Vista Temporal",
  teeName: "General",
  builtIn: true,
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

test("saved course edits win over defaults without mutating historical snapshots", () => {
  const saved = { ...original, updatedAt: "2026-09-01", holes: original.holes.map((hole) => hole.number === 1 ? { ...hole, par: 5 } : hole) };
  const merged = mergeCoursesPreservingEdits([original], [saved]);
  assert.equal(merged[0].holes[0].par, 5);
  merged[0].holes[0].par = 3;
  assert.equal(saved.holes[0].par, 5);
  assert.equal(original.holes[0].par, 4);
});

test("V2.5 pressure settings migrate to physical nines", () => {
  const fromOne = migrateDraftPressures({ startHole: 1, bets: { foursome: { pressSecond9: true } }, personalBets: [{ back9Multiplier: 3 }] });
  assert.equal(fromOne.bets.foursome.pressureMultiplier, 2);
  assert.equal(fromOne.bets.foursome.pressureNine, "holes_10_18");
  assert.equal(fromOne.personalBets[0].pressureNine, "holes_10_18");
  const fromTen = migrateDraftPressures({ startHole: 10, bets: { foursome: { pressSecond9: false } }, personalBets: [{ back9Multiplier: 2 }] });
  assert.equal(fromTen.personalBets[0].pressureNine, "holes_1_9");
});

test("draft progress distinguishes an empty new round from a resumable round", () => {
  assert.equal(hasRoundProgress({ players: [], scores: {}, currentIndex: 0 }), false);
  assert.equal(hasRoundProgress({ players: [{ id: "a", name: "Said", handicap: null }], scores: {}, currentIndex: 0 }), true);
  assert.equal(hasRoundProgress({ players: [], scores: { 1: { a: 4 } }, currentIndex: 0 }), true);
});

test("private leaderboard reports Gross, Neto, par and Thru without marking partial cards finished", () => {
  const players = [{ id: "a", name: "Said", handicap: 1 }];
  const rows = privateLeaderboard(original, players, { 1: { a: 4 }, 2: { a: 5 } }, [1, 2, 3]);
  assert.equal(rows[0].gross, 9);
  assert.equal(rows[0].net, 8);
  assert.equal(rows[0].relativeToPar, 1);
  assert.equal(rows[0].thru, 2);
  assert.equal(rows[0].finished, false);
});

test("CSV export includes audit fields, players and scores", () => {
  const round: RoundSnapshot = {
    id: "r1", date: "2026-09-01", courseName: "La Vista", teeName: "General", ownerName: "Said",
    betResult: 500, expenses: { caddie: 100, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 100, netResult: 400,
    categoryResults: { Conejos: 500 }, players: [{ id: "a", name: "Said", handicap: 7 }], scores: { 1: { a: 4 } }, order: [1],
  };
  const csv = roundSnapshotToCsv(round);
  assert.match(csv, /fecha,campo,jugador,hcp,hoyo,score,apuestas,resultado_total,gastos/);
  assert.match(csv, /2026-09-01,La Vista,Said,7,1,4/);
});

test("undo stack is bounded and stores immutable snapshots", () => {
  const source = { score: 4 };
  let stack = pushUndoState([], source, 2);
  source.score = 5;
  stack = pushUndoState(stack, source, 2);
  source.score = 6;
  stack = pushUndoState(stack, source, 2);
  assert.deepEqual(stack, [{ score: 5 }, { score: 6 }]);
});

test("hole summary and frequent players preserve exact names and HCP", () => {
  const players = [{ id: "a", name: "Said", handicap: 7 }, { id: "b", name: "Jorge", handicap: null }];
  assert.deepEqual(buildHoleSummary(7, players, { 7: { a: 4, b: 5 } }, ["Skins: carry 2"]), ["Hoyo 7 guardado", "Said 4", "Jorge 5", "Skins: carry 2"]);
  const frequent = upsertFrequentPlayers([], players, "2026-09-01T00:00:00Z");
  assert.deepEqual(frequent.map(({ name, handicap, uses }) => ({ name, handicap, uses })), [{ name: "Jorge", handicap: null, uses: 1 }, { name: "Said", handicap: 7, uses: 1 }]);
});

test("historical stats never invent golf averages without complete score snapshots", () => {
  const round: RoundSnapshot = { id: "legacy", date: "2026-01-01", courseName: "Campo", teeName: "General", ownerName: "Said", betResult: 100, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, netResult: 100, categoryResults: { Conejos: 100 } };
  const stats = historicalGolfStats([round]);
  assert.equal(stats.rounds, 1);
  assert.equal(stats.averageGross, undefined);
  assert.equal(stats.averageNet, undefined);
  assert.equal(stats.categoryTotals.Conejos, 100);
});

test("un valor corrupto de localStorage no impide restaurar las demás claves", () => {
  const values = new Map<string, string>([
    ["corrupt", "{bad-json"],
    ["valid", JSON.stringify([{ id: "round-1" }])],
  ]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };

  assert.deepEqual(readStoredJson(storage as Pick<Storage, "getItem">, "corrupt", []), []);
  assert.deepEqual(readStoredJson(storage as Pick<Storage, "getItem">, "valid", []), [{ id: "round-1" }]);
  assert.deepEqual(readStoredJson(storage as Pick<Storage, "getItem">, "missing", ["fallback"]), ["fallback"]);
});
