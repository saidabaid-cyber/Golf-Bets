import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  coursesForPendingIdentity,
  normalizeRoundSetupCourseIdentity,
  resolveManualRoundCourseState,
} from "../lib/backyard-ai/runtime/manual-course-focus";
import type { Course } from "../lib/types";

function course(id: string, name: string, teeName: string, catalogCourseId?: string): Course {
  return {
    id,
    name,
    teeName,
    ...(catalogCourseId ? { catalogCourseId } : {}),
    holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
  };
}

test("manual AI setup replaces a prior unrelated backing course and focuses every recognized La Vista tee", () => {
  const prior = course("prior-red", "Club anterior", "Rojas", "course-prior");
  const vistaBlue = course("vista-blue", "La Vista", "Azules", "course-la-vista");
  const vistaWhite = course("vista-white", "La Vista", "Blancas", "course-la-vista");
  const identity = {
    name: "La Vista",
    catalogCourseId: "course-la-vista",
    candidateCourseIds: [vistaBlue.id, vistaWhite.id],
  };

  const state = resolveManualRoundCourseState({
    currentCourse: prior,
    availableCourses: [prior, vistaBlue, vistaWhite],
    draftCourse: null,
    draftCourseSelected: false,
    courseIdentity: identity,
  });

  assert.equal(state.course.id, vistaBlue.id);
  assert.equal(state.courseSelected, false);
  assert.deepEqual(state.pendingIdentity, identity);
  assert.deepEqual(state.candidates.map((candidate) => candidate.id), [vistaBlue.id, vistaWhite.id]);
  assert.deepEqual(coursesForPendingIdentity([prior, vistaBlue, vistaWhite], identity).map((candidate) => candidate.id), [vistaBlue.id, vistaWhite.id]);
});

test("manual AI setup auto-selects only a sole candidate that exists as a real tee", () => {
  const prior = course("prior-red", "Club anterior", "Rojas", "course-prior");
  const vistaBlue = course("vista-blue", "La Vista", "Azules", "course-la-vista");
  const sole = resolveManualRoundCourseState({
    currentCourse: prior,
    availableCourses: [prior, vistaBlue],
    draftCourse: null,
    draftCourseSelected: false,
    courseIdentity: { name: "La Vista", candidateCourseIds: [vistaBlue.id] },
  });
  assert.equal(sole.course.id, vistaBlue.id);
  assert.equal(sole.courseSelected, true);
  assert.equal(sole.pendingIdentity, null);

  const missing = resolveManualRoundCourseState({
    currentCourse: prior,
    availableCourses: [prior],
    draftCourse: null,
    draftCourseSelected: false,
    courseIdentity: { name: "La Vista", candidateCourseIds: ["missing-tee"] },
  });
  assert.equal(missing.course.id, prior.id);
  assert.equal(missing.courseSelected, false);
  assert.equal(missing.pendingIdentity?.name, "La Vista");
});

test("pending course identity is normalized, persisted, and wired into the visible manual selector", () => {
  assert.deepEqual(normalizeRoundSetupCourseIdentity({
    name: " La Vista ",
    catalogCourseId: " course-la-vista ",
    candidateCourseIds: [" vista-blue ", "vista-blue", null],
  }), {
    name: "La Vista",
    catalogCourseId: "course-la-vista",
    candidateCourseIds: ["vista-blue"],
  });

  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /courseIdentity: courseSelected \? undefined : pendingCourseIdentity \?\? undefined/);
  assert.match(page, /course: courseSelected \? course : null/);
  assert.match(page, /Campo reconocido: \{pendingCourseIdentity\.name\}/);
  assert.match(page, /label=\{`Tees de \$\{pendingCourseIdentity\.name\}`\}/);
  assert.match(page, /label="Otros campos y tees"/);
  assert.match(page, /setPendingCourseIdentity\(null\)[\s\S]{0,120}setCourseSelectionError\(false\)/);
});
