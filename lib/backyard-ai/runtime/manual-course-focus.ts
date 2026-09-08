import type { Course } from "../../types";
import type { RoundSetupCourseIdentity } from "../schemas/round-setup";

function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es-MX");
}

export function normalizeRoundSetupCourseIdentity(value: unknown): RoundSetupCourseIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) return null;
  const candidateCourseIds = Array.isArray(source.candidateCourseIds)
    ? [...new Set(source.candidateCourseIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()))]
    : [];
  const catalogCourseId = typeof source.catalogCourseId === "string" && source.catalogCourseId.trim()
    ? source.catalogCourseId.trim()
    : undefined;
  return { name, ...(catalogCourseId ? { catalogCourseId } : {}), candidateCourseIds };
}

/** Returns only real tee records from the current local course catalog. Explicit
 * candidate ids remain authoritative; catalog/name matching is a recovery path
 * for an imported draft whose local tee ids changed. */
export function coursesForPendingIdentity(courses: readonly Course[], value: unknown) {
  const identity = normalizeRoundSetupCourseIdentity(value);
  if (!identity) return [];
  const candidateIds = new Set(identity.candidateCourseIds);
  const explicit = courses.filter((course) => candidateIds.has(course.id));
  if (explicit.length) return explicit;
  if (identity.catalogCourseId) {
    const sameCatalogCourse = courses.filter((course) => course.catalogCourseId === identity.catalogCourseId);
    if (sameCatalogCourse.length) return sameCatalogCourse;
  }
  const name = normalizedName(identity.name);
  return courses.filter((course) => normalizedName(course.name) === name || normalizedName(course.clubName || "") === name);
}

export type ManualRoundCourseState = {
  course: Course;
  courseSelected: boolean;
  pendingIdentity: RoundSetupCourseIdentity | null;
  candidates: Course[];
};

/** Bridges an incomplete AI draft into the existing manual setup. A candidate
 * becomes the non-visible backing course so an unrelated prior course cannot
 * leak into later calculations. A tee is selected automatically only when the
 * current catalog contains exactly one matching real tee. */
export function resolveManualRoundCourseState(input: {
  currentCourse: Course;
  availableCourses: readonly Course[];
  draftCourse: Course | null;
  draftCourseSelected: boolean;
  courseIdentity?: unknown;
}): ManualRoundCourseState {
  if (input.draftCourseSelected && input.draftCourse) {
    return { course: input.draftCourse, courseSelected: true, pendingIdentity: null, candidates: [] };
  }
  const pendingIdentity = normalizeRoundSetupCourseIdentity(input.courseIdentity);
  const candidates = coursesForPendingIdentity(input.availableCourses, pendingIdentity);
  if (candidates.length === 1) {
    return { course: candidates[0], courseSelected: true, pendingIdentity: null, candidates };
  }
  return {
    course: candidates[0] ?? input.currentCourse,
    courseSelected: false,
    pendingIdentity,
    candidates,
  };
}
