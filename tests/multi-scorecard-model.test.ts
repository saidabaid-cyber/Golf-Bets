import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { golfCourseSelectionToLegacyCourse, type GolfCourseCatalog, type GolfScorecardProfile } from "../lib/golf-course-directory";
import { freezeScorecardProfileSelection, scorecardProfileLabel, scorecardProfilesForCards } from "../lib/course-scorecard-profiles";
import { scorecardOptionsForLayout, teeOptionsForCourse } from "../lib/player-tee-assignments";
import { courseWithResolvedOperations } from "../lib/player-course-operations";

const migration = readFileSync("supabase/migrations/20260928085339_multi_scorecard_profiles.sql", "utf8");
const provenanceCorrection = readFileSync("supabase/migrations/20260928085759_add_provider_reviewed_provenance.sql", "utf8");

function profile(overrides: Partial<GolfScorecardProfile>): GolfScorecardProfile {
  return {
    id: "profile-official", courseId: "course-campestre", name: "GHIN / Oficial", provenance: "GHIN_OFFICIAL",
    sourceProvider: "GHIN", sourceExternalId: "official-1", verifiedAt: "2026-09-28T12:00:00.000Z",
    effectiveFrom: null, effectiveTo: null, active: true, historical: false, defaultForPlay: false, status: "PUBLISHED",
    tees: [{ teeId: "tee-white", ratingGender: "MEN", par: 72, courseRating: 71.1, bogeyRating: null, slopeRating: 129,
      frontNineRating: null, frontNineSlope: null, backNineRating: null, backNineSlope: null,
      totalYards: 6500, totalMeters: null, sourceExternalId: "official-tee", providerStatus: "Active" }],
    holes: Array.from({ length: 18 }, (_, index) => ({ holeId: `hole-${index + 1}`, holeNumber: index + 1, ratingGender: "MEN", strokeIndex: index + 1 })),
    ...overrides,
  };
}

function catalog(): GolfCourseCatalog {
  return {
    schemaVersion: 1,
    clubs: [{ id: "club-campestre", name: "Club Campestre de Puebla", active: true, provider: "BACKYARD_INTERNAL" }],
    courses: [{ id: "course-campestre", clubId: "club-campestre", name: "Recorrido principal", holes: 18, active: true,
      provider: "GHIN", sourceUrl: "https://example.invalid/official", verifiedAt: "2026-09-28T12:00:00.000Z" },
      { id: "course-campestre-repair", clubId: "club-campestre", name: "Temporal / Reparación", holes: 18, active: true,
        provider: "BACKYARD_INTERNAL", origin: "BACKYARD_PROVISIONAL", isProvisional: true }],
    tees: [{ id: "tee-white", courseId: "course-campestre", legacySelectionId: "campestre-white", name: "Blancas", gender: "MEN", rating: 71.1, slope: 129, par: 72, totalYards: 6500, active: true }],
    holes: Array.from({ length: 18 }, (_, index) => ({ id: `hole-${index + 1}`, courseId: "course-campestre", holeNumber: index + 1, par: 4, strokeIndex: index + 1 })),
    teeHoleYardages: Array.from({ length: 18 }, (_, index) => ({ teeId: "tee-white", holeId: `hole-${index + 1}`, holeNumber: index + 1, yards: 350 + index })),
    geoFeatures: [],
    scorecardProfiles: [
      profile({}),
      profile({ id: "profile-club", name: "Tarjeta del club — Actual", provenance: "CLUB_SCORECARD_VERIFIED", sourceProvider: "CLUB_SCORECARD", sourceExternalId: "club-current-v4", defaultForPlay: true,
        tees: [{ ...profile({}).tees[0], courseRating: 70.8, slopeRating: 126, sourceExternalId: "club-white" }],
        holes: Array.from({ length: 18 }, (_, index) => ({ holeId: `hole-${index + 1}`, holeNumber: index + 1, ratingGender: "MEN", strokeIndex: 18 - index })) }),
      profile({ id: "profile-old", name: "Tarjeta 2024", provenance: "CLUB_SCORECARD_VERIFIED", sourceProvider: "CLUB_SCORECARD", sourceExternalId: "club-2024", active: false, historical: true, status: "ARCHIVED", tees: [], holes: [] }),
    ],
  };
}

test("one physical layout exposes independent club and official scorecard profiles without duplicating the facility", () => {
  const source = catalog();
  const official = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-official", "MEN");
  const club = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN");
  assert.ok(official && club);
  assert.equal(source.clubs.length, 1);
  assert.equal(source.courses.filter((course) => course.id === "course-campestre").length, 1);
  assert.equal(official.catalogCourseId, club.catalogCourseId);
  assert.notEqual(official.id, club.id);
  assert.deepEqual({ rating: official.rating, slope: official.slope, firstSi: official.holes[0].strokeIndex }, { rating: 71.1, slope: 129, firstSi: 1 });
  assert.deepEqual({ rating: club.rating, slope: club.slope, firstSi: club.holes[0].strokeIndex }, { rating: 70.8, slope: 126, firstSi: 18 });
});

test("default club profile is first, historical profiles stay stored but are not offered for play", () => {
  const source = catalog();
  const cards = source.scorecardProfiles!.flatMap((row) => row.tees.map((tee) => golfCourseSelectionToLegacyCourse(source, tee.teeId, row.id, tee.ratingGender)!));
  const options = scorecardProfilesForCards(cards);
  assert.deepEqual(options.map((item) => item.id), ["profile-club", "profile-official"]);
  assert.equal(scorecardProfileLabel(options[0]), "Tarjeta del club — Actual · Tarjeta del club");
  assert.equal(options.some((item) => item.id === "profile-old"), false);
});

test("layout filtering keeps profile choices together while tee assignment stays inside the selected profile", () => {
  const source = catalog();
  const official = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-official", "MEN")!;
  const club = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN")!;
  const repair = { ...club, id: "repair-card", catalogCourseId: "course-campestre-repair", scorecardProfileId: "repair-profile", name: "Temporal / Reparación" };
  assert.deepEqual(scorecardOptionsForLayout(club, [official, club, repair]).map((item) => item.scorecardProfileId), ["profile-official", "profile-club"]);
  assert.deepEqual(teeOptionsForCourse(club, [official, club, repair]).map((item) => item.scorecardProfileId), ["profile-club"]);
});

test("round scorecard snapshot and profile stroke indexes remain immutable after catalog and operations updates", () => {
  const source = catalog();
  const club = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN")!;
  const frozen = freezeScorecardProfileSelection(club)!;
  source.scorecardProfiles![1].holes[0].strokeIndex = 2;
  assert.equal(frozen.strokeIndexes[0].strokeIndex, 18);
  const resolved = courseWithResolvedOperations(club, { resolved: { sourceCourseId: "course-campestre", baseVersion: 2,
    configurationIds: [], configurationVersions: [], configurationHashes: [],
    resolvedHoles: Array.from({ length: 18 }, (_, index) => ({ id: `hole-${index + 1}`, runtimeHoleNumber: index + 1, displayLabel: String(index + 1), par: 4, strokeIndex: index + 1 })),
    resolvedTees: [{ id: "tee-white", name: "Blancas", rating: 99, slope: 155, yardages: Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`hole-${index + 1}`, 350 + index])) }],
    warnings: [], effectiveAt: "2026-09-28T13:00:00.000Z" }, localRules: [], badges: [] });
  assert.equal(resolved.holes[0].strokeIndex, 18);
  assert.equal(resolved.rating, 70.8);
  assert.equal(resolved.slope, 126);
});

test("migration enforces coexistence, one current default, provenance, RLS and immutable round evidence", () => {
  assert.match(migration, /create table public\.course_scorecard_profiles/);
  assert.match(migration, /create table public\.course_scorecard_profile_tees/);
  assert.match(migration, /create table public\.course_scorecard_profile_holes/);
  assert.match(migration, /GHIN_OFFICIAL[\s\S]*USGA_OFFICIAL[\s\S]*CLUB_SCORECARD_VERIFIED[\s\S]*CLUB_TEMPORARY[\s\S]*TOURNAMENT/);
  assert.match(migration, /PROVIDER_REVIEWED/);
  assert.doesNotMatch(migration, /provider = 'GHIN' or course\.origin = 'GHIN'/);
  assert.match(provenanceCorrection, /legacy research evidence/);
  assert.match(migration, /course_scorecard_profiles_current_default_idx[\s\S]+where default_for_play and active and not historical/);
  assert.match(migration, /SCORECARD_PROFILE_LAYOUT_MISMATCH/);
  assert.match(migration, /SCORECARD_PROFILE_PHYSICAL_FACT_MISMATCH/);
  assert.match(migration, /scorecard_profile_snapshot jsonb/);
  assert.match(migration, /admin_create_scorecard_profile_v1/);
  assert.match(migration, /admin_transition_scorecard_profile_v1/);
  assert.match(migration, /SCORECARD_PROFILE_INCOMPLETE/);
  assert.match(migration, /enable row level security/g);
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+table|drop\s+table/i);
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*course_scorecard/i);
});

test("generic scorecard engine contains no La Vista or Campestre branch", () => {
  const domain = readFileSync("lib/course-scorecard-profiles.ts", "utf8");
  const picker = readFileSync("app/components/round-tee-picker.tsx", "utf8");
  assert.doesNotMatch(domain, /la vista|campestre/i);
  assert.doesNotMatch(picker, /la vista|campestre/i);
});
