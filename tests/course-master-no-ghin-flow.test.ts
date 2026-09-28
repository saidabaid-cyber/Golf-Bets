import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyRoundCourseHandicaps } from "../features/handicap/round-player-handicap";
import {
  BackyardVerifiedProvider,
  FMGProvider,
  USGAProvider,
  resolveCourseProviderAdapters,
} from "../lib/course-provider-adapters";
import { assignTeeToEveryPlayer } from "../lib/player-tee-assignments";
import { beginRoundCourseSelection, completeRoundTeeSelection } from "../lib/round-course-selection";
import { collectRoundSetupPreflightIssues } from "../lib/round-setup-preflight";
import { reviewedTeeToCourse, searchReviewedCourses, type ReviewedCatalogCourse } from "../lib/review-course-catalog";
import type { Player } from "../lib/types";

const layout: ReviewedCatalogCourse = {
  id: "mx-layout-72",
  clubId: "mx-facility",
  name: "Par 72",
  clubName: "Club Mexicano Verificado",
  holes: 18,
  country: "MX",
  city: "Puebla",
  stateRegion: "Puebla",
  aliases: ["Campo Verificado"],
  sourceUrl: "https://club.example.invalid/scorecard",
  observedAt: "2026-09-28T08:00:00.000Z",
  dataVersion: "verified-v1",
  ratingReuseStatus: "AUTHORIZED",
  origin: "BACKYARD_ADMIN",
  tees: [{
    id: "mx-white",
    name: "Blancas",
    displayName: "Blancas",
    gender: "MEN",
    course_rating: 70.8,
    slope_rating: 128,
    yards: 6590,
    par: 72,
    rating_category: "MEN",
    qa_status: "PASS",
    source_limitation: null,
    nineRatings: [],
    qa: { status: "PASS", errors: [] },
    provider: "BACKYARD_INTERNAL",
    holes: Array.from({ length: 18 }, (_, index) => ({
      hole_number: index + 1,
      par: 4,
      stroke_index: index + 1,
      yards: 366,
    })),
  }],
};

test("Backyard Index without GHIN completes search → layout → tee → handicap → round preflight", () => {
  const matches = searchReviewedCourses([layout], "campo verificado");
  assert.deepEqual(matches.map((course) => course.id), [layout.id]);

  const card = reviewedTeeToCourse(layout, layout.tees[0]);
  const pending = beginRoundCourseSelection([card]);
  assert.equal(pending.ok, true);
  if (!pending.ok) return;
  const selected = completeRoundTeeSelection(pending, card.catalogTeeId!);
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.deepEqual({
    par: selected.course.holes.reduce((total, hole) => total + hole.par, 0),
    rating: selected.course.rating,
    slope: selected.course.slope,
    yards: selected.course.totalYards,
  }, { par: 72, rating: 70.8, slope: 128, yards: 6590 });

  const player: Player = {
    id: "backyard-user",
    accountUserId: "backyard-user",
    name: "Jugador Backyard",
    handicap: 10,
    handicapIndex: 10,
    handicapSource: "profile_index",
    handicapIndexSource: "BACKYARD_INDEX",
  };
  const capturedAt = "2026-09-28T09:00:00.000Z";
  const assignments = assignTeeToEveryPlayer([player], selected.course, capturedAt);
  const applied = applyRoundCourseHandicaps([player], assignments, selected.course, capturedAt);
  assert.equal(applied[0].courseHandicapSnapshot?.courseHandicap, 10);
  assert.equal(applied[0].courseHandicapSnapshot?.indexSource, "BACKYARD_INDEX");
  assert.deepEqual(collectRoundSetupPreflightIssues({ courseSelected: true, players: applied, betIssues: [] }), []);
  assert.equal("ghinNumber" in applied[0], false);
});

test("external providers remain disabled without authorization while the local master stays ready", () => {
  assert.equal(BackyardVerifiedProvider.resolve().readiness, "READY");
  assert.equal(USGAProvider.resolve().readiness, "DISABLED_PENDING_AUTHORIZATION");
  assert.equal(FMGProvider.resolve().readiness, "DISABLED_PENDING_AUTHORIZATION");
  const resolved = resolveCourseProviderAdapters([]);
  assert.deepEqual(resolved.filter(({ state }) => state.readiness === "READY").map(({ adapter }) => adapter.id), ["BackyardVerifiedProvider"]);
});

test("authorization must match the adapter and explicitly permit import and display", () => {
  const wrongSource = USGAProvider.resolve({
    provider: "FMG",
    authorizationStatus: "AUTHORIZED",
    authorizedForImport: true,
    authorizedForDisplay: true,
    ratingReuseAuthorized: true,
  });
  assert.equal(wrongSource.readiness, "DISABLED_PENDING_AUTHORIZATION");
  const authorized = USGAProvider.resolve({
    provider: "USGA_NCRDB",
    authorizationStatus: "AUTHORIZED",
    authorizedForImport: true,
    authorizedForDisplay: true,
    ratingReuseAuthorized: true,
  });
  assert.deepEqual(authorized, {
    readiness: "READY",
    canImport: true,
    canDisplay: true,
    canReuseRatings: true,
    reason: "La fuente cuenta con autorización explícita en el registro Course Master.",
  });
});

test("legacy origin labels never authorize Rating/Slope by themselves", () => {
  const legacy = reviewedTeeToCourse({
    ...layout,
    provider: "OWNER_CATALOG_REVIEW",
    origin: "GHIN",
    ratingReuseStatus: "LEGAL_REVIEW_REQUIRED",
  }, {
    ...layout.tees[0],
    provider: "OWNER_CATALOG_REVIEW",
    provider_course_id: "legacy-course",
    provider_tee_set_rating_id: "legacy-tee",
    provider_mapping_status: "CONFIRMED",
  });
  assert.equal(legacy.rating, undefined);
  assert.equal(legacy.slope, undefined);
  assert.equal(legacy.catalogReview?.reportedRating, 70.8, "evidence remains visible for review");
  assert.equal(legacy.holes.length, 18, "the layout remains selectable without promoting unlicensed ratings");
});

test("a confirmed GHIN mapping may expose its rating without trusting origin alone", () => {
  const confirmed = reviewedTeeToCourse({
    ...layout,
    provider: "GHIN",
    origin: "GHIN",
    ratingReuseStatus: "LEGAL_REVIEW_REQUIRED",
    providerCourseId: "official-course",
  }, {
    ...layout.tees[0],
    provider: "GHIN",
    provider_course_id: "official-course",
    provider_tee_set_rating_id: "official-tee",
    provider_mapping_status: "CONFIRMED",
  });
  assert.equal(confirmed.rating, 70.8);
  assert.equal(confirmed.slope, 128);
});

test("a GHIN tee mapped to another layout cannot lend its rating", () => {
  const mismatched = reviewedTeeToCourse({
    ...layout,
    provider: "GHIN",
    origin: "GHIN",
    ratingReuseStatus: "LEGAL_REVIEW_REQUIRED",
    providerCourseId: "official-course",
  }, {
    ...layout.tees[0],
    provider: "GHIN",
    provider_course_id: "different-course",
    provider_tee_set_rating_id: "official-tee",
    provider_mapping_status: "CONFIRMED",
  });
  assert.equal(mismatched.rating, undefined);
  assert.equal(mismatched.slope, undefined);
});

test("a missing course exposes the existing feedback flow with contextual prefill", () => {
  const picker = readFileSync("app/components/catalog-course-picker.tsx", "utf8");
  const page = readFileSync("app/page.tsx", "utf8");
  const totalEntry = readFileSync("app/components/total-score-entry.tsx", "utf8");
  assert.match(picker, /Solicitar este campo/);
  assert.match(picker, /onRequest\(query\.trim\(\)\|\|undefined\)/);
  assert.match(page, /requestFeedback\("COURSE", searchedName \? \{ name: searchedName \} : undefined\)/);
  assert.match(totalEntry, /requestFeedback\('COURSE',searchedName\?\{name:searchedName\}:undefined\)/);
});

test("course selection runtime has no GHIN gate or direct provider request", () => {
  const picker = readFileSync("app/components/catalog-course-picker.tsx", "utf8");
  const route = readFileSync("app/api/courses/search/route.ts", "utf8");
  const serverCatalog = readFileSync("lib/course-catalog-provider.server.ts", "utf8");
  assert.doesNotMatch(picker, /import[^\n]+ghin|GHIN_[A-Z_]+ENABLED|ghinLink|ghinNumber/i);
  assert.doesNotMatch(route, /golfer_login|GHIN_TEST_|api2?\.ghin\.com/i);
  assert.match(route, /searchCourseCards/);
  assert.match(serverCatalog, /reviewedTeeRatingIsAuthorized\(row, tee\)/);
  assert.doesNotMatch(serverCatalog, /row\.origin === "GHIN" \|\| row\.origin === "BACKYARD_PROVISIONAL"/);
});
