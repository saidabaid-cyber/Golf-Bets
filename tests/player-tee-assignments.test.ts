import assert from "node:assert/strict";
import test from "node:test";
import { assignTeeToEveryPlayer, reconcilePlayerTeeAssignments, teeAssignmentSnapshot, teeOptionsForCourse, updatePlayerTeeAssignment } from "../lib/player-tee-assignments";
import type { Course, Player } from "../lib/types";

const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
const white: Course = { id: "vista-white", name: "La Vista", teeName: "Blancas", catalogCourseId: "vista", catalogTeeId: "white", rating: 70.1, slope: 125, totalYards: 6400, holes };
const blue: Course = { id: "vista-blue", name: "La Vista", teeName: "Azules", catalogCourseId: "vista", catalogTeeId: "blue", rating: 72.4, slope: 132, totalYards: 6900, holes };
const other: Course = { id: "other", name: "Otro", teeName: "Blancas", holes };
const players: Player[] = [{ id: "said", name: "Said", handicap: 8 }, { id: "juan", name: "Juan", handicap: 12 }];

test("tees por jugador conservan rating, slope y yardas en un snapshot", () => {
  const snapshot = teeAssignmentSnapshot("juan", blue, "2026-09-08T12:00:00.000Z");
  assert.deepEqual(snapshot, { playerId: "juan", courseId: "vista", layoutId: "vista", teeId: "blue", teeName: "Azules", rating: 72.4, slope: 132, yards: 6900, source: "catalog", capturedAt: "2026-09-08T12:00:00.000Z" });
  blue.rating = 99;
  assert.equal(snapshot.rating, 72.4);
});

test("todos igual y edición individual no alteran al resto", () => {
  const allWhite = assignTeeToEveryPlayer(players, white, "2026-09-08T12:00:00.000Z");
  const mixed = updatePlayerTeeAssignment(allWhite, "juan", blue, "2026-09-08T12:01:00.000Z");
  assert.equal(mixed.find((item) => item.playerId === "said")?.teeName, "Blancas");
  assert.equal(mixed.find((item) => item.playerId === "juan")?.teeName, "Azules");
  assert.deepEqual(teeOptionsForCourse(white, [white, blue, other]).map((course) => course.id), ["vista-white", "vista-blue"]);
});

test("draft legacy recibe tee compatible sin perder asignaciones existentes", () => {
  const restored = reconcilePlayerTeeAssignments([teeAssignmentSnapshot("juan", blue, "2026-09-08T12:00:00.000Z")], players, white, "2026-09-08T13:00:00.000Z");
  assert.equal(restored.find((item) => item.playerId === "juan")?.teeName, "Azules");
  assert.equal(restored.find((item) => item.playerId === "said")?.source, "legacy");
});
