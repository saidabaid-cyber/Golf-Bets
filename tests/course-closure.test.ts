import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { courseConfigurationLabel } from "../lib/course-scorecard-profiles";
import { localFirstCourseLookup } from "../lib/course-lazy-import";
import { ghinProfileRefreshPolicy, ghinProfileRefreshTtlSeconds } from "../lib/ghin/profile-refresh-policy";

const lazyServer = readFileSync("lib/course-lazy-import.server.ts", "utf8");
const searchRoute = readFileSync("app/api/courses/search/route.ts", "utf8");
const feedbackRoute = readFileSync("app/api/feedback/route.ts", "utf8");
const feedbackDialog = readFileSync("app/components/feedback-dialog.tsx", "utf8");
const cacheMigration = readFileSync("supabase/migrations/20260928113000_course_lazy_import_and_course_requests.sql", "utf8");
const laVistaMigration = readFileSync("supabase/migrations/20260928114500_la_vista_club_current_scorecard.sql", "utf8");

test("local hit performs zero provider calls", async () => {
  let providerCalls = 0;
  const lookup = await localFirstCourseLookup({
    local: async () => [{ id: "local-course" }],
    remote: async () => (++providerCalls, { status: "IMPORTED", courseIds: ["unexpected"], upstreamCalls: 3, cached: false }),
    reload: async () => [{ id: "unexpected" }],
  });
  assert.equal(providerCalls, 0);
  assert.equal(lookup.result.status, "LOCAL_HIT");
  assert.equal(lookup.result.upstreamCalls, 0);
  assert.deepEqual(lookup.local, [{ id: "local-course" }]);
});

test("one local miss imports once and the second search is local-only", async () => {
  const master: { id: string }[] = [];
  let providerCalls = 0;
  const run = () => localFirstCourseLookup({
    local: async () => [...master],
    remote: async () => {
      providerCalls += 3;
      master.push({ id: "ghin-course" });
      return { status: "IMPORTED" as const, courseIds: ["ghin-course"], upstreamCalls: 3, cached: false };
    },
    reload: async () => [...master],
  });
  assert.equal((await run()).result.status, "IMPORTED");
  assert.equal((await run()).result.status, "LOCAL_HIT");
  assert.equal(providerCalls, 3, "the second search must make zero additional GHIN calls");
});

test("lazy GHIN Course import requires dedicated provider authorization and never falls back to QA golfer credentials", () => {
  assert.match(lazyServer, /GHIN_COURSE_PROVIDER_LOGIN/);
  assert.match(lazyServer, /GHIN_COURSE_PROVIDER_PASSWORD/);
  assert.match(lazyServer, /authorization_status === "AUTHORIZED"[\s\S]*authorized_for_import === true/);
  assert.doesNotMatch(lazyServer, /GHIN_TEST_LOGIN|GHIN_TEST_PASSWORD|getGhinUserSession/);
  assert.match(searchRoute, /layered\.total === 0 && shouldResolveMiss/);
  assert.match(searchRoute, /importGhinCourseOnMiss\(\{ query, actorId: userId! \}\)/);
  assert.doesNotMatch(searchRoute, /importGhinCourseOnMiss\(\{[^}]*database/);
  assert.match(searchRoute, /forceFresh: true/);
});

test("lookup coordination is server-only, bounded and negative-cached", () => {
  assert.match(cacheMigration, /enable row level security/);
  assert.match(cacheMigration, /revoke all on public\.course_provider_lookup_cache from public, anon, authenticated/);
  assert.match(cacheMigration, /grant all on public\.course_provider_lookup_cache to service_role/);
  assert.match(cacheMigration, /pg_advisory_xact_lock/);
  assert.match(cacheMigration, /when 'SUCCESS' then interval '30 days'/);
  assert.match(cacheMigration, /when 'MISS' then interval '1 day'/);
});

test("course requests require a private scorecard before entering PENDING_REVIEW", () => {
  assert.match(feedbackDialog, /feedbackAttachmentRequired\(checked\.data\.category\)&&!attachment/);
  assert.match(feedbackRoute, /code:'COURSE_SCORECARD_REQUIRED'/);
  assert.match(feedbackRoute, /request_status:'PENDING_REVIEW'/);
  assert.match(cacheMigration, /'PENDING_REVIEW'[\s\S]*'DUPLICATE'/);
});

test("La Vista club-current is a sibling physical layout in the existing facility", () => {
  assert.match(laVistaMigration, /insert into public\.golf_clubs[\s\S]*'club-la-vista'[\s\S]*on conflict \(id\) do nothing/);
  assert.equal((laVistaMigration.match(/'club-la-vista'/g) ?? []).length >= 2, true);
  assert.match(laVistaMigration, /'course-la-vista-club-current','club-la-vista'/);
  assert.match(laVistaMigration, /CLUB_SCORECARD_VERIFIED/);
  assert.match(laVistaMigration, /'default_for_play',true/);
  assert.doesNotMatch(laVistaMigration, /delete\s+from|truncate\s+table|drop\s+table/i);
});

test("La Vista current card has exact ratings, one physical white tee, two rating genders and no black tee", () => {
  assert.match(laVistaMigration, /club-current-blue','MEN',72,74\.3,146,7230/i);
  assert.match(laVistaMigration, /club-current-white','MEN',72,70\.8,125,6590/i);
  assert.match(laVistaMigration, /club-current-white','WOMEN',72,77\.4,153,6590/i);
  assert.match(laVistaMigration, /club-current-gold','MEN',72,68\.4,121,6038/i);
  assert.match(laVistaMigration, /club-current-red','WOMEN',72,71\.0,137,5476/i);
  assert.equal((laVistaMigration.match(/\('tee-la-vista-club-current-white','Blancas','WHITE',6590/g) ?? []).length, 1);
  assert.doesNotMatch(laVistaMigration, /club-current-black/i);
});

test("configuration naming is generic and prioritizes provenance without club branches", () => {
  assert.equal(courseConfigurationLabel({
    courseName: "LA VISTA COUNTRY CLUB",
    clubName: "La Vista Country Club",
    totalPar: 72,
    profile: { name: "GHIN / Oficial", provenance: "GHIN_OFFICIAL" },
  }), "LA VISTA COUNTRY CLUB · Par 72 — GHIN / Oficial");
  assert.equal(courseConfigurationLabel({
    courseName: "Temporal Par 70",
    clubName: "La Vista Country Club",
    totalPar: 70,
    profile: { name: "Temporal", provenance: "CLUB_TEMPORARY" },
  }), "Temporal Par 70");
  const engine = readFileSync("lib/course-scorecard-profiles.ts", "utf8");
  const picker = readFileSync("app/components/catalog-course-picker.tsx", "utf8");
  assert.doesNotMatch(engine, /la vista|campestre/i);
  assert.doesNotMatch(picker, /la vista|campestre/i);
});

test("GHIN profile refresh TTL uses local snapshots, bounds configuration and keeps manual refresh explicit", () => {
  const now = Date.parse("2026-09-28T12:00:00.000Z");
  assert.equal(ghinProfileRefreshTtlSeconds({ GHIN_PROFILE_REFRESH_TTL_SECONDS: "60" }), 900);
  assert.equal(ghinProfileRefreshTtlSeconds({ GHIN_PROFILE_REFRESH_TTL_SECONDS: String(99 * 24 * 3600) }), 7 * 24 * 3600);
  assert.deepEqual(ghinProfileRefreshPolicy({
    lastSuccessfulSyncAt: "2026-09-28T11:00:00.000Z",
    hasUsableSession: true,
    now,
    env: { GHIN_PROFILE_REFRESH_TTL_SECONDS: "21600" },
  }), { ttlSeconds: 21600, state: "FRESH", refreshDue: false, canRefreshWithoutReauth: true, manualRefreshForcesUpstream: true });
  assert.equal(ghinProfileRefreshPolicy({
    lastSuccessfulSyncAt: "2026-09-27T11:00:00.000Z",
    hasUsableSession: false,
    now,
    env: { GHIN_PROFILE_REFRESH_TTL_SECONDS: "21600" },
  }).state, "STALE");
});
