import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MEXICO_COURSE_COVERAGE_COLUMNS,
  buildMexicoCourseCoverageRows,
  mexicoCourseCoverageCsv,
  parseMexicoCourseCoverageCsv,
  summarizeMexicoCourseCoverage,
} from "./lib/mexico-course-coverage.mjs";

const seed = { clubs: [{ id: "facility-1", city: "San Andrés Cholula", stateRegion: "Puebla" }] };

function row(overrides = {}) {
  return {
    facility_id: "facility-1",
    facility: "La Vista Country Club",
    course: "Par 72",
    city: null,
    state: null,
    layout: "Par 72",
    tee: "Blue",
    gender: "MEN",
    par: 72,
    rating: 73.8,
    slope: 135,
    length: "7122 yd",
    hole_by_hole_available: true,
    coordinates_available: true,
    source: "GHIN",
    origin: "GHIN",
    source_facility_id: "19886",
    source_course_id: "23233",
    source_tee_id: "280984",
    rating_rights: "QA_CONFIRMED_GHIN",
    source_url: "https://www.ghin.com/",
    verified_at: "2026-09-28T00:00:00Z",
    needs_verification: false,
    ...overrides,
  };
}

test("coverage CSV has exactly the requested columns and enriches blank locality only", () => {
  const rows = buildMexicoCourseCoverageRows([row()], seed);
  assert.equal(rows[0].city, "San Andrés Cholula");
  assert.equal(rows[0].state, "Puebla");
  assert.equal(rows[0].status, "COMPLETE");
  assert.deepEqual(mexicoCourseCoverageCsv(rows).split("\n")[0].split(","), MEXICO_COURSE_COVERAGE_COLUMNS);
});

test("legally unresolved catalog evidence is NEEDS_VERIFICATION even when physical values existed upstream", () => {
  const rows = buildMexicoCourseCoverageRows([row({
    source: "OWNER_CATALOG_REVIEW",
    rating: null,
    slope: null,
    rating_rights: "LEGAL_REVIEW_REQUIRED",
    needs_verification: true,
  })], seed);
  assert.equal(rows[0].status, "NEEDS_VERIFICATION");
  assert.equal(rows[0].rating, null);
  assert.equal(rows[0].slope, null);
});

test("missing tee, rating, slope, holes, location and partial rows use deterministic precedence", () => {
  const cases = [
    [row({ tee: null }), "MISSING_TEES"],
    [row({ rating: null }), "MISSING_RATING"],
    [row({ slope: null }), "MISSING_SLOPE"],
    [row({ hole_by_hole_available: false }), "MISSING_HOLES"],
    [row({ coordinates_available: false }), "MISSING_LOCATION"],
    [row({ gender: null }), "PARTIAL"],
  ];
  assert.deepEqual(buildMexicoCourseCoverageRows(cases.map(([input]) => input), seed).map((item) => item.status).sort(), cases.map(([, status]) => status).sort());
});

test("summary reports usable rating, hole and coordinate percentages without claiming completeness", () => {
  const rows = buildMexicoCourseCoverageRows([
    row(),
    row({ tee: "White", hole_by_hole_available: false }),
    row({ tee: "Gold", rating: null, slope: null, needs_verification: true }),
  ], seed);
  assert.deepEqual(summarizeMexicoCourseCoverage(rows), {
    rows: 3,
    facilities: 1,
    courses: 1,
    layouts: 1,
    tees: 3,
    ratedTees: 2,
    ratingSlopePercent: 66.67,
    holeByHolePercent: 66.67,
    coordinatesPercent: 100,
    byStatus: {
      COMPLETE: 1,
      PARTIAL: 0,
      MISSING_RATING: 0,
      MISSING_SLOPE: 0,
      MISSING_TEES: 0,
      MISSING_HOLES: 1,
      MISSING_LOCATION: 0,
      NEEDS_VERIFICATION: 1,
    },
  });
});

test("committed Mexico QA inventory is structurally exact and redacts unresolved rating evidence", () => {
  const rows = parseMexicoCourseCoverageCsv(readFileSync("docs/course-data/MEXICO_COURSE_COVERAGE.csv", "utf8"));
  assert.equal(rows.length, 779);
  assert.equal(new Set(rows.map((row) => row.facility)).size, 153);
  assert.equal(new Set(rows.map((row) => `${row.facility}\u0000${row.layout}`)).size, 178);
  assert.equal(rows.filter((row) => row.source === "OWNER_CATALOG_REVIEW" && (row.rating || row.slope)).length, 0);
  assert.deepEqual(Object.fromEntries([...new Set(rows.map((row) => row.status))].sort().map((status) => [status, rows.filter((row) => row.status === status).length])), {
    COMPLETE: 6,
    MISSING_HOLES: 8,
    NEEDS_VERIFICATION: 765,
  });
});
