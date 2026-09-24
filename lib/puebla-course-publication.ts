import { curatedPueblaCourseProvider } from "./curated-puebla-course-data";
import type { ReviewedCatalogCourse } from "./review-course-catalog";

const curatedByCourse = new Map(curatedPueblaCourseProvider.listCourses().map((course) => [course.courseId, course]));

/**
 * Reconciles a captured round layout with source-confirmed physical holes.
 * Conflicting cards remain in the QA source, but cannot become player cards.
 */
export function reviewedCoursePublicationShape(row: ReviewedCatalogCourse) {
  const curated = curatedByCourse.get(row.id);
  const holes = curated?.holesCount === 9 || curated?.holesCount === 18 ? curated.holesCount : row.holes;
  return {
    holes,
    tees: row.tees.filter((tee) => tee.holes.length === holes),
    sourceName: curated?.source.authority || "Catálogo revisado por owner",
    sourceUrl: curated?.source.url || row.sourceUrl,
    verifiedAt: curated?.source.verifiedAt || row.observedAt,
    capturedLayoutConflict: row.holes !== holes || row.tees.some((tee) => tee.holes.length !== holes),
  };
}
