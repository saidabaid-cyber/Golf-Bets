import assert from "node:assert/strict";
import test from "node:test";

import { applyRoundCourseHandicaps } from "../features/handicap/round-player-handicap";
import type { Course, Player, PlayerTeeAssignmentSnapshot } from "../lib/types";

const course: Course = {
  id: "vista-white",
  catalogCourseId: "vista",
  name: "La Vista",
  teeName: "Blancas",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

const tee: PlayerTeeAssignmentSnapshot = {
  playerId: "account:user-a",
  courseId: "vista",
  teeId: "vista-white",
  teeName: "Blancas",
  rating: 70.1,
  slope: 125,
  source: "catalog",
  capturedAt: "2026-09-10T10:00:00.000Z",
};

test("una cuenta usa Index + tee y conserva un snapshot inmutable de HCP de juego", () => {
  const player: Player = { id: "account:user-a", accountUserId: "user-a", name: "Said", handicap: 10, handicapIndex: 10, handicapSource: "profile_index", handicapIndexSource: "BACKYARD_MANUAL" };
  const applied = applyRoundCourseHandicaps([player], [tee], course, "2026-09-10T11:00:00.000Z");
  assert.equal(applied[0].handicap, 9);
  assert.equal(applied[0].handicapIndex, 10);
  assert.deepEqual(applied[0].courseHandicapSnapshot, {
    index: 10,
    indexSource: "BACKYARD_MANUAL",
    teeId: "vista-white",
    teeName: "Blancas",
    slope: 125,
    courseRating: 70.1,
    par: 72,
    courseHandicap: 9,
    appliedHandicap: 9,
    formulaVersion: "WHS-2024-COURSE-HANDICAP-V1",
    effectiveAt: tee.capturedAt,
    calculatedAt: "2026-09-10T11:00:00.000Z",
  });
  const reapplied = applyRoundCourseHandicaps(applied, [tee], course, "2026-09-11T00:00:00.000Z");
  assert.strictEqual(reapplied, applied, "la misma entrada no reescribe el snapshot ni provoca un loop");
});

test("un Guest conserva HCP manual aunque exista un tee con rating y slope", () => {
  const guest: Player = { id: "guest-a", name: "Bruno", handicap: 18, handicapSource: "manual" };
  const applied = applyRoundCourseHandicaps([guest], [{ ...tee, playerId: guest.id }], course, "2026-09-10T11:00:00.000Z");
  assert.strictEqual(applied[0], guest);
  assert.equal(applied[0].courseHandicapSnapshot, undefined);
});

test("sin Rating/Slope no inventa HCP de juego y al cambiar de tee recalcula desde el Index", () => {
  const player: Player = { id: "account:user-a", accountUserId: "user-a", name: "Said", handicap: 10, handicapIndex: 10, handicapSource: "profile_index" };
  const unresolved = applyRoundCourseHandicaps([player], [{ ...tee, rating: undefined, slope: undefined }], course, "2026-09-10T11:00:00.000Z");
  assert.strictEqual(unresolved[0], player);
  const first = applyRoundCourseHandicaps(unresolved, [tee], course, "2026-09-10T11:00:00.000Z");
  const changed = applyRoundCourseHandicaps(first, [{ ...tee, teeId: "vista-blue", teeName: "Azules", rating: 73, slope: 135, capturedAt: "2026-09-10T11:30:00.000Z" }], course, "2026-09-10T11:30:00.000Z");
  assert.equal(changed[0].handicapIndex, 10);
  assert.equal(changed[0].handicap, 13);
  assert.equal(changed[0].courseHandicapSnapshot?.teeName, "Azules");
});

test("el tope Backyard queda explícito sin ocultar el resultado bruto de la fórmula", () => {
  const player: Player = { id: "account:user-a", accountUserId: "user-a", name: "Said", handicap: 36, handicapIndex: 36, handicapSource: "profile_index" };
  const applied = applyRoundCourseHandicaps([player], [{ ...tee, rating: 76, slope: 155 }], course, "2026-09-10T11:00:00.000Z");
  assert.equal(applied[0].courseHandicapSnapshot?.courseHandicap, 53);
  assert.equal(applied[0].courseHandicapSnapshot?.appliedHandicap, 36);
  assert.equal(applied[0].handicap, 36);
});
