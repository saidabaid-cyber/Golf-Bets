import assert from "node:assert/strict";
import test from "node:test";

import { coursePreferenceStorageKey, normalizeCourseIds, rememberRecentCourse, toggleFavoriteCourse } from "../lib/course-preferences";

test("course preference storage is isolated per identity", () => {
  assert.equal(coursePreferenceStorageKey("favorites", "user-a"), "golfbets-course-favorites-v1:user-a");
  assert.equal(coursePreferenceStorageKey("recents", ""), "golfbets-course-recents-v1:guest");
});

test("course favorites are unique, reversible and limited to existing courses when hydrating", () => {
  assert.deepEqual(normalizeCourseIds(["a", "a", 3, "missing", "b"], ["a", "b"]), ["a", "b"]);
  assert.deepEqual(toggleFavoriteCourse(["a"], "b"), ["b", "a"]);
  assert.deepEqual(toggleFavoriteCourse(["b", "a"], "b"), ["a"]);
});

test("recent courses move to the front without duplicates and stay bounded", () => {
  assert.deepEqual(rememberRecentCourse(["a", "b", "c"], "b", 3), ["b", "a", "c"]);
  assert.deepEqual(rememberRecentCourse(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
  assert.deepEqual(rememberRecentCourse(["a"], "b", 0), []);
});
