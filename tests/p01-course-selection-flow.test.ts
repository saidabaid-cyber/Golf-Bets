import assert from "node:assert/strict";
import test from "node:test";

import {
  beginRoundCourseSelection,
  changeRoundCourseSelection,
  completeRoundTeeSelection,
  usableRoundCourseCards,
} from "../lib/round-course-selection";
import type { Course } from "../lib/types";

function card(id: string, courseId: string, holes = 18): Course {
  return {
    id,
    name: courseId === "north" ? "Recorrido Norte" : "Recorrido Sur",
    teeName: id.endsWith("blue") ? "Azul" : "Blanco",
    catalogCourseId: courseId,
    catalogTeeId: id,
    holes: Array.from({ length: holes }, (_, index) => ({
      number: index + 1,
      par: 4,
      strokeIndex: index + 1,
    })),
  };
}

test("the principal course selection advances to one tee step without choosing a tee", () => {
  const cards = [card("north-blue", "north"), card("north-white", "north")];
  const transition = beginRoundCourseSelection(cards);

  assert.equal(transition.ok, true);
  if (!transition.ok) return;
  assert.equal(transition.stage, "tee");
  assert.equal(transition.selectedTeeId, null);
  assert.deepEqual(transition.teeOptions.map(option => option.id), ["north-blue", "north-white"]);

  const completed = completeRoundTeeSelection(transition, "north-white");
  assert.equal(completed.ok, true);
  if (completed.ok) {
    assert.equal(completed.stage, "details");
    assert.equal(completed.course.id, "north-white");
  }
});

test("changing course clears only an incompatible tee", () => {
  const north = [card("north-blue", "north"), card("north-white", "north")];
  const south = [card("south-blue", "south")];
  const initial = beginRoundCourseSelection(north);
  assert.equal(initial.ok, true);
  if (!initial.ok) return;
  const selected = completeRoundTeeSelection(initial, "north-white");
  assert.equal(selected.ok, true);
  if (!selected.ok) return;

  const sameCourse = changeRoundCourseSelection(selected.course, north);
  assert.equal(sameCourse.ok, true);
  if (sameCourse.ok) assert.equal(sameCourse.selectedTeeId, "north-white");

  const changedCourse = changeRoundCourseSelection(selected.course, south);
  assert.equal(changedCourse.ok, true);
  if (changedCourse.ok) assert.equal(changedCourse.selectedTeeId, null);
});

test("a real nine-hole scorecard remains selectable and never fabricates holes", () => {
  const nineHole = card("north-white", "north", 9);
  const usable = usableRoundCourseCards([nineHole]);
  assert.equal(usable.length, 1);
  assert.deepEqual(usable[0].holes.map(hole => hole.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
