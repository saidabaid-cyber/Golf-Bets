import type { Course, PlayerTeeAssignmentSnapshot } from './types';

export function holesForPlayer(course: Course, playerId: string) {
  return course.playerHoleCards?.[playerId] ?? course.holes;
}
export function holeForPlayer(course: Course, playerId: string, number: number) {
  return holesForPlayer(course, playerId).find(hole => hole.number === number);
}
/** Materialize selected cards into the existing immutable round course snapshot.
 * No live catalog lookups at game/history time. Preserve legacy behavior. */
export function withPlayerCourseCards(course: Course, assignments: readonly PlayerTeeAssignmentSnapshot[]): Course {
  const cards = Object.fromEntries(assignments.filter(a => a.courseId === (course.catalogCourseId || course.id) && a.holes?.length === 18)
    .map(a => [a.playerId, a.holes!]));
  if (JSON.stringify(cards) === JSON.stringify(course.playerHoleCards ?? {})) return course;
  return { ...course, playerHoleCards: structuredClone(cards) };
}
