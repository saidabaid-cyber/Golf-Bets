import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseGhinProfileResponse } from "../lib/ghin/profile";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("GHIN profile responses distinguish an absent owner link from a linked owner", () => {
  assert.deepEqual(
    parseGhinProfileResponse({ available: true, linkState: "GHIN_NOT_LINKED", profile: null }),
    { available: true, linkState: "GHIN_NOT_LINKED", profile: null },
  );
  assert.equal(parseGhinProfileResponse({ available: true, profile: null }), null);
  assert.equal(parseGhinProfileResponse({ available: true, linkState: "GHIN_LINKED", profile: null }), null);
  assert.equal(parseGhinProfileResponse({
    available: true,
    linkState: "GHIN_LINKED",
    profile: {
      ghinNumber: "90000001",
      playerName: "Legacy projection",
      clubName: null,
      homeClubName: null,
      handicapIndex: 8.1,
      status: "Active",
      revisionDate: null,
      lastSyncedAt: "2026-09-27T00:00:00.000Z",
      lastAttemptedAt: "2026-09-27T00:00:00.000Z",
      syncStatus: "SUCCESS",
      lastErrorCode: null,
      associationStatus: "SELF_ATTESTED",
    },
  }), null);
});

test("normal-user GHIN runtime cannot use the environment QA identity or client selectors", () => {
  const route = source("app/api/profile/ghin/route.ts");
  const access = source("lib/ghin/user-access.server.ts");
  const session = source("lib/ghin/user-session.server.ts");
  const ui = source("app/components/use-ghin-read-only-profile.ts");

  assert.match(route, /\.eq\("owner_id", context\.userId\)/);
  assert.match(route, /request\.nextUrl\.search[\s\S]*SELECTORS_REJECTED/);
  assert.match(route, /hasOnlyKeys\(input, \["operation", "login", "password"\]\)/);
  assert.match(route, /GHIN_NOT_LINKED/);
  assert.match(access, /authenticatedRequest\(request\)/);
  assert.match(access, /isCrossSiteRequest\(request\)/);

  for (const value of [route, access, session, ui]) {
    assert.doesNotMatch(value, /11103349|Said Abaid|said_aba@hotmail\.com/i);
    assert.doesNotMatch(value, /GHIN_TEST_LOGIN|GHIN_TEST_PASSWORD|resolveGhinRuntime/);
  }
  assert.doesNotMatch(ui, /localStorage|sessionStorage|document\.cookie/);
});

test("server session and pending confirmation stores are owner-bound and unlink clears one owner", () => {
  const session = source("lib/ghin/user-session.server.ts");
  assert.match(session, /activeSessions\.set\(session\.ownerId, activated\)/);
  assert.match(session, /const session = activeSessions\.get\(ownerId\)/);
  assert.match(session, /session\.ghinNumber !== ghinNumber/);
  assert.match(session, /pending\?\.ownerId === ownerId/);
  assert.match(session, /payload\.ownerId !== ownerId/);
  assert.match(session, /activeSessions\.delete\(ownerId\)/);
  assert.match(session, /if \(pending\.ownerId === ownerId\) pendingAuthorizations\.delete\(challengeId\)/);
  assert.match(session, /client\.discardCredentials\(\)/);
});

test("database contract proves two distinct verified owners, uniqueness and unlink isolation", () => {
  const migration = source("supabase/migrations/20260927223000_ghin_multiuser_linking.sql");
  const cleanup = source("supabase/migrations/20260928031010_migrate_legacy_self_attested_ghin.sql");
  const rls = source("supabase/tests/ghin_multiuser_linking_rls.sql");
  assert.match(migration, /unique index[\s\S]*\(provider, external_player_id\)[\s\S]*association_status = 'VERIFIED'/i);
  assert.match(migration, /player_handicap_provider_link_audit[\s\S]*enable row level security/i);
  assert.match(rls, /'90000001'[\s\S]*'90000002'/);
  assert.match(rls, /owner A can read owner B through manipulated selectors/);
  assert.match(rls, /owner B can read owner A through manipulated selectors/);
  assert.match(rls, /unlinking owner A affected owner B/);
  assert.match(cleanup, /association_status = 'VERIFIED'/);
  assert.match(cleanup, /association_status in \('LOOKUP_FOUND', 'VERIFIED', 'DISCONNECTED'\)/);
  assert.doesNotMatch(cleanup, /e55f562f-6c5c-439f-8bbc-e05e66d0d5d3|11103349|Said Abaid/i);
  assert.doesNotMatch(migration, /\b(password|bearer_token|firebase_token|cookie|authorization_header)\b/i);
  assert.match(rls, /information_schema\.columns[\s\S]*column_name ~\* '\(password\|secret\|credential\|bearer\|token\|cookie/);
});

test("legacy SELF_ATTESTED migration preserves manual intent and archives before cleanup", () => {
  const cleanup = source("supabase/migrations/20260928031010_migrate_legacy_self_attested_ghin.sql");
  const manualProjection = source("supabase/migrations/20260928033000_preserve_legacy_manual_handicap.sql");
  const archiveAt = cleanup.indexOf("insert into private.ghin_legacy_self_attested_migrations");
  const manualAt = cleanup.indexOf("insert into public.profile_completion_choices");
  const deleteAt = cleanup.indexOf("delete from public.player_handicap_provider_profiles");
  assert.ok(archiveAt >= 0 && manualAt > archiveAt && deleteAt > manualAt);
  assert.match(cleanup, /when choices\.handicap_choice = 'MANUAL' then choices\.manual_hcp/);
  assert.match(cleanup, /where public\.profile_completion_choices\.handicap_choice is null/);
  assert.match(cleanup, /EXISTING_MANUAL_PRESERVED/);
  assert.match(cleanup, /LEGACY_VALUE_MIGRATED_TO_MANUAL/);
  assert.match(cleanup, /enable row level security/);
  assert.match(cleanup, /revoke all on private\.ghin_legacy_self_attested_migrations[\s\S]*authenticated/);
  assert.doesNotMatch(cleanup, /\b(password|bearer_token|firebase_token|cookie|authorization_header|raw_response)\b/i);
  assert.match(manualProjection, /choices\.handicap_choice = 'MANUAL'/);
  assert.match(manualProjection, /profile\.default_handicap is null/);
  assert.match(manualProjection, /public\.user_preferences\.default_handicap is null/);
  assert.match(manualProjection, /canonical_manual_handicap/);
  assert.doesNotMatch(manualProjection, /legacy_handicap_index[\s\S]*set default_handicap/i);
});

test("QA hardcodes are confined to the protected admin diagnostic and isolated POC", () => {
  const normalRoute = source("app/api/profile/ghin/route.ts");
  const adminRoute = source("app/api/admin/dev/ghin/route.ts");
  const adminAccess = source("lib/ghin/qa-access.server.ts");
  assert.doesNotMatch(normalRoute, /11103349|GHIN_TEST_LOGIN|GHIN_TEST_PASSWORD/);
  assert.match(adminRoute, /11103349/);
  assert.match(adminRoute, /resolveGhinRuntime\(\)/);
  assert.match(adminAccess, /admin_memberships/);
});
