export type NearbyCourseCard = {
  id: string;
  courseId: string;
  clubId?: string;
};

export type NearbyCourseCardMatch<T extends NearbyCourseCard> = {
  card: T;
  distanceKm: number | null;
};

/** Nearby is a club discovery surface; layouts are resolved after the club. */
export function distinctNearbyClubCards<T extends NearbyCourseCard>(
  matches: readonly NearbyCourseCardMatch<T>[],
  options: { radiusKm?: number; limit?: number } = {},
) {
  const radiusKm = options.radiusKm ?? 50;
  const limit = options.limit ?? 3;
  const distinct = new Map<string, NearbyCourseCardMatch<T>>();

  for (const match of [...matches].sort((left, right) => (
    (left.distanceKm ?? Number.MAX_VALUE) - (right.distanceKm ?? Number.MAX_VALUE)
  ))) {
    if (match.distanceKm === null || match.distanceKm > radiusKm) continue;
    const identity = match.card.clubId || `course:${match.card.courseId || match.card.id}`;
    if (!distinct.has(identity)) distinct.set(identity, match);
  }

  const all = [...distinct.values()];
  return { total: all.length, matches: all.slice(0, Math.max(0, limit)) };
}
