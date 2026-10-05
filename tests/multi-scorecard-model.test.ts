import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { golfCourseSelectionToLegacyCourse, type GolfCourseCatalog, type GolfScorecardProfile } from "../lib/golf-course-directory";
import { freezeScorecardProfileSelection, scorecardProfileLabel, scorecardProfilesForCards } from "../lib/course-scorecard-profiles";
import { reconcilePlayerTeeAssignments, scorecardOptionsForLayout, teeAssignmentSnapshot, teeOptionsForCourse } from "../lib/player-tee-assignments";
import { courseWithResolvedOperations } from "../lib/player-course-operations";
import { captureCompletedRoundIndex } from "../lib/backyard-index-auto-capture";
import { calculateBackyardIndex } from "../lib/backyard-index";
import type { Course, RoundSnapshot } from "../lib/types";

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

const indexOwner = "synthetic-index-owner";
const indexAt = "2026-10-05T10:00:00.000Z";
const indexPreference = { version: 1 as const, userId: indexOwner, enabled: true, updatedAt: indexAt, localPccZeroDeclaredAt: indexAt };
function completedProfileRound(course: Course, id: string): RoundSnapshot {
  const player = { id: "p1", name: "Synthetic regression player", accountUserId: indexOwner, handicap: 0 };
  return { id, date: "2026-10-05", lifecycleState: "completed", startedAt: indexAt, completedAt: indexAt, updatedAt: indexAt,
    ownerId: player.id, ownerName: player.name, courseName: course.name, teeName: course.teeName, courseSnapshot: course,
    roundHoles: 18, players: [player], order: course.holes.map(hole => hole.number),
    playerTeeAssignments: [teeAssignmentSnapshot(player.id, course, indexAt)],
    scores: Object.fromEntries(course.holes.map(hole => [hole.number, { [player.id]: hole.par + 1 }])),
  } as RoundSnapshot;
}

test("selected verified club card → frozen tee → real close → provisional Backyard Index without a GHIN account", () => {
  const source = catalog();
  const course = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN")!;
  const rounds = [1, 2, 3].map(id => captureCompletedRoundIndex(completedProfileRound(course, `index-${id}`), indexOwner, indexPreference));
  assert.equal(course.indexRatingEvidence?.kind, "CURATED_RATED_TEE");
  assert.equal(course.indexRatingEvidence?.scorecardProfileId, "profile-club");
  for (const round of rounds) {
    assert.equal(round.backyardIndexSnapshots![0].eligible, true);
    assert.equal(round.backyardIndexSnapshots![0].grossScore, 90);
    assert.equal(round.backyardIndexSnapshots![0].ratedTeeEvidence?.courseRating, 70.8);
    assert.equal(round.backyardIndexSnapshots![0].ratedTeeEvidence?.slopeRating, 126);
  }
  assert.equal(calculateBackyardIndex(rounds.slice(0, 2), indexOwner).value, null);
  const index = calculateBackyardIndex(rounds, indexOwner);
  assert.equal(index.eligibleRoundCount, 3);
  assert.equal(index.provisional, true);
  assert.equal(index.value, rounds[0].backyardIndexSnapshots![0].scoreDifferential! - 2);
  assert.equal(captureCompletedRoundIndex(completedProfileRound(course, "off"), indexOwner, null).backyardIndexSnapshots![0].eligible, false);
});

test("profile ratings require explicit known category and preserve distinct MEN/WOMEN evidence", () => {
  const source = catalog();
  const p = source.scorecardProfiles![1];
  p.tees.push({ ...p.tees[0], ratingGender: "WOMEN", courseRating: 77.4, slopeRating: 153 });
  assert.equal(golfCourseSelectionToLegacyCourse(source, "tee-white", p.id)?.indexRatingEvidence, undefined);
  assert.equal(golfCourseSelectionToLegacyCourse(source, "tee-white", p.id, "UNSPECIFIED")?.indexRatingEvidence, undefined);
  const men = golfCourseSelectionToLegacyCourse(source, "tee-white", p.id, "MEN")!;
  const women = golfCourseSelectionToLegacyCourse(source, "tee-white", p.id, "WOMEN")!;
  assert.equal(teeAssignmentSnapshot("p1", men, indexAt).indexRatingEvidence?.courseRating, 70.8);
  assert.equal(teeAssignmentSnapshot("p2", women, indexAt).indexRatingEvidence?.courseRating, 77.4);
  assert.notEqual(men.id, women.id);
});

test("operational/reviewed/temporary/draft/historical/unsourced profiles never become Index evidence", () => {
  const excluded: Array<Partial<GolfScorecardProfile>> = [
    { provenance: "PROVIDER_REVIEWED" }, { provenance: "CLUB_OPERATIONAL" }, { provenance: "CLUB_TEMPORARY" },
    { status: "DRAFT" }, { active: false }, { historical: true }, { verifiedAt: null },
    { sourceProvider: "" }, { effectiveFrom: "2999-01-01" }, { effectiveTo: "2000-01-01" },
  ];
  for (const change of excluded) {
    const source = catalog(); Object.assign(source.scorecardProfiles![1], change);
    const course = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN")!;
    assert.equal(course.indexRatingEvidence, undefined, JSON.stringify(change));
  }
  const source = catalog(); source.courses[0].sourceUrl = "http://example.invalid/unverified";
  assert.equal(golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN")?.indexRatingEvidence, undefined);
});

test("manual or rebound/modified selections cannot reuse a verified card's Index evidence", () => {
  const course = golfCourseSelectionToLegacyCourse(catalog(), "tee-white", "profile-club", "MEN")!;
  assert.ok(teeAssignmentSnapshot("p1", course, indexAt).indexRatingEvidence);
  assert.equal(teeAssignmentSnapshot("p1", course, indexAt, "manual").indexRatingEvidence, undefined);
  for (const change of [{ rating: 99 }, { slope: 155 }, { catalogTeeId: "another-tee" }, { catalogCourseId: "another-course" },
    { scorecardProfileId: "another-profile" }, { scorecardProfileVerifiedAt: "2000-01-01" },
    { roundTeeSelectionId: "another-selection" }, { scorecardProfileSourceUrl: "https://example.invalid/other" }]) {
    assert.equal(teeAssignmentSnapshot("p1", { ...course, ...change }, indexAt).indexRatingEvidence, undefined, JSON.stringify(change));
  }
});

test("verified new assignments freeze evidence but legacy reconciliation does not retrofit Index eligibility", () => {
  const course = golfCourseSelectionToLegacyCourse(catalog(), "tee-white", "profile-club", "MEN")!;
  const players = [{ id: "p1", name: "Regression", handicap: 0 }];
  const legacy = reconcilePlayerTeeAssignments([], players, course, indexAt);
  assert.equal(legacy[0].source, "legacy");
  assert.equal(legacy[0].indexRatingEvidence, undefined);
  const fresh = reconcilePlayerTeeAssignments([], players, course, indexAt, { allowCuratedNewAssignment: true });
  assert.equal(fresh[0].source, "catalog");
  assert.equal(fresh[0].indexRatingEvidence?.ratingGender, "MEN");
  course.indexRatingEvidence!.courseRating = 99;
  assert.equal(fresh[0].indexRatingEvidence?.courseRating, 70.8);
  assert.equal(reconcilePlayerTeeAssignments(legacy, players, course, indexAt, { allowCuratedNewAssignment: true })[0].indexRatingEvidence, undefined);
});

test("selected verified official profile uses its rating, without changing GHIN posting eligibility", () => {
  const course = golfCourseSelectionToLegacyCourse(catalog(), "tee-white", "profile-official", "MEN")!;
  assert.equal(course.indexRatingEvidence?.kind, "OFFICIAL_RATED_TEE");
  assert.equal(course.indexRatingEvidence?.courseRating, 71.1);
  assert.equal(course.ghinPostEligible, undefined);
  const captured = captureCompletedRoundIndex(completedProfileRound(course, "official-fixture"), indexOwner, indexPreference);
  assert.equal(captured.backyardIndexSnapshots![0].eligible, true);
});

test("missing or invalid profile rating values do not fall back to another tee's visible rating for Index", () => {
  for (const change of [{ courseRating: null }, { slopeRating: null }, { courseRating: 101 }, { slopeRating: 156 }, { slopeRating: 125.5 }]) {
    const source = catalog(); Object.assign(source.scorecardProfiles![1].tees[0], change);
    const course = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN")!;
    assert.equal(course.indexRatingEvidence, undefined, JSON.stringify(change));
    assert.equal(captureCompletedRoundIndex(completedProfileRound(course, "bad-rating"), indexOwner, indexPreference).backyardIndexSnapshots![0].eligible, false);
  }
});

test("verified profile without a public document binds to the real catalog projection and preserves physical source privacy", () => {
  const source = catalog(); delete source.courses[0].sourceUrl;
  assert.equal(golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN")?.indexRatingEvidence, undefined);
  const endpoint = "https://dev.thebackyard.com.mx/api/courses/catalog?courseId=course-campestre";
  const course = golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN", endpoint)!;
  assert.equal(course.sourceUrl, undefined);
  assert.equal(course.scorecardProfileSourceUrl, endpoint);
  assert.equal(course.indexRatingEvidence?.sourceUrl, endpoint);
  assert.equal(teeAssignmentSnapshot("p1", course, indexAt).indexRatingEvidence?.sourceUrl, endpoint);
  const captured = captureCompletedRoundIndex(completedProfileRound(course, "private-source-profile"), indexOwner, indexPreference);
  assert.equal(captured.backyardIndexSnapshots![0].eligible, true);
  assert.equal(JSON.stringify(course).includes("private-document"), false);
  source.scorecardProfiles![1].provenance = "PROVIDER_REVIEWED";
  assert.equal(golfCourseSelectionToLegacyCourse(source, "tee-white", "profile-club", "MEN", endpoint)?.indexRatingEvidence, undefined);
});
