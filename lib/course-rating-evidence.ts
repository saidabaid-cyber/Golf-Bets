export const RATING_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type RatingEvidenceStatus =
  | "OFFICIAL_VERIFIED"
  | "CLUB_PUBLISHED"
  | "CAPTURED_UNCLASSIFIED"
  | "SOURCE_CONFLICT"
  | "STALE_OR_UNCONFIRMED";

export type NineHoleRatingEvidence = {
  courseRating: number;
  slopeRating: number;
  par: number;
};

/**
 * A rating record is evidence about one physical tee. It is not the tee identity
 * itself and it is never selected for a player merely because it exists.
 */
export type CourseRatingEvidence = {
  evidenceId: string;
  courseId: string;
  teeId: string;
  teeName: string;
  ratingCategory: string | null;
  courseRating: number;
  slopeRating: number;
  par: number | null;
  totalYards: number | null;
  front: NineHoleRatingEvidence | null;
  back: NineHoleRatingEvidence | null;
  sourceAuthority: string;
  sourceUrl: string;
  observedAt: string;
  evidenceStatus: RatingEvidenceStatus;
  evidenceVersion: string;
  /** P05 classifies evidence only. A future player-category decision is required. */
  automaticUse: false;
};

export type CourseRatingEvidenceBundleV1 = {
  schemaVersion: typeof RATING_EVIDENCE_SCHEMA_VERSION;
  courseId: string;
  teeId: string;
  teeName: string;
  records: CourseRatingEvidence[];
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validNine(value: unknown): value is NineHoleRatingEvidence {
  if (value === null) return false;
  const row = object(value);
  return Boolean(
    row
      && finite(row.courseRating)
      && Number.isInteger(row.slopeRating)
      && finite(row.par),
  );
}

function validStatus(value: unknown): value is RatingEvidenceStatus {
  return [
    "OFFICIAL_VERIFIED",
    "CLUB_PUBLISHED",
    "CAPTURED_UNCLASSIFIED",
    "SOURCE_CONFLICT",
    "STALE_OR_UNCONFIRMED",
  ].includes(String(value));
}

function parseRecord(value: unknown): CourseRatingEvidence | null {
  const row = object(value);
  if (!row
    || typeof row.evidenceId !== "string"
    || typeof row.courseId !== "string"
    || typeof row.teeId !== "string"
    || typeof row.teeName !== "string"
    || !(row.ratingCategory === null || typeof row.ratingCategory === "string")
    || !finite(row.courseRating)
    || !Number.isInteger(row.slopeRating)
    || !(row.par === null || finite(row.par))
    || !(row.totalYards === null || finite(row.totalYards))
    || !(row.front === null || validNine(row.front))
    || !(row.back === null || validNine(row.back))
    || typeof row.sourceAuthority !== "string"
    || typeof row.sourceUrl !== "string"
    || typeof row.observedAt !== "string"
    || !validStatus(row.evidenceStatus)
    || typeof row.evidenceVersion !== "string"
    || row.automaticUse !== false) return null;
  return structuredClone(row) as CourseRatingEvidence;
}

/** Invalid or cross-bound metadata fails closed instead of becoming rating data. */
export function readCourseRatingEvidenceBundle(
  value: unknown,
  binding?: { courseId: string; teeId: string },
): CourseRatingEvidenceBundleV1 | null {
  const bundle = object(value);
  if (!bundle
    || bundle.schemaVersion !== RATING_EVIDENCE_SCHEMA_VERSION
    || typeof bundle.courseId !== "string"
    || typeof bundle.teeId !== "string"
    || typeof bundle.teeName !== "string"
    || !Array.isArray(bundle.records)) return null;
  if (binding && (bundle.courseId !== binding.courseId || bundle.teeId !== binding.teeId)) return null;
  const records = bundle.records.map(parseRecord);
  if (records.some((record) => record === null)) return null;
  const exact = records as CourseRatingEvidence[];
  if (exact.some((record) => record.courseId !== bundle.courseId || record.teeId !== bundle.teeId)) return null;
  if (new Set(exact.map((record) => record.evidenceId)).size !== exact.length) return null;
  return {
    schemaVersion: RATING_EVIDENCE_SCHEMA_VERSION,
    courseId: bundle.courseId,
    teeId: bundle.teeId,
    teeName: bundle.teeName,
    records: structuredClone(exact),
  };
}

export function capturedUnclassifiedRatingEvidence(input: Omit<CourseRatingEvidence,
  "ratingCategory" | "evidenceStatus" | "automaticUse">): CourseRatingEvidence {
  return {
    ...structuredClone(input),
    ratingCategory: null,
    evidenceStatus: "CAPTURED_UNCLASSIFIED",
    automaticUse: false,
  };
}

/**
 * Adds independently sourced records without collapsing categories. The caller
 * must already have matched the exact course and physical tee.
 */
export function mergeCourseRatingEvidence(
  bundle: CourseRatingEvidenceBundleV1,
  additions: readonly CourseRatingEvidence[],
): CourseRatingEvidenceBundleV1 {
  const next = structuredClone(bundle);
  const byId = new Map(next.records.map((record) => [record.evidenceId, record]));
  for (const addition of additions) {
    if (addition.courseId !== bundle.courseId || addition.teeId !== bundle.teeId) {
      throw new Error("RATING_EVIDENCE_TEE_BINDING_MISMATCH");
    }
    byId.set(addition.evidenceId, structuredClone(addition));
  }
  next.records = [...byId.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return next;
}

/** P05 never chooses a category for a player, even when authority is official. */
export function isRatingEvidenceAutomaticallyApplicable(evidence: CourseRatingEvidence) {
  void evidence;
  return false;
}

export function summarizeCourseRatingEvidence(bundles: readonly CourseRatingEvidenceBundleV1[]) {
  const records = bundles.flatMap((bundle) => bundle.records);
  const byStatus = Object.fromEntries(([
    "OFFICIAL_VERIFIED",
    "CLUB_PUBLISHED",
    "CAPTURED_UNCLASSIFIED",
    "SOURCE_CONFLICT",
    "STALE_OR_UNCONFIRMED",
  ] as const).map((status) => [status, records.filter((record) => record.evidenceStatus === status).length])) as Record<RatingEvidenceStatus, number>;
  return {
    physicalTees: bundles.length,
    evidenceRecords: records.length,
    categoryVerified: records.filter((record) => typeof record.ratingCategory === "string" && record.ratingCategory.trim()).length,
    categoryUnknown: records.filter((record) => record.ratingCategory === null).length,
    automaticallyApplicable: records.filter(isRatingEvidenceAutomaticallyApplicable).length,
    byStatus,
  };
}
