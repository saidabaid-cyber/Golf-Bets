import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCourseCatalogProvider } from "../lib/course-catalog-provider";
import type { GolfCourseCatalog } from "../lib/golf-course-directory";
import { reviewedTeeToCourse, searchReviewedCourses, type ReviewedCatalogCourse, type ReviewedTeeSource } from "../lib/review-course-catalog";
import { calculateCourseHandicap } from "../features/handicap/course-handicap";

const tee: ReviewedTeeSource = {
  id: "authorized-white", name: "White", displayName: "White", gender: "MEN",
  course_rating: 70.8, slope_rating: 128, yards: 6590, par: 72, rating_category: "MEN",
  qa_status: "PASS", source_limitation: null, qa: { status: "PASS", errors: [] }, nineRatings: [],
  holes: Array.from({ length: 18 }, (_, index) => ({ hole_number: index + 1, par: 4, stroke_index: index + 1, yards: 366 })),
  provider: "AUTHORIZED_FIXTURE",
};

const course: ReviewedCatalogCourse = {
  id: "layout-par-72", clubId: "facility-la-vista", name: "Par 72", clubName: "La Vista Country Club",
  holes: 18, country: "MX", city: "Puebla", stateRegion: "Puebla", aliases: ["LA VISTA"],
  sourceUrl: "https://provider.example.invalid/course", observedAt: "2026-09-27T12:00:00.000Z", dataVersion: "authorized-v1",
  ratingReuseStatus: "AUTHORIZED", origin: "BACKYARD_ADMIN", tees: [tee],
};

test("an authorized Course Master tee is playable for Backyard Index without a GHIN identity", () => {
  const selection = reviewedTeeToCourse(course, tee);
  assert.equal(selection.provider, "AUTHORIZED_FIXTURE");
  assert.equal(selection.rating, 70.8);
  assert.equal(selection.slope, 128);
  assert.equal(selection.holes.length, 18);
  assert.equal(calculateCourseHandicap({ playerId: "new-user-without-ghin", index: 10, indexSource: "BACKYARD_INDEX", teeId: selection.id, teeName: selection.teeName, slope: selection.slope!, courseRating: selection.rating!, par: 72, effectiveAt: "2026-09-27T12:00:00.000Z" }), 10);
});
test("search is partial, case- and accent-insensitive across facility, layout, city and aliases", () => {
  const rows = [{ ...course, tees: undefined }] as unknown as Array<Omit<ReviewedCatalogCourse, "tees">>;
  for (const query of ["Vista", "la vista", "LA VÍSTA", "puebla", "Par 72"]) assert.deepEqual(searchReviewedCourses(rows, query).map((row) => row.id), [course.id]);
});

test("provider catalog keeps 9- and 18-hole layouts and gendered tees independent", async () => {
  const catalog: GolfCourseCatalog = {
    schemaVersion: 1,
    clubs: [{ id: "facility", name: "Facility", aliases: [], country: "MX", active: true, provider: "AUTHORIZED_FIXTURE" }],
    courses: [
      { id: "layout-18", clubId: "facility", name: "18", holes: 18, active: true, provider: "AUTHORIZED_FIXTURE" },
      { id: "layout-9", clubId: "facility", name: "9", holes: 9, active: true, provider: "AUTHORIZED_FIXTURE" },
    ],
    tees: [
      { id: "men", courseId: "layout-18", legacySelectionId: "men", name: "White", gender: "MEN", active: true },
      { id: "women", courseId: "layout-18", legacySelectionId: "women", name: "White", gender: "WOMEN", active: true },
      { id: "nine", courseId: "layout-9", legacySelectionId: "nine", name: "General", active: true },
    ],
    holes: [], teeHoleYardages: [], geoFeatures: [],
  };
  const provider = createCourseCatalogProvider(catalog);
  const layouts = await provider.getCourses("facility");
  assert.ok(layouts.ok);
  if (layouts.ok) assert.deepEqual(layouts.data.map((row) => row.holes), [18, 9]);
  const tees = await provider.getTees("layout-18");
  assert.ok(tees.ok);
  if (tees.ok) assert.deepEqual(tees.data.map((row) => row.gender), ["MEN", "WOMEN"]);
});

test("Course Master runtime and migration stay provider-agnostic and fail closed on unlicensed NCRDB bulk use", () => {
  const loader = readFileSync("lib/review-course-catalog.server.ts", "utf8");
  const provider = readFileSync("lib/course-catalog-provider.server.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260928040000_course_master_sources.sql", "utf8");
  const importer = readFileSync("scripts/course-provider-sync.mjs", "utf8");
  assert.match(loader, /read_backyard_course_master_v1/);
  assert.doesNotMatch(provider, /GHIN_TEST_LOGIN|GHIN_TEST_PASSWORD|golfer_user_token/);
  assert.match(migration, /'USGA_NCRDB'[\s\S]+LEGAL_REVIEW_REQUIRED[\s\S]+false, false, false/);
  assert.match(importer, /SOURCE_NOT_AUTHORIZED_IN_QA_REGISTRY/);
  assert.doesNotMatch(importer, /ncrdb\.usga\.org|golfer_login|GHIN_TEST_/i);
});
