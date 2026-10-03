import type { Course } from "./types";

export type SavedCourseSearchResult = {
  id: string;
  courseId: string;
  name: string;
  clubName?: string;
  city?: string;
  localIndexTeeAvailable: boolean;
  tee: { id: string; name: string; rating?: number; slope?: number; yards?: number; localIndexRated: boolean };
};

const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").trim();

/** The caller supplies only the current account's local/cloud course collection.
 * Private cards need not have an identity in the global course catalog. */
export function searchSavedCourses(courses: readonly Course[], query: string, limit = 12): SavedCourseSearchResult[] {
  const normalized = searchKey(query);
  if (normalized.length < 2) return [];
  const results = new Map<string, SavedCourseSearchResult>();
  for (const course of courses) {
    if (!searchKey([course.name, course.clubName, course.city].filter(Boolean).join(" ")).includes(normalized)) continue;
    const courseId = course.catalogCourseId || course.id;
    if (results.has(courseId)) continue;
    const rated = course.indexRatingEvidence?.kind === "CURATED_RATED_TEE";
    results.set(courseId, {
      id: course.id, courseId, name: course.name, clubName: course.clubName, city: course.city,
      localIndexTeeAvailable: rated,
      tee: { id: course.catalogTeeId || course.id, name: course.teeName,
        rating: course.rating, slope: course.slope, yards: course.totalYards, localIndexRated: rated },
    });
    if (results.size >= limit) break;
  }
  return [...results.values()];
}
