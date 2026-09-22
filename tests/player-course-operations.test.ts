import test from "node:test";
import assert from "node:assert/strict";
import { courseWithResolvedOperations } from "../lib/player-course-operations";
import type { Course } from "../lib/types";

test("resolved temporary Course becomes a frozen round snapshot without mutating base", () => {
  const base: Course = { id: "tee-a", catalogCourseId: "course-a", catalogTeeId: "tee-a", name: "Synthetic", teeName: "Base", holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })) };
  const holes = Array.from({ length: 18 }, (_, index) => ({ id: `resolved-${index + 1}`, runtimeHoleNumber: index + 1, displayLabel: index === 3 ? "4A" : String(index + 1), par: index === 3 ? 3 : 4, strokeIndex: index + 1 }));
  const snapshot = courseWithResolvedOperations(base, { badges: ["TEMPORAL", "Reglas locales"], warning: undefined, competitionId: "30000000-0000-4000-8000-000000000104", competitionRuleSet: { id: "30000000-0000-4000-8000-000000000204", version: 3 }, localRules: [{ id: "r1", title: "Dropeo", body: "Usar zona marcada.", holeRefs: [3], active: true }], resolved: { sourceCourseId: "course-a", baseVersion: 1, configurationIds: ["config-a"], configurationVersions: [2], configurationHashes: ["hash-a"], resolvedHoles: holes, resolvedTees: [{ id: "tee-a", name: "Test Tee", rating: null, slope: null, yardages: Object.fromEntries(holes.map((hole) => [hole.id, 100])) }], warnings: [], effectiveAt: "2026-09-22T12:00:00Z" } });
  assert.equal(base.holes[3].par, 4);
  assert.equal(snapshot.holes[3].displayLabel, "4A");
  assert.equal(snapshot.holes[3].par, 3);
  assert.equal(snapshot.totalYards, 1800);
  assert.deepEqual(snapshot.operationsSnapshot?.configurationIds, ["config-a"]);
  assert.equal(snapshot.operationsSnapshot?.competitionRuleVersion, 3);
  assert.equal(snapshot.localRules?.[0].hole, 3);
});
