import type { Course, Player, PlayerTeeAssignmentSnapshot } from "./types";

function sameLayout(first: Course, second: Course) {
  if (first.catalogCourseId && second.catalogCourseId) return first.catalogCourseId === second.catalogCourseId;
  return first.name.trim().toLocaleLowerCase("es-MX") === second.name.trim().toLocaleLowerCase("es-MX");
}

export function teeOptionsForCourse(course: Course, courses: readonly Course[]) {
  return courses.filter((candidate) => sameLayout(course, candidate));
}

export function teeAssignmentSnapshot(
  playerId: string,
  course: Course,
  capturedAt: string,
  source: PlayerTeeAssignmentSnapshot["source"] = course.catalogTeeId ? "catalog" : "manual",
): PlayerTeeAssignmentSnapshot {
  return {
    playerId,
    courseId: course.catalogCourseId || course.id,
    ...(course.catalogCourseId ? { layoutId: course.catalogCourseId } : {}),
    teeId: course.catalogTeeId || course.id,
    teeName: course.teeName,
    ...(typeof course.rating === "number" ? { rating: course.rating } : {}),
    ...(typeof course.slope === "number" ? { slope: course.slope } : {}),
    ...(typeof course.totalYards === "number" ? { yards: course.totalYards } : {}),
    source,
    capturedAt,
  };
}

export function assignTeeToEveryPlayer(players: readonly Player[], course: Course, capturedAt: string) {
  return players.map((player) => teeAssignmentSnapshot(player.id, course, capturedAt));
}

export function reconcilePlayerTeeAssignments(
  assignments: readonly PlayerTeeAssignmentSnapshot[] | null | undefined,
  players: readonly Player[],
  course: Course,
  capturedAt: string,
) {
  const options = new Map<string, PlayerTeeAssignmentSnapshot>();
  for (const assignment of assignments || []) {
    if (!assignment || typeof assignment.playerId !== "string" || typeof assignment.teeName !== "string") continue;
    options.set(assignment.playerId, { ...assignment });
  }
  return players.map((player) => options.get(player.id) || teeAssignmentSnapshot(player.id, course, capturedAt, "legacy"));
}

export function updatePlayerTeeAssignment(
  assignments: readonly PlayerTeeAssignmentSnapshot[],
  playerId: string,
  course: Course,
  capturedAt: string,
) {
  const next = teeAssignmentSnapshot(playerId, course, capturedAt);
  return [...assignments.filter((assignment) => assignment.playerId !== playerId), next];
}

export function missingPlayerTeeAssignments(assignments: readonly PlayerTeeAssignmentSnapshot[], players: readonly Player[]) {
  const assigned = new Set(assignments.filter((item) => item.teeId && item.teeName).map((item) => item.playerId));
  return players.filter((player) => !assigned.has(player.id));
}
