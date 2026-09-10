import type { GolfCourseCatalog, GolfCourseTee } from "../../lib/golf-course-directory";

export type TeePreferenceSource = "PLAYER_COURSE" | "LAST_USED" | "GROUP_DEFAULT" | "SUGGESTED" | "UNRESOLVED";

export type TeePreferenceCandidate = {
  teeId: string;
  source: Exclude<TeePreferenceSource, "UNRESOLVED">;
  usedAt?: string;
};

export type ResolvedPlayerTee = {
  playerId: string;
  courseId: string;
  tee: GolfCourseTee | null;
  source: TeePreferenceSource;
  needsConfirmation: boolean;
};

function activeTee(catalog: GolfCourseCatalog, courseId: string, teeId: string | undefined) {
  if (!teeId) return null;
  return catalog.tees.find((tee) => tee.active && tee.courseId === courseId && tee.id === teeId) ?? null;
}

/**
 * Resolves a tee without conflating Course and Tee. A suggestion remains
 * reviewable; an unresolved result never blocks score-only play by itself.
 */
export function resolvePlayerTee(input: {
  catalog: GolfCourseCatalog;
  playerId: string;
  courseId: string;
  playerCourseTeeId?: string;
  lastUsedTeeId?: string;
  groupDefaultTeeId?: string;
  suggestedTeeId?: string;
}): ResolvedPlayerTee {
  const candidates: TeePreferenceCandidate[] = [
    { teeId: input.playerCourseTeeId ?? "", source: "PLAYER_COURSE" },
    { teeId: input.lastUsedTeeId ?? "", source: "LAST_USED" },
    { teeId: input.groupDefaultTeeId ?? "", source: "GROUP_DEFAULT" },
    { teeId: input.suggestedTeeId ?? "", source: "SUGGESTED" },
  ];
  for (const candidate of candidates) {
    const tee = activeTee(input.catalog, input.courseId, candidate.teeId);
    if (tee) return { playerId: input.playerId, courseId: input.courseId, tee, source: candidate.source, needsConfirmation: candidate.source === "SUGGESTED" };
  }
  return { playerId: input.playerId, courseId: input.courseId, tee: null, source: "UNRESOLVED", needsConfirmation: true };
}

export type CourseSearchPage<T> = {
  items: T[];
  total: number;
  nextCursor?: string;
};

export function paginateStable<T extends { id: string }>(rows: readonly T[], cursor: string | undefined, requestedLimit = 20): CourseSearchPage<T> {
  const limit = Math.max(1, Math.min(50, Math.trunc(requestedLimit) || 20));
  const start = cursor ? Math.max(0, rows.findIndex((row) => row.id === cursor) + 1) : 0;
  const items = rows.slice(start, start + limit);
  const hasMore = start + items.length < rows.length;
  return { items: [...items], total: rows.length, ...(hasMore && items.length ? { nextCursor: items[items.length - 1].id } : {}) };
}
