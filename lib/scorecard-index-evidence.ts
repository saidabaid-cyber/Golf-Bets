import type { GolfCourse, GolfCourseTee, GolfScorecardProfile, GolfScorecardProfileTee } from "./golf-course-directory";
import type { BackyardIndexRatedTeeEvidence, Course } from "./types";

function validRating(rating: unknown, slope: unknown) {
  return typeof rating === "number" && Number.isFinite(rating) && rating >= 40 && rating <= 100
    && typeof slope === "number" && Number.isInteger(slope) && slope >= 55 && slope <= 155;
}

function https(value: unknown): value is string {
  try { return typeof value === "string" && new URL(value).protocol === "https:"; } catch { return false; }
}

function ratedProvenance(provenance: string | undefined) {
  return provenance === "GHIN_OFFICIAL" || provenance === "USGA_OFFICIAL" ? "OFFICIAL_RATED_TEE"
    : provenance === "CLUB_SCORECARD_VERIFIED" ? "CURATED_RATED_TEE" : null;
}

/** Called by the canonical catalog mapper after an explicit profile/category
 * selection. Category-unknown captured ratings and operational cards stay out. */
export function scorecardProfileIndexEvidence(
  course: GolfCourse,
  tee: GolfCourseTee,
  profile: GolfScorecardProfile | undefined,
  profileTee: GolfScorecardProfileTee | undefined,
  selectedCategory: string | undefined,
): BackyardIndexRatedTeeEvidence | null {
  const kind = ratedProvenance(profile?.provenance);
  if (!kind || !profile || !profileTee || !profile.active || profile.historical || profile.status !== "PUBLISHED"
    || course.isProvisional || course.holes !== 18 || profile.courseId !== course.id || tee.courseId !== course.id
    || profileTee.teeId !== tee.id || !["MEN", "WOMEN"].includes(selectedCategory || "")
    || profileTee.ratingGender !== selectedCategory || !validRating(profileTee.courseRating, profileTee.slopeRating)
    || !profile.sourceProvider.trim() || !https(course.sourceUrl) || !profile.verifiedAt
    || !Number.isFinite(Date.parse(profile.verifiedAt))) return null;
  const now = Date.now();
  if ((profile.effectiveFrom && (!Number.isFinite(Date.parse(profile.effectiveFrom)) || Date.parse(profile.effectiveFrom) > now))
    || (profile.effectiveTo && (!Number.isFinite(Date.parse(profile.effectiveTo)) || Date.parse(profile.effectiveTo) < now))) return null;
  return {
    kind, authority: `${profile.sourceProvider} · ${profile.name}`, sourceUrl: course.sourceUrl,
    verifiedAt: profile.verifiedAt, courseId: course.id, teeId: tee.id,
    courseRating: profileTee.courseRating!, slopeRating: profileTee.slopeRating!,
    scorecardProfileId: profile.id, ratingGender: selectedCategory as "MEN" | "WOMEN",
  };
}

/** Preserve the selected, already mapped evidence only while its complete
 * binding still matches. This never re-resolves a historical tee or category. */
export function indexEvidenceForProfileSelection(course: Course): BackyardIndexRatedTeeEvidence | null {
  const evidence = course.indexRatingEvidence;
  if (!evidence || !course.scorecardProfileId || course.scorecardProfileHistorical
    || evidence.kind !== ratedProvenance(course.scorecardProfileProvenance)
    || evidence.scorecardProfileId !== course.scorecardProfileId
    || !["MEN", "WOMEN"].includes(evidence.ratingGender || "")
    || !course.roundTeeSelectionId?.endsWith(`::${course.scorecardProfileId}::${evidence.ratingGender}`)
    || evidence.courseId !== course.catalogCourseId || evidence.teeId !== course.catalogTeeId
    || evidence.courseRating !== course.rating || evidence.slopeRating !== course.slope
    || !validRating(course.rating, course.slope) || !evidence.authority.trim()
    || evidence.verifiedAt !== course.scorecardProfileVerifiedAt || !Number.isFinite(Date.parse(evidence.verifiedAt))
    || evidence.sourceUrl !== course.sourceUrl || !https(evidence.sourceUrl)) return null;
  return structuredClone(evidence);
}
