import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import authorityJson from "../data/course-rating-authority-evidence.json";
import {
  RATING_EVIDENCE_SCHEMA_VERSION,
  capturedUnclassifiedRatingEvidence,
  isRatingEvidenceAutomaticallyApplicable,
  mergeCourseRatingEvidence,
  readCourseRatingEvidenceBundle,
  summarizeCourseRatingEvidence,
  type CourseRatingEvidence,
  type CourseRatingEvidenceBundleV1,
  type RatingEvidenceStatus,
} from "../lib/course-rating-evidence";
import { curatedPueblaCourseProvider } from "../lib/curated-puebla-course-data";
import { DEFAULT_LA_VISTA_COURSE, DEFAULT_LA_VISTA_TEMPORAL_COURSE } from "../lib/golf-course-directory";
import { reviewedTeeToCourse, type ReviewedCatalogCourse, type ReviewedTeeSource } from "../lib/review-course-catalog";

const gaps = JSON.parse(readFileSync("data/qa/course-gaps.json", "utf8")) as { summary: Record<string, number> };
const source = JSON.parse(readFileSync("data/qa/course-audit-source.json", "utf8")) as {
  clubs: Array<{ id: string }>;
  courses: Array<{ id: string }>;
  tees: Array<{ id: string; courseId: string; name: string }>;
};

type AuthorityRow = {
  courseId: string;
  teeId: string;
  teeName: string;
  ratingCategory: string | null;
  courseRating: number;
  slopeRating: number;
  par: number | null;
  totalYards: number | null;
  front: CourseRatingEvidence["front"];
  back: CourseRatingEvidence["back"];
  sourceAuthority: string;
  sourceUrl: string;
  evidenceStatus: RatingEvidenceStatus;
};

const authority = authorityJson as unknown as {
  schemaVersion: 1;
  evidenceVersion: string;
  observedAt: string;
  records: AuthorityRow[];
};
function record(row: AuthorityRow, ordinal: number): CourseRatingEvidence {
  return {
    ...structuredClone(row),
    evidenceId: `${authority.evidenceVersion}:${row.teeId}:${row.ratingCategory ?? "UNKNOWN"}:${ordinal}`,
    observedAt: authority.observedAt,
    evidenceVersion: authority.evidenceVersion,
    automaticUse: false,
  };
}

function captured(courseId = "course-a", teeId = "tee-a", teeName = "Ladies Red") {
  return capturedUnclassifiedRatingEvidence({
    evidenceId: `captured:${teeId}`,
    courseId,
    teeId,
    teeName,
    courseRating: 70.1,
    slopeRating: 125,
    par: 72,
    totalYards: 6100,
    front: { courseRating: 35.4, slopeRating: 124, par: 36 },
    back: { courseRating: 34.7, slopeRating: 126, par: 36 },
    sourceAuthority: "Historical GHIN capture (no live integration)",
    sourceUrl: "https://www.ghin.com/post-score/hole-by-hole/round-setup/1",
    observedAt: "2026-09-20",
    evidenceVersion: authority.evidenceVersion,
  });
}

function bundle(base = captured()): CourseRatingEvidenceBundleV1 {
  return { schemaVersion: RATING_EVIDENCE_SCHEMA_VERSION, courseId: base.courseId, teeId: base.teeId, teeName: base.teeName, records: [base] };
}

test("P05 never infers category from tee name, color-like words, yardage or captured values", () => {
  for (const teeName of ["Ladies", "Men", "Red", "Blue", "Damas", "Caballeros", "Gold"]) {
    const evidence = captured("course-a", `tee-${teeName}`, teeName);
    assert.equal(evidence.ratingCategory, null);
    assert.equal(evidence.evidenceStatus, "CAPTURED_UNCLASSIFIED");
    assert.equal(isRatingEvidenceAutomaticallyApplicable(evidence), false);
  }
});

test("P05 one physical tee preserves two official categories without duplicating tee identity", () => {
  const verdeRows = authority.records.filter((row) => row.courseId === "review-course-23244" && row.teeName === "VERDES");
  assert.deepEqual(verdeRows.map((row) => row.ratingCategory).sort(), ["F", "M"]);
  const merged = mergeCourseRatingEvidence(bundle(captured("review-course-23244", verdeRows[0].teeId, "VERDES")), verdeRows.map(record));
  assert.equal(merged.teeId, verdeRows[0].teeId);
  assert.equal(merged.records.length, 3);
  assert.deepEqual(merged.records.filter((row) => row.evidenceStatus === "OFFICIAL_VERIFIED").map((row) => row.ratingCategory).sort(), ["F", "M"]);
  assert.ok(merged.records.every((row) => row.automaticUse === false));
});

test("P05 evidence cannot cross course or tee boundaries and duplicate ids fail closed", () => {
  const base = bundle();
  assert.throws(() => mergeCourseRatingEvidence(base, [{ ...captured("course-b", "tee-a"), evidenceId: "wrong-course" }]), /BINDING_MISMATCH/);
  assert.throws(() => mergeCourseRatingEvidence(base, [{ ...captured("course-a", "tee-b"), evidenceId: "wrong-tee" }]), /BINDING_MISMATCH/);
  assert.equal(readCourseRatingEvidenceBundle(base, { courseId: "course-b", teeId: "tee-a" }), null);
  assert.equal(readCourseRatingEvidenceBundle({ ...base, records: [base.records[0], base.records[0]] }), null);
});

test("P05 front/back remain independent and are never reconstructed from the 18-hole value", () => {
  const mayakoba = authority.records.find((row) => row.courseId === "review-course-23244" && row.teeName === "AZULES" && row.ratingCategory === "M")!;
  assert.deepEqual(mayakoba.front, { courseRating: 36.4, slopeRating: 133, par: 36 });
  assert.deepEqual(mayakoba.back, { courseRating: 36.2, slopeRating: 132, par: 36 });
  assert.notEqual(mayakoba.front!.slopeRating, mayakoba.back!.slopeRating);
  assert.equal(mayakoba.courseRating, 72.6);
});

test("P05 conflict and unknown evidence stay non-applicable", () => {
  const elCristo = authority.records.filter((row) => row.courseId === "course-el-cristo");
  assert.equal(elCristo.filter((row) => row.evidenceStatus === "CLUB_PUBLISHED").length, 2);
  assert.equal(elCristo.filter((row) => row.evidenceStatus === "SOURCE_CONFLICT").length, 1);
  assert.ok(elCristo.every((row) => row.ratingCategory === null));
  assert.ok(elCristo.map(record).every((row) => !isRatingEvidenceAutomaticallyApplicable(row)));
});

test("P05 La Vista normal and temporary layouts cannot share a rating bundle", () => {
  assert.equal(DEFAULT_LA_VISTA_COURSE.holes.reduce((sum, hole) => sum + hole.par, 0), 72);
  assert.equal(DEFAULT_LA_VISTA_TEMPORAL_COURSE.holes.reduce((sum, hole) => sum + hole.par, 0), 69);
  assert.notEqual(DEFAULT_LA_VISTA_COURSE.catalogCourseId, DEFAULT_LA_VISTA_TEMPORAL_COURSE.catalogCourseId);
  const normal = bundle(captured(DEFAULT_LA_VISTA_COURSE.catalogCourseId!, DEFAULT_LA_VISTA_COURSE.catalogTeeId!, "Blancas"));
  assert.equal(readCourseRatingEvidenceBundle(normal, { courseId: DEFAULT_LA_VISTA_TEMPORAL_COURSE.catalogCourseId!, teeId: DEFAULT_LA_VISTA_TEMPORAL_COURSE.catalogTeeId! }), null);
  assert.equal(DEFAULT_LA_VISTA_TEMPORAL_COURSE.indexRatingEvidence, undefined);
});

test("P05 reviewed runtime preserves metadata but still hides category-unknown Rating/Slope", () => {
  const capturedRecord = captured("course-a", "tee-a", "Blue");
  const ratingEvidenceV1 = bundle(capturedRecord);
  const tee: ReviewedTeeSource = {
    id: "tee-a", name: "Blue", course_rating: 70.1, slope_rating: 125, yards: 6100, par: 72,
    rating_category: null, qa_status: "PASS", source_limitation: null,
    holes: Array.from({ length: 18 }, (_, index) => ({ hole_number: index + 1, par: 4, stroke_index: index + 1, yards: 300 })),
    nineRatings: [], qa: { status: "PASS", errors: [] }, ratingEvidenceV1,
  };
  const course: ReviewedCatalogCourse = {
    id: "course-a", clubId: "club-a", name: "A", clubName: "A", holes: 18, aliases: [], sourceUrl: "https://example.invalid/a",
    observedAt: "2026-09-20", dataVersion: "v1", tees: [tee],
  };
  const runtime = reviewedTeeToCourse(course, tee);
  assert.equal(runtime.rating, undefined);
  assert.equal(runtime.slope, undefined);
  assert.equal(runtime.catalogReview?.ratingEvidence?.records[0].evidenceStatus, "CAPTURED_UNCLASSIFIED");
  assert.equal(runtime.catalogReview?.ratingEvidence?.records[0].ratingCategory, null);
});

test("P05 El Cristo remains playable for scoring but category prudently blocks automatic index evidence", () => {
  for (const teeId of ["tee-el-cristo-azules", "tee-el-cristo-blancas"]) {
    const selection = curatedPueblaCourseProvider.getPlayableSelectionByTeeId(teeId);
    assert.ok(selection);
    assert.equal(selection.rating, undefined);
    assert.equal(selection.slope, undefined);
    assert.equal(selection.indexRatingEvidence, undefined);
    assert.equal(selection.catalogReview?.ratingEvidence?.records[0].evidenceStatus, "CLUB_PUBLISHED");
    assert.equal(selection.catalogReview?.ratingEvidence?.records[0].ratingCategory, null);
  }
  for (const teeId of ["tee-el-cristo-doradas", "tee-el-cristo-rojas"]) {
    assert.equal(curatedPueblaCourseProvider.getPlayableSelectionByTeeId(teeId), null);
    assert.ok(curatedPueblaCourseProvider.getTeeById(teeId)?.issues.includes("SOURCE_TOTAL_CONFLICT"));
  }
});

test("P05 authority diff is exact and prior P03/P04/catalog invariants remain unchanged", () => {
  const additions = authority.records.map(record);
  const official = additions.filter((row) => row.evidenceStatus === "OFFICIAL_VERIFIED");
  assert.equal(additions.length, 42);
  assert.equal(official.length, 39);
  assert.equal(new Set(official.map((row) => row.teeId)).size, 23);
  assert.equal(additions.filter((row) => row.evidenceStatus === "CLUB_PUBLISHED").length, 2);
  assert.equal(additions.filter((row) => row.evidenceStatus === "SOURCE_CONFLICT").length, 1);
  assert.ok(official.every((row) => ["M", "F"].includes(row.ratingCategory!)));
  const summary = summarizeCourseRatingEvidence([bundle(), mergeCourseRatingEvidence(bundle(captured("review-course-23244", "ghin:23244:tee:8a0a66f1d328", "VERDES")), official.filter((row) => row.teeId === "ghin:23244:tee:8a0a66f1d328"))]);
  assert.equal(summary.automaticallyApplicable, 0);
  assert.equal(gaps.summary.clubs, 153);
  assert.equal(gaps.summary.courses, 176);
  assert.equal(gaps.summary.tees, 769);
  assert.equal(gaps.summary.geolocated, 150);
  assert.equal(gaps.summary.complete, 758);
  assert.equal(gaps.summary.incomplete, 11);
  assert.equal(source.clubs.length, 153);
  assert.equal(source.courses.length, 176);
  assert.equal(source.tees.length, 769);
  assert.equal(new Set(source.tees.map((tee) => tee.id)).size, 769);
});
