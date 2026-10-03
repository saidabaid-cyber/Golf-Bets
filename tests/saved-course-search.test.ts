import assert from "node:assert/strict";
import test from "node:test";
import { searchSavedCourses } from "../lib/saved-course-search";
import type { Course } from "../lib/types";

const privateCourse: Course = { id: "qa-private-card", name: "[QA TEST] Campo privado Mérida",
  teeName: "General", builtIn: false, holes: [] };

test("round search finds the owner's private card without a global catalog id", () => {
  const original = JSON.stringify(privateCourse);
  const results = searchSavedCourses([privateCourse], "[QA TEST]");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, privateCourse.id);
  assert.equal(results[0].courseId, privateCourse.id);
  assert.equal(results[0].tee.id, privateCourse.id);
  assert.equal(results[0].localIndexTeeAvailable, false);
  assert.equal(JSON.stringify(privateCourse), original);
});

test("saved search folds accents, bounds results and groups physical-course tees", () => {
  const tees = [{ ...privateCourse, catalogCourseId: "qa-layout", catalogTeeId: "qa-white" },
    { ...privateCourse, id: "qa-blue-card", catalogCourseId: "qa-layout", catalogTeeId: "qa-blue" },
    { ...privateCourse, id: "qa-second-private" }];
  assert.equal(searchSavedCourses(tees, "MERIDA").length, 2);
  assert.equal(searchSavedCourses(tees, "merida", 1).length, 1);
  assert.deepEqual(searchSavedCourses(tees, "m"), []);
  assert.deepEqual(searchSavedCourses(tees, "another account's course"), []);
  assert.deepEqual(searchSavedCourses([], "merida"), []);
});
