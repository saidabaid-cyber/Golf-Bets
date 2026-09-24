import { curatedPueblaCourseProvider } from "./curated-puebla-course-data";
import type { ReviewedCatalogCourse } from "./review-course-catalog";
import { publishableReviewedTee, reviewedPhysicalHoleCount } from "./reviewed-scorecard-publication";

const curatedByCourse = new Map(curatedPueblaCourseProvider.listCourses().map((course) => [course.courseId, course]));

/**
 * Reconciles a captured round layout with source-confirmed physical holes.
 * Conflicting cards remain in the QA source, but cannot become player cards.
 */
export function reviewedCoursePublicationShape(row: ReviewedCatalogCourse) {
  const curated = curatedByCourse.get(row.id);
  const curatedHoles = curated?.holesCount === 9 || curated?.holesCount === 18 ? curated.holesCount : row.holes;
  const holes = reviewedPhysicalHoleCount(row.id, curatedHoles);
  const tees = row.tees.flatMap((tee) => {
    const publishable = publishableReviewedTee(row.id, tee, holes);
    return publishable ? [publishable] : [];
  });
  return {
    holes,
    tees,
    sourceName: curated?.source.authority || "Catálogo revisado por owner",
    sourceUrl: curated?.source.url || row.sourceUrl,
    verifiedAt: curated?.source.verifiedAt || row.observedAt,
    capturedLayoutConflict: row.holes !== holes || row.tees.length !== tees.length || row.tees.some((tee) => tee.holes.length !== holes),
  };
}
