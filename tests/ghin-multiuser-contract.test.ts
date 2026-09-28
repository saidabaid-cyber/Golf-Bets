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
  const rls = source("supabase/tests/ghin_multiuser_linking_rls.sql");
  assert.match(migration, /unique index[\s\S]*\(provider, external_player_id\)[\s\S]*association_status = 'VERIFIED'/i);
  assert.match(migration, /player_handicap_provider_link_audit[\s\S]*enable row level security/i);
  assert.match(rls, /'90000001'[\s\S]*'90000002'/);
  assert.match(rls, /owner A can read owner B through manipulated selectors/);
  assert.match(rls, /owner B can read owner A through manipulated selectors/);
  assert.match(rls, /unlinking owner A affected owner B/);
  assert.doesNotMatch(migration, /\b(password|bearer_token|firebase_token|cookie|authorization_header)\b/i);
  assert.match(rls, /information_schema\.columns[\s\S]*column_name ~\* '\(password\|secret\|credential\|bearer\|token\|cookie/);
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
