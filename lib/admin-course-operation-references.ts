type PhysicalHole = { id: string; course_id: string; hole_number: number; par: number };

/** Player projections may use display IDs. Operations must reference the
 * persisted holes of this exact physical layout, never create replacement IDs. */
export function physicalCourseOperationHoles(
  courseId: string,
  expectedCount: number,
  visible: readonly Record<string, unknown>[],
  physical: readonly PhysicalHole[],
): Record<string, unknown>[] {
  const unavailable = () => new Error("Este recorrido necesita sus hoyos físicos registrados antes de crear tarjetas o configuraciones.");
  if (![9, 18].includes(expectedCount) || visible.length !== expectedCount || physical.length !== expectedCount) throw unavailable();
  const byNumber = new Map<number, PhysicalHole>();
  const physicalIds = new Set<string>();
  for (const hole of physical) {
    if (hole.course_id !== courseId || !hole.id || physicalIds.has(hole.id) ||
      !Number.isInteger(hole.hole_number) || hole.hole_number < 1 || hole.hole_number > expectedCount || byNumber.has(hole.hole_number)) throw unavailable();
    byNumber.set(hole.hole_number, hole);
    physicalIds.add(hole.id);
  }
  const seen = new Set<number>();
  return visible.map(hole => {
    const number = Number(hole.holeNumber);
    const persisted = byNumber.get(number);
    if (!persisted || seen.has(number) || (hole.courseId && hole.courseId !== courseId)) throw unavailable();
    if (hole.par !== persisted.par) throw new Error("El par publicado no coincide con el recorrido físico. Revisa sus datos antes de crear otra versión.");
    seen.add(number);
    return { ...hole, id: persisted.id };
  });
}
