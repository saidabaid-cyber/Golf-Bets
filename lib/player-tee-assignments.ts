import type { Course, Player, PlayerTeeAssignmentSnapshot } from "./types";
import { getCuratedIndexRatedTeeEvidenceForCourse } from "./curated-puebla-course-data";

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
  const par = (course.holes.length === 9 || course.holes.length === 18)
    && course.holes.every((hole) => Number.isInteger(hole.par) && hole.par >= 3 && hole.par <= 6)
    ? course.holes.reduce((total, hole) => total + hole.par, 0)
    : null;
  const indexRatingEvidence = source === "catalog" ? getCuratedIndexRatedTeeEvidenceForCourse(course) : null;
  return {
    playerId,
    ...(course.catalogReview ? {holes:structuredClone(course.holes),catalogReview:structuredClone(course.catalogReview)} : {}),
    courseId: course.catalogCourseId || course.id,
    ...(course.catalogCourseId ? { layoutId: course.catalogCourseId } : {}),
    teeId: course.catalogTeeId || course.id,
    teeName: course.teeName,
    ...(typeof course.rating === "number" ? { rating: course.rating } : {}),
    ...(typeof course.slope === "number" ? { slope: course.slope } : {}),
    ...(typeof course.totalYards === "number" ? { yards: course.totalYards } : {}),
    ...(par !== null ? { par } : {}),
    source,
    capturedAt,
    ...(course.sourceAuthority ? { sourceAuthority: course.sourceAuthority } : {}),
    ...(course.sourceUrl ? { sourceUrl: course.sourceUrl } : {}),
    ...(course.verifiedAt ? { verifiedAt: course.verifiedAt } : {}),
    ...(course.dataVersion ? { dataVersion: course.dataVersion } : {}),
    ...(indexRatingEvidence ? { indexRatingEvidence: { ...indexRatingEvidence } } : {}),
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
  options: { allowCuratedNewAssignment?: boolean } = {},
) {
  const courseId = course.catalogCourseId || course.id;
  const byPlayerId = new Map<string, PlayerTeeAssignmentSnapshot>();
  for (const assignment of assignments || []) {
    if (!assignment || typeof assignment.playerId !== "string" || typeof assignment.teeName !== "string") continue;
    if (assignment.courseId !== courseId && assignment.layoutId !== courseId) continue;
    byPlayerId.set(assignment.playerId, {
      ...assignment,
      ...(assignment.indexRatingEvidence ? { indexRatingEvidence: { ...assignment.indexRatingEvidence } } : {}),
    });
  }
  const missingSource = course.catalogReview || (options.allowCuratedNewAssignment && getCuratedIndexRatedTeeEvidenceForCourse(course)) ? "catalog" : "legacy";
  return players.map((player) => byPlayerId.get(player.id) || teeAssignmentSnapshot(player.id, course, capturedAt, missingSource));
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
