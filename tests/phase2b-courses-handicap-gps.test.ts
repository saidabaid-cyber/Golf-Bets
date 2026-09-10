import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INTERNAL_GOLF_COURSE_CATALOG } from "../lib/golf-course-directory";
import { resolvePlayerTee, paginateStable } from "../features/courses/domain";
import { calculateCourseHandicap, createCourseHandicapSnapshot, normalizeBackyardHandicap } from "../features/handicap/course-handicap";
import { createManualHandicapProvider, futureGhinHandicapProvider } from "../features/handicap/providers";
import { calculateGreenDistances, gpsFallbackMessage, suggestCurrentHole } from "../features/gps/domain";
import { createLocalHoleMapProvider } from "../features/gps/providers";
import { disabledScoreExportProvider, validateScoreExportPayload } from "../features/score-export/provider";

const root = process.cwd();

test("tee resolution follows player, last, group, suggestion and unresolved precedence", () => {
  const courseId = INTERNAL_GOLF_COURSE_CATALOG.courses[0].id;
  const tees = INTERNAL_GOLF_COURSE_CATALOG.tees.filter((tee) => tee.courseId === courseId);
  assert.ok(tees.length >= 2);
  assert.equal(resolvePlayerTee({ catalog: INTERNAL_GOLF_COURSE_CATALOG, playerId: "p1", courseId, playerCourseTeeId: tees[0].id, lastUsedTeeId: tees[1].id }).source, "PLAYER_COURSE");
  assert.equal(resolvePlayerTee({ catalog: INTERNAL_GOLF_COURSE_CATALOG, playerId: "p1", courseId, lastUsedTeeId: tees[1].id }).tee?.id, tees[1].id);
  assert.equal(resolvePlayerTee({ catalog: INTERNAL_GOLF_COURSE_CATALOG, playerId: "p1", courseId, groupDefaultTeeId: tees[0].id }).source, "GROUP_DEFAULT");
  assert.equal(resolvePlayerTee({ catalog: INTERNAL_GOLF_COURSE_CATALOG, playerId: "p1", courseId, suggestedTeeId: tees[0].id }).needsConfirmation, true);
  assert.equal(resolvePlayerTee({ catalog: INTERNAL_GOLF_COURSE_CATALOG, playerId: "p1", courseId }).source, "UNRESOLVED");
});

test("course paging is bounded and cursor-stable", () => {
  const rows = Array.from({ length: 55 }, (_, index) => ({ id: `c${index}` }));
  const first = paginateStable(rows, undefined, 20);
  const second = paginateStable(rows, first.nextCursor, 20);
  assert.equal(first.items.length, 20);
  assert.equal(second.items[0].id, "c20");
  assert.equal(paginateStable(rows, undefined, 999).items.length, 50);
});

test("course handicap is deterministic, capped at 36 and snapshotted", () => {
  const base = { playerId: "said", index: 10, indexSource: "BACKYARD_MANUAL" as const, teeId: "white", teeName: "Blancas", slope: 125, courseRating: 70.1, par: 72, effectiveAt: "2026-09-10T00:00:00Z" };
  assert.equal(calculateCourseHandicap(base), 9);
  assert.equal(normalizeBackyardHandicap(54), 36);
  const snapshot = createCourseHandicapSnapshot({ ...base, index: 54 }, "2026-09-10T01:00:00Z");
  assert.equal(snapshot.index, 36);
  assert.equal(snapshot.courseHandicap, 38);
  assert.equal(snapshot.formulaVersion, "WHS-2024-COURSE-HANDICAP-V1");
});

test("handicap providers distinguish manual data from blocked GHIN", async () => {
  const manual = createManualHandicapProvider({ said: 40 }, "2026-09-10T00:00:00Z");
  const result = await manual.getCurrent({ userId: "said" });
  assert.equal(result.ok && result.data.value, 36);
  const ghin = await futureGhinHandicapProvider.getCurrent({ userId: "said" });
  assert.equal(ghin.ok, false);
  if (!ghin.ok) assert.equal(ghin.code, "not_authorized");
});

test("GPS distances use verified targets and hole changes remain suggestions", () => {
  const fix = { latitude: 19, longitude: -98, capturedAt: "2026-09-10T00:00:00Z", accuracyMeters: 6 };
  const holes = [
    { id: "h1", courseId: "c1", holeNumber: 1, par: 4, strokeIndex: 1, greenCenterLatitude: 19, greenCenterLongitude: -97.999 },
    { id: "h2", courseId: "c1", holeNumber: 2, par: 4, strokeIndex: 2, greenCenterLatitude: 19, greenCenterLongitude: -98.01 },
  ];
  const distances = calculateGreenDistances(fix, { greenCenterLatitude: 19, greenCenterLongitude: -97.999 });
  assert.ok((distances.centerYards ?? 0) > 100);
  const suggestion = suggestCurrentHole({ fix, holes, currentHole: 2 });
  assert.equal(suggestion?.holeNumber, 1);
  assert.equal(suggestion?.shouldOffer, true);
  assert.match(gpsFallbackMessage("DENIED"), /seguir capturando score/);
});

test("hole maps degrade without data and score export fails closed", async () => {
  const maps = createLocalHoleMapProvider([]);
  const missing = await maps.getHoleMap({ courseId: "c1", holeNumber: 1 });
  assert.equal(missing.ok, false);
  const exportResult = await disabledScoreExportProvider.exportScore({ operationId: "op1", roundId: "r1", playerId: "p1", playedOn: "2026-09-10", courseId: "c1", teeId: "t1", teeName: "White", grossScores: Array(18).fill(4) });
  assert.equal(exportResult.ok, false);
  assert.equal(validateScoreExportPayload({ operationId: "op1", roundId: "r1", playerId: "p1", playedOn: "2026-09-10", courseId: "c1", teeId: "t1", teeName: "White", grossScores: Array(18).fill(4) }), true);
});

test("Phase 2B route and migration keep provider search server-side and RLS additive", () => {
  const route = readFileSync(`${root}/app/api/courses/search/route.ts`, "utf8");
  const migration = readFileSync(`${root}/supabase/migrations/202609100002_phase2_course_handicap_gps.sql`, "utf8");
  assert.match(route, /internalCourseDataProvider\.searchCourses/);
  assert.match(route, /s-maxage=300/);
  for (const table of ["player_course_tee_preferences", "round_course_handicap_snapshots"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.doesNotMatch(migration, /drop table|truncate table/i);
});
