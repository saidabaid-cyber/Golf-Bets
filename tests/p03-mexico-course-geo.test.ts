import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { courseGeoCoverage, mergeMexicoCourseLocations, validateMexicoCourseLocationEvidence, type CourseAuditSource, type CourseLocationEvidenceSet } from "../lib/mexico-course-geo";
import { nearestReviewedClubs, type ReviewedCatalogCourse } from "../lib/review-course-catalog";

const source = JSON.parse(readFileSync("data/qa/course-audit-source.json", "utf8")) as Omit<CourseAuditSource, "courses" | "tees"> & {
  courses: Array<{ id: string; clubId: string; name: string; sourceUrl: string; dataVersion: string }>;
  tees: Array<{ id: string; courseId: string; holeCount: 9 | 18 }>;
};
const evidence = JSON.parse(readFileSync("data/qa/mexico-course-location-evidence.json", "utf8")) as CourseLocationEvidenceSet;
const evidenceIds = new Set(evidence.verifiedLocations.map((row) => row.clubId));
const before = structuredClone(source);
for (const club of before.clubs) {
  if (!evidenceIds.has(club.id)) continue;
  club.latitude = null;
  club.longitude = null;
  club.locationEvidence = null;
}
const merged = mergeMexicoCourseLocations(before, evidence) as typeof source;

function nearbyRows(): ReviewedCatalogCourse[] {
  const firstCourseByClub = new Map<string, typeof source.courses[number]>();
  for (const course of merged.courses) if (!firstCourseByClub.has(course.clubId)) firstCourseByClub.set(course.clubId, course);
  return merged.clubs.flatMap((club): ReviewedCatalogCourse[] => {
    const course = firstCourseByClub.get(club.id);
    if (!course) return [];
    return [{
      id: course.id,
      clubId: club.id,
      name: course.name,
      clubName: club.name,
      holes: 18,
      aliases: [],
      ...(club.latitude === null ? {} : { latitude: club.latitude }),
      ...(club.longitude === null ? {} : { longitude: club.longitude }),
      ...(club.locationEvidence === null ? {} : { locationEvidence: { sourceUrl: String(club.locationEvidence.sourceUrl), verifiedAt: String(club.locationEvidence.verifiedAt) } }),
      sourceUrl: course.sourceUrl,
      observedAt: "2026-09-24",
      dataVersion: course.dataVersion,
      tees: [],
    }];
  });
}

test("P03 evidence maps every formerly pending club to one explicit outcome", () => {
  assert.deepEqual(validateMexicoCourseLocationEvidence(before, evidence), { valid: true, errors: [], reviewed: 62 });
  assert.equal(evidence.verifiedLocations.length, 59);
  assert.equal(evidence.pendingLocations.length, 3);
  assert.equal(new Set([...evidence.verifiedLocations, ...evidence.pendingLocations].map((row) => row.clubId)).size, 62);
});

test("P03 raises evidenced coverage without creating, deleting, or renaming identities", () => {
  assert.deepEqual(courseGeoCoverage(before), { clubs: 153, geolocated: 91, pending: 62 });
  assert.deepEqual(courseGeoCoverage(merged), { clubs: 153, geolocated: 150, pending: 3 });
  assert.deepEqual(merged.clubs, source.clubs);
  assert.deepEqual(merged.clubs.map(({ id, name }) => ({ id, name })), before.clubs.map(({ id, name }) => ({ id, name })));
  assert.equal(new Set(merged.clubs.map((club) => club.id)).size, 153);
  assert.deepEqual(merged.courses, before.courses);
  assert.deepEqual(merged.tees, before.tees);
});

test("P03 coordinates are exact evidenced property points inside Mexico, never placeholders", () => {
  for (const record of evidence.verifiedLocations) {
    assert.ok(record.latitude >= 14 && record.latitude <= 33, record.clubName);
    assert.ok(record.longitude >= -118 && record.longitude <= -86, record.clubName);
    assert.notEqual(record.latitude, 0);
    assert.notEqual(record.longitude, 0);
    assert.equal(record.pointKind, "club_course_property");
    assert.match(record.sourceUrl, /^https?:\/\//);
    assert.ok(record.sourceAuthority.length > 5);
  }
});

for (const [region, latitude, longitude] of [
  ["Puebla / Cholula", 19.0414, -98.2063],
  ["CDMX", 19.4326, -99.1332],
  ["Querétaro", 20.5888, -100.3899],
  ["Guadalajara", 20.6736, -103.3440],
  ["Monterrey", 25.6866, -100.3161],
  ["Cancún", 21.1619, -86.8515],
  ["Los Cabos", 22.9040, -109.9000],
  ["Puerto Vallarta", 20.6534, -105.2253],
] as const) {
  test(`P03 nearby derives distinct ordered clubs within 50 km for ${region}`, () => {
    const result = nearestReviewedClubs(nearbyRows(), { latitude, longitude });
    assert.ok(result.length > 0 && result.length <= 3, `${region}: ${result.length}`);
    assert.equal(new Set(result.map((row) => row.clubId)).size, result.length);
    assert.ok(result.every((row) => row.distanceKm <= 50 && Number.isFinite(row.latitude) && Number.isFinite(row.longitude)));
    assert.deepEqual(result.map((row) => row.distanceKm), result.map((row) => row.distanceKm).toSorted((left, right) => left - right));
  });
}

test("P03 keeps the reconciled Puebla discovery order and adds Cola de Lagarto without duplicates", () => {
  const result = nearestReviewedClubs(nearbyRows(), { latitude: 19.008297, longitude: -98.254634 });
  assert.deepEqual(result.map((row) => row.clubId), ["club-la-vista", "club-campestre-puebla", "review-club-75f6ac3a0e37a69eabd3"]);
  assert.equal(merged.clubs.find((club) => club.id === "club-cola-de-lagarto")?.latitude, 18.8693355);
});

test("P03 geolocation changes cannot turn nine-hole cards into eighteen-hole cards", () => {
  assert.equal(before.tees.filter((tee) => tee.holeCount === 9).length, merged.tees.filter((tee) => tee.holeCount === 9).length);
  assert.equal(before.tees.filter((tee) => tee.holeCount === 18).length, merged.tees.filter((tee) => tee.holeCount === 18).length);
});

test("P03 second local merge is rejected instead of drifting coordinates", () => {
  assert.throws(() => mergeMexicoCourseLocations(merged, evidence), /LOCATION_ALREADY_SET/);
});
