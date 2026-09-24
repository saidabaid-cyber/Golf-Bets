import assert from "node:assert/strict";
import test from "node:test";

import { nearestReviewedClubs, type ReviewedCatalogCourse, type ReviewedTeeSource } from "../lib/review-course-catalog";
import {
  incompleteScorecardCloseout,
  incompleteScorecardReview,
  publishableReviewedTee,
  reviewedPhysicalHoleCount,
  reviewedScorecardIssues,
} from "../lib/reviewed-scorecard-publication";

function holes(count: 9 | 18) {
  return Array.from({ length: count }, (_, index) => ({
    hole_number: index + 1,
    par: index % 5 === 0 ? 5 : index % 3 === 0 ? 3 : 4,
    stroke_index: index + 1,
    yards: 125 + index * 11,
  }));
}

function tee(id: string, courseId: string, count: 9 | 18 = 18): ReviewedTeeSource {
  const card = holes(count);
  return {
    id,
    name: "Blancas",
    course_rating: 72,
    slope_rating: 125,
    yards: card.reduce((sum, hole) => sum + hole.yards, 0),
    par: card.reduce((sum, hole) => sum + hole.par, 0),
    rating_category: null,
    qa_status: "PASS",
    source_limitation: null,
    holes: card,
    nineRatings: [],
    qa: { status: "PASS", errors: [] },
    supplement: {
      schemaVersion: 2,
      courseId,
      teeId: id,
      sourceUrl: "https://club.invalid/scorecard.pdf",
      authority: "Official club scorecard",
      observedAt: "2026-09-24",
      hash: "verified-card-hash",
      physicalHoles: count,
    },
    supplementOriginal: {
      id,
      name: "Blancas",
      course_rating: 72,
      slope_rating: 125,
      yards: null,
      par: null,
      rating_category: null,
      qa_status: "BLOCKED_EXTERNAL",
      source_limitation: "Original incomplete capture",
      holes: [],
      nineRatings: [],
      qa: { status: "BLOCKED_EXTERNAL", errors: ["HOLE_COUNT"] },
    },
  };
}

test("P04 read-only closeout covers the same six courses and eleven stable tee ids", () => {
  const review = incompleteScorecardCloseout();
  assert.equal(review.projectRef, "bymeopxkxapfizeeqeyb");
  assert.deepEqual(review.before, { clubs: 153, courses: 176, tees: 769, complete: 758, incomplete: 11 });
  assert.equal(review.courses.length, 6);
  const rows = review.courses.flatMap((course) => course.tees.map((row) => ({ courseId: course.courseId, ...row })));
  assert.equal(rows.length, 11);
  assert.equal(new Set(rows.map((row) => row.teeId)).size, 11);
  assert.ok(rows.every((row) => row.before === "INCOMPLETE" && row.after === "INCOMPLETE"));
  assert.ok(rows.every((row) => row.status !== "VERIFIED_COMPLETE"));
});

for (const [courseId, expectedTeeNames] of [
  ["review-course-23170", ["AZULES", "BLANCAS"]],
  ["review-course-23195", ["BLANCAS"]],
  ["review-course-31612", ["SILVER"]],
  ["review-course-32225", ["AZULES", "AMARILLAS", "BLANCAS"]],
  ["review-course-35498", ["DORADAS", "AZULES", "BLANCAS"]],
  ["review-course-36036", ["Azules / Blancas"]],
] as const) {
  test(`P04 ${courseId} remains blocked tee-by-tee without exact verified evidence`, () => {
    const closeout = incompleteScorecardCloseout();
    const course = closeout.courses.find((candidate) => candidate.courseId === courseId);
    assert.ok(course);
    assert.deepEqual(course.tees.map((row) => row.teeName), expectedTeeNames);
    for (const row of course.tees) {
      const lookup = incompleteScorecardReview(courseId, row.teeId);
      assert.ok(lookup);
      assert.notEqual(lookup.status, "VERIFIED_COMPLETE");
      assert.ok(lookup.reason.length > 20);
    }
  });
}

test("P04 rating/slope alone never turns an empty capture into a playable card", () => {
  const ratingOnly = tee("tee-rating-only", "course-a");
  ratingOnly.holes = [];
  ratingOnly.yards = null;
  ratingOnly.par = 72;
  ratingOnly.supplementOriginal = undefined;
  ratingOnly.supplement = undefined;
  assert.equal(publishableReviewedTee("course-a", ratingOnly, 18), null);
  assert.ok(reviewedScorecardIssues(ratingOnly, 18, "course-a").includes("HOLE_COUNT"));
});

test("P04 a versioned supplement is bound to the same course and tee", () => {
  const verified = tee("tee-a", "course-a");
  assert.ok(publishableReviewedTee("course-a", verified, 18));
  assert.equal(publishableReviewedTee("course-b", verified, 18), null);
  const wrongTee = structuredClone(verified);
  wrongTee.supplement!.teeId = "tee-b";
  assert.equal(publishableReviewedTee("course-a", wrongTee, 18), null);
});

test("P04 contradictory Par, SI or yard totals keep a candidate blocked", () => {
  const conflicting = tee("tee-conflict", "course-a");
  conflicting.holes[0].stroke_index = 2;
  conflicting.holes[1].yards = Number(conflicting.holes[1].yards) + 10;
  const issues = reviewedScorecardIssues(conflicting, 18, "course-a");
  assert.ok(issues.includes("STROKE_INDEX_SET"));
  assert.ok(issues.includes("YARDS_TOTAL"));
  assert.equal(publishableReviewedTee("course-a", conflicting, 18), null);
});

test("P04 a source-declared physical nine projects one loop without inventing holes", () => {
  const firstLoop = holes(9);
  const repeated = firstLoop.map((hole) => ({ ...hole, hole_number: hole.hole_number + 9, stroke_index: hole.stroke_index + 9 }));
  const captured = tee("alquerias-blue", "review-course-36036");
  captured.holes = [...firstLoop, ...repeated];
  captured.par = captured.holes.reduce((sum, hole) => sum + hole.par, 0);
  captured.yards = captured.holes.reduce((sum, hole) => sum + Number(hole.yards), 0);
  captured.supplement!.physicalHoles = 9;
  const original = structuredClone(captured);
  const published = publishableReviewedTee("review-course-36036", captured, 9);
  assert.ok(published);
  assert.deepEqual(published.holes.map((hole) => hole.hole_number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(published.par, firstLoop.reduce((sum, hole) => sum + hole.par, 0));
  assert.deepEqual(captured, original, "projection must not rewrite captured/source evidence");
});

test("P04 removing a supplement fails closed and leaves a historical snapshot frozen", () => {
  const current = tee("tee-a", "course-a");
  const published = publishableReviewedTee("course-a", current, 18);
  assert.ok(published);
  const historical = structuredClone({ teeId: current.id, holes: published.holes });
  current.supplement = undefined;
  current.holes[0].yards = 999;
  assert.equal(publishableReviewedTee("course-a", current, 18), null);
  assert.notEqual(current.holes[0].yards, historical.holes[0].yards);
  assert.equal(historical.teeId, "tee-a");
});

test("P04 physical-hole evidence corrects only the three known nine-hole identities", () => {
  assert.equal(reviewedPhysicalHoleCount("review-course-32225", 18), 9);
  assert.equal(reviewedPhysicalHoleCount("review-course-35498", 18), 9);
  assert.equal(reviewedPhysicalHoleCount("review-course-36036", 18), 9);
  assert.equal(reviewedPhysicalHoleCount("review-course-23170", 18), 18);
  assert.equal(reviewedPhysicalHoleCount("unknown-course", 18), 18);
});

test("P04 Puebla and P03 nearby behavior remains distance-derived and club-distinct", () => {
  const courses: Array<Omit<ReviewedCatalogCourse, "tees">> = [
    { id: "course-la-vista", clubId: "club-la-vista", name: "La Vista", clubName: "La Vista", holes: 18, aliases: [], latitude: 19.008297, longitude: -98.254634, locationEvidence: { sourceUrl: "https://club.invalid", verifiedAt: "2026-09-24" }, sourceUrl: "https://club.invalid", observedAt: "2026-09-24", dataVersion: "p04" },
    { id: "course-la-vista-b", clubId: "club-la-vista", name: "La Vista II", clubName: "La Vista", holes: 18, aliases: [], latitude: 19.008297, longitude: -98.254634, locationEvidence: { sourceUrl: "https://club.invalid", verifiedAt: "2026-09-24" }, sourceUrl: "https://club.invalid", observedAt: "2026-09-24", dataVersion: "p04" },
    { id: "course-campestre", clubId: "club-campestre", name: "Campestre", clubName: "Campestre Puebla", holes: 18, aliases: [], latitude: 19.0131, longitude: -98.2345, locationEvidence: { sourceUrl: "https://club.invalid", verifiedAt: "2026-09-24" }, sourceUrl: "https://club.invalid", observedAt: "2026-09-24", dataVersion: "p04" },
    { id: "course-fuentes", clubId: "club-fuentes", name: "Las Fuentes", clubName: "Las Fuentes", holes: 18, aliases: [], latitude: 19.08806, longitude: -98.23316, locationEvidence: { sourceUrl: "https://club.invalid", verifiedAt: "2026-09-24" }, sourceUrl: "https://club.invalid", observedAt: "2026-09-24", dataVersion: "p04" },
  ];
  const nearby = nearestReviewedClubs(courses, { latitude: 19.008297, longitude: -98.254634 });
  assert.deepEqual(nearby.map((course) => course.clubId), ["club-la-vista", "club-campestre", "club-fuentes"]);
});
