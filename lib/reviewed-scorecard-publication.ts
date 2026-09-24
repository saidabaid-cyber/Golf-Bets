import incompleteCloseout from "../data/course-card-incomplete-closeout.json";
import type { ReviewedTeeSource } from "./review-course-catalog";

type CloseoutCourse = {
  courseId: string;
  physicalHoles: 9 | 18 | null;
  operationStatus: string;
  tees: Array<{
    teeId: string;
    teeName: string;
    status: "VERIFIED_COMPLETE" | "STILL_INCOMPLETE" | "SOURCE_CONFLICT" | "OPERATION_UNCONFIRMED" | "BLOCKED_EXTERNAL";
    reason: string;
  }>;
};

export type ReviewedScorecardIssue =
  | "HOLE_COUNT"
  | "HOLE_NUMBER_SET"
  | "PAR_SET"
  | "STROKE_INDEX_SET"
  | "YARDS_SET"
  | "PAR_TOTAL"
  | "YARDS_TOTAL"
  | "SUPPLEMENT_MISSING"
  | "SUPPLEMENT_COURSE_MISMATCH"
  | "SUPPLEMENT_TEE_MISMATCH"
  | "ROUND_LAYOUT_CONFLICT";

const closeoutCourses = incompleteCloseout.courses as CloseoutCourse[];
const closeoutByCourse = new Map(closeoutCourses.map((course) => [course.courseId, course]));

export function incompleteScorecardCloseout() {
  return structuredClone(incompleteCloseout);
}

export function reviewedPhysicalHoleCount(courseId: string, captured: 9 | 18): 9 | 18 {
  return closeoutByCourse.get(courseId)?.physicalHoles ?? captured;
}

function exactIntegers(values: readonly number[], expected: readonly number[]) {
  return values.length === expected.length
    && values.every(Number.isInteger)
    && [...values].sort((left, right) => left - right).every((value, index) => value === expected[index]);
}

export function reviewedScorecardIssues(tee: ReviewedTeeSource, physicalHoles: 9 | 18, courseId?: string): ReviewedScorecardIssue[] {
  const issues = new Set<ReviewedScorecardIssue>();
  const supplement = tee.supplement;
  if (tee.supplementOriginal && !supplement) issues.add("SUPPLEMENT_MISSING");
  if (supplement?.schemaVersion === 2) {
    if (courseId && supplement.courseId !== courseId) issues.add("SUPPLEMENT_COURSE_MISMATCH");
    if (supplement.teeId !== tee.id) issues.add("SUPPLEMENT_TEE_MISMATCH");
  }
  if (tee.holes.length !== physicalHoles) issues.add("HOLE_COUNT");
  const expectedHoles = Array.from({ length: physicalHoles }, (_, index) => index + 1);
  if (!exactIntegers(tee.holes.map((hole) => hole.hole_number), expectedHoles)) issues.add("HOLE_NUMBER_SET");
  if (tee.holes.some((hole) => !Number.isInteger(hole.par) || hole.par < 2 || hole.par > 6)) issues.add("PAR_SET");
  if (tee.holes.some((hole) => !Number.isInteger(hole.yards) || Number(hole.yards) <= 0)) issues.add("YARDS_SET");
  const strokeIndexes = tee.holes.map((hole) => hole.stroke_index);
  if (physicalHoles === 18) {
    if (!exactIntegers(strokeIndexes, expectedHoles)) issues.add("STROKE_INDEX_SET");
  } else if (strokeIndexes.length !== 9 || new Set(strokeIndexes).size !== 9 || strokeIndexes.some((value) => !Number.isInteger(value) || value < 1 || value > 18)) {
    // A physical nine can legitimately retain the source's odd/even 18-hole allocation.
    issues.add("STROKE_INDEX_SET");
  }
  const parTotal = tee.holes.reduce((sum, hole) => sum + hole.par, 0);
  const yardsTotal = tee.holes.reduce((sum, hole) => sum + Number(hole.yards || 0), 0);
  if (tee.par !== null && tee.par !== parTotal) issues.add("PAR_TOTAL");
  if (tee.yards !== null && tee.yards !== yardsTotal) issues.add("YARDS_TOTAL");
  return [...issues];
}

function physicalNineFromExplicitRoundLayout(tee: ReviewedTeeSource): ReviewedTeeSource | null {
  if (tee.holes.length !== 18 || tee.supplement?.physicalHoles !== 9) return null;
  const first = tee.holes.slice(0, 9);
  const second = tee.holes.slice(9);
  const samePhysicalCard = first.every((hole, index) => {
    const replay = second[index];
    return replay?.hole_number === hole.hole_number + 9 && replay.par === hole.par && replay.yards === hole.yards;
  });
  if (!samePhysicalCard) return null;
  return {
    ...tee,
    holes: first.map((hole) => ({ ...hole })),
    par: first.reduce((sum, hole) => sum + hole.par, 0),
    yards: first.reduce((sum, hole) => sum + Number(hole.yards || 0), 0),
  };
}

export function publishableReviewedTee(courseId: string, tee: ReviewedTeeSource, physicalHoles: 9 | 18): ReviewedTeeSource | null {
  let candidate = tee;
  if (physicalHoles === 9 && tee.holes.length === 18) {
    const projected = physicalNineFromExplicitRoundLayout(tee);
    if (!projected) return null;
    candidate = projected;
  }
  return reviewedScorecardIssues(candidate, physicalHoles, courseId).length ? null : candidate;
}

export function incompleteScorecardReview(courseId: string, teeId: string) {
  const course = closeoutByCourse.get(courseId);
  const tee = course?.tees.find((candidate) => candidate.teeId === teeId);
  return tee ? { operationStatus: course!.operationStatus, physicalHoles: course!.physicalHoles, ...tee } : null;
}
