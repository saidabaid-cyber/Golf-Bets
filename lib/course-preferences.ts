export const COURSE_PREFERENCE_KEYS = {
  favorites: "golfbets-course-favorites-v1",
  recents: "golfbets-course-recents-v1",
} as const;

export function coursePreferenceStorageKey(kind: keyof typeof COURSE_PREFERENCE_KEYS, identityId: string) {
  return `${COURSE_PREFERENCE_KEYS[kind]}:${identityId || "guest"}`;
}

export function normalizeCourseIds(value: unknown, availableIds?: Iterable<string>) {
  if (!Array.isArray(value)) return [];
  const available = availableIds ? new Set(availableIds) : null;
  const seen = new Set<string>();
  return value.filter((candidate): candidate is string => {
    if (typeof candidate !== "string" || !candidate.trim() || seen.has(candidate)) return false;
    if (available && !available.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

export function toggleFavoriteCourse(ids: string[], courseId: string) {
  return ids.includes(courseId) ? ids.filter((id) => id !== courseId) : [courseId, ...ids];
}

export function rememberRecentCourse(ids: string[], courseId: string, limit = 6) {
  if (!courseId || limit <= 0) return [];
  return [courseId, ...ids.filter((id) => id !== courseId)].slice(0, limit);
}
