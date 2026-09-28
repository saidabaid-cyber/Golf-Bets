import assert from "node:assert/strict";
import test from "node:test";

import { buildCourseProviderSyncPlan, normalizeCourseProviderBundle } from "./lib/course-provider-sync.mjs";

function bundle(overrides = {}) {
  return {
    schemaVersion: 1,
    source: {
      provider: "AUTHORIZED_FIXTURE",
      displayName: "Authorized QA fixture",
      sourceUrl: "https://provider.example.invalid/feed",
      termsUrl: "https://provider.example.invalid/terms",
      authorizationStatus: "AUTHORIZED",
      authorizationBasis: "Synthetic fixture licensed for automated tests only.",
      authorizedForDatabaseImport: true,
      ratingReuseAuthorized: true,
      fetchedAt: "2026-09-27T12:00:00.000Z",
    },
    scope: { kind: "COUNTRY", country: "México", complete: false },
    facilities: [{
      externalId: "facility-1", name: "Club Águila", aliases: ["Águila Golf"], country: "México",
      stateRegion: "Puebla", city: "Puebla", latitude: 19.04, longitude: -98.2, status: "Active",
      layouts: [
        {
          externalId: "layout-18", name: "Championship", aliases: ["Campeonato"], holeCount: 18, par: 72,
          holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndexMen: index + 1 })),
          tees: [{
            externalId: "tee-blue", name: "Blue", gender: "Men", totalYards: 7200, par: 72,
            courseRating: 73.2, slopeRating: 134,
            holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndexMen: index + 1, yards: 400 })),
          }],
        },
        {
          externalId: "layout-9", name: "Executive 9", holeCount: 9, par: 36,
          holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, strokeIndexMen: index * 2 + 1 })),
          tees: [{ externalId: "tee-nine", name: "Unisex", gender: "Mixed", totalMeters: 3000, par: 36, courseRating: 35.6, slopeRating: 121,
            holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, strokeIndexMen: index * 2 + 1, meters: 333 })) }],
        },
      ],
    }],
    ...overrides,
  };
}

test("an unlicensed or legally unresolved source is rejected before normalization", () => {
  const input = bundle();
  input.source.authorizationStatus = "LEGAL_REVIEW_REQUIRED";
  input.source.authorizedForDatabaseImport = false;
  assert.throws(() => normalizeCourseProviderBundle(input), /SOURCE_NOT_AUTHORIZED_FOR_DATABASE_IMPORT/);
});

test("authorized input normalizes country, accents and units without inventing missing facts", () => {
  const plan = buildCourseProviderSyncPlan(bundle());
  assert.equal(plan.normalized.facilities[0].country, "MX");
  assert.deepEqual(plan.normalized.facilities[0].aliases, ["Águila Golf"]);
  assert.equal(plan.quality.facilities, 1);
  assert.equal(plan.quality.layouts, 2);
  assert.equal(plan.quality.tees, 2);
  assert.equal(plan.quality.holes, 27);
  assert.equal(plan.quality.completeLayoutScorecards, 2);
  assert.equal(plan.quality.completeTeeScorecards, 2);
  assert.deepEqual(plan.rows.holes.filter((hole) => hole.course_id === plan.rows.layouts.find((layout) => layout.provider_external_id === "layout-9").id).map((hole) => hole.stroke_index), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  const nine = plan.rows.tees.find((tee) => tee.provider_external_id === "tee-nine");
  assert.equal(nine.total_meters, 3000);
  assert.equal(nine.total_yards, 3281);
  assert.equal(nine.catalog_metadata.derived_unit, "YARDS_FROM_METERS");
  assert.equal(nine.bogey_rating, null);
});

test("repeated import is idempotent and preserves stable existing Backyard ids", () => {
  const first = buildCourseProviderSyncPlan(bundle());
  const current = structuredClone(first.rows);
  const legacyFacilityId = "stable-backyard-facility-id";
  const oldFacilityId = current.facilities[0].id;
  current.facilities[0].id = legacyFacilityId;
  for (const layout of current.layouts) if (layout.club_id === oldFacilityId) layout.club_id = legacyFacilityId;
  const second = buildCourseProviderSyncPlan(bundle(), current);
  assert.equal(second.blocked, false);
  assert.equal(second.rows.facilities[0].id, legacyFacilityId);
  assert.equal(second.rows.layouts[0].club_id, legacyFacilityId);
  assert.equal(second.counts.ADDED, 0);
  assert.equal(second.counts.UPDATED, 0);
  assert.ok(second.counts.UNCHANGED > 0);
});

test("cross-provider name collision is a conflict and distinct layouts are not collapsed", () => {
  const existing = {
    facilities: [{ id: "backyard-club", name: "CLUB AGUILA", city: "PUEBLA", country: "MX", provider: "BACKYARD_INTERNAL", provider_external_id: "internal-1" }],
    layouts: [], tees: [], holes: [], yardages: [],
  };
  const plan = buildCourseProviderSyncPlan(bundle(), existing);
  assert.equal(plan.blocked, true);
  assert.ok(plan.changes.some((change) => change.status === "CONFLICT" && change.entityType === "FACILITY"));
  assert.equal(new Set(plan.rows.layouts.map((layout) => layout.id)).size, 2);
});

test("incomplete hole detail remains incomplete instead of fabricating stroke allocation", () => {
  const input = bundle();
  input.facilities[0].layouts[0].holes[0].strokeIndexMen = null;
  input.facilities[0].layouts[0].tees[0].holes[0].strokeIndexMen = null;
  const plan = buildCourseProviderSyncPlan(input);
  const layout = plan.rows.layouts.find((row) => row.provider_external_id === "layout-18");
  assert.equal(plan.rows.holes.filter((hole) => hole.course_id === layout.id).length, 0);
  assert.equal(plan.rows.yardages.filter((yardage) => yardage.course_id === layout.id).length, 0);
  assert.equal(plan.rows.tees.find((tee) => tee.provider_external_id === "tee-blue").catalog_metadata.qa_status, "MISSING_HOLE_DATA");
});

test("missing provider rows are only marked deprecated for an explicitly complete scope", () => {
  const first = buildCourseProviderSyncPlan(bundle());
  const current = structuredClone(first.rows);
  current.tees.push({ ...current.tees[0], id: "old-tee", provider_external_id: "old-tee", name: "Old" });
  assert.equal(buildCourseProviderSyncPlan(bundle(), current).counts.DEPRECATED, 0);
  const complete = bundle({ scope: { kind: "COUNTRY", country: "MX", complete: true } });
  assert.equal(buildCourseProviderSyncPlan(complete, current).changes.some((change) => change.status === "DEPRECATED" && change.externalId === "old-tee"), true);
});
