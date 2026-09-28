import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { NormalizedGhinGolfer } from "../lib/ghin/core";
import type { GhinProfileProjection } from "../lib/ghin/profile";
import { failedAttemptStatus, providerRowToProfile, verifiedProviderWrite } from "../lib/ghin/profile-persistence";
import { selectedHandicapIndex } from "../lib/handicap-source";

const profile: GhinProfileProjection = {
  ghinNumber: "11103349",
  playerName: "Said Abaid Taja",
  clubName: "LA Vista Country Club",
  homeClubName: "LA Vista Country Club",
  handicapIndex: 7.9,
  status: "Active",
  revisionDate: "2026-09-24T00:00:00.000Z",
  lastSyncedAt: "2026-09-27T12:00:00.000Z",
  lastAttemptedAt: "2026-09-27T12:00:00.000Z",
  syncStatus: "SUCCESS",
  lastErrorCode: null,
  associationStatus: "VERIFIED",
};

test("a persisted GHIN source supplies the round/profile index while a missing projection stays null", () => {
  const preference = {
    version: 1 as const,
    userId: "owner",
    enabled: false,
    handicapSource: "GHIN" as const,
    localPccZeroDeclaredAt: null,
    updatedAt: "2026-09-27T12:00:00.000Z",
  };
  assert.deepEqual(selectedHandicapIndex(preference, [], "owner", profile), { source: "GHIN", value: 7.9 });
  assert.deepEqual(selectedHandicapIndex(preference, [], "owner", null), { source: "GHIN", value: null });
  assert.deepEqual(selectedHandicapIndex(preference, [], "another", profile), { source: null, value: null });
});

test("persistence allowlist contains provider data but no password, Firebase or bearer material", () => {
  const golfer: NormalizedGhinGolfer = {
    ghinNumber: "11103349",
    externalPlayerId: "internal-provider-id",
    name: "Said Abaid Taja",
    firstName: "Said",
    lastName: "Abaid Taja",
    clubName: "Secondary Club",
    homeClubName: "LA Vista Country Club",
    isHomeClub: true,
    associationName: null,
    handicapIndex: 7.9,
    status: "active",
    rawStatus: "Active",
    isActive: true,
    updatedAt: "2026-09-24",
  };
  const write = verifiedProviderWrite("owner", golfer, "2026-09-27T12:00:00.000Z");
  assert.equal(write.external_player_id, "11103349");
  assert.equal(write.provider_club_name, "Secondary Club");
  assert.equal(write.provider_home_club_name, "LA Vista Country Club");
  assert.equal(write.association_status, "VERIFIED");
  assert.equal(write.handicap_index, 7.9);
  assert.equal(write.provider_updated_at, "2026-09-24T00:00:00.000Z");
  assert.doesNotMatch(Object.keys(write).join(" "), /password|token|cookie|authorization|raw.response/i);
});

test("failed refresh status is sanitized and retained rows continue to expose the last successful index", () => {
  assert.equal(failedAttemptStatus("unauthorized"), "AUTH_FAILED");
  assert.equal(failedAttemptStatus("rate_limited"), "RATE_LIMITED");
  assert.equal(failedAttemptStatus("timeout"), "TIMEOUT");
  const projected = providerRowToProfile({
    external_player_id: "11103349",
    association_status: "VERIFIED",
    provider_player_name: "Said Abaid Taja",
    provider_club_name: "LA Vista Country Club",
    provider_home_club_name: "LA Vista Country Club",
    provider_player_status: "Active",
    handicap_index: 7.9,
    handicap_effective_at: "2026-09-24T00:00:00.000Z",
    provider_updated_at: "2026-09-24T00:00:00.000Z",
    last_successful_sync_at: "2026-09-27T12:00:00.000Z",
    last_attempted_sync_at: "2026-09-27T13:00:00.000Z",
    last_attempt_status: "UNAVAILABLE",
    last_error_code: "UNAVAILABLE",
  });
  assert.equal(projected.handicapIndex, 7.9);
  assert.equal(projected.syncStatus, "UNAVAILABLE");
});

test("profile routes are Preview/user guarded, owner-keyed and never fall back to QA credentials", () => {
  const access = readFileSync("lib/ghin/user-access.server.ts", "utf8");
  const profileRoute = readFileSync("app/api/profile/ghin/route.ts", "utf8");
  const scoreRoute = readFileSync("app/api/profile/ghin/scores/route.ts", "utf8");
  const sessions = readFileSync("lib/ghin/user-session.server.ts", "utf8");
  const client = readFileSync("lib/ghin/client.ts", "utf8");
  assert.match(access, /capabilities\.previewOnly/);
  assert.match(access, /capabilities\.readOnlyEnabled/);
  assert.match(access, /authenticatedRequest\(request\)/);
  assert.doesNotMatch(access, /admin_memberships/);
  assert.match(access, /isCrossSiteRequest\(request\)/);
  assert.match(profileRoute, /context\.userId/);
  assert.match(profileRoute, /player_handicap_provider_profiles/);
  assert.match(profileRoute, /\.eq\("association_status", "VERIFIED"\)/);
  assert.match(profileRoute, /operation === "authorize"/);
  assert.match(profileRoute, /operation === "confirm"/);
  assert.match(profileRoute, /operation === "reauthorize"/);
  assert.match(profileRoute, /operation === "unlink"/);
  assert.match(profileRoute, /operation === "scores"/);
  assert.match(sessions, /client\.discardCredentials\(\)/);
  assert.match(scoreRoute, /ROUTE_MOVED/);
  for (const source of [profileRoute, scoreRoute, sessions, client]) {
    assert.doesNotMatch(source, /(?:post|create|update|delete|submit)Score\s*\(/i);
    assert.doesNotMatch(source, /POST\s+\/scores(?:\.json|\/)/i);
  }
  assert.doesNotMatch(`${profileRoute}\n${scoreRoute}\n${sessions}`, /GHIN_TEST_LOGIN|GHIN_TEST_PASSWORD|resolveGhinRuntime|golfer_user_token|authToken\.token/);
});

test("existing migration is owner-readable, service-write-only and contains no secret columns", () => {
  const migration = readFileSync("supabase/migrations/20260924010000_ghin_provider_foundation.sql", "utf8");
  assert.match(migration, /player_handicap_provider_profiles_owner_read/);
  assert.match(migration, /grant select on public\.player_handicap_provider_profiles to authenticated/);
  assert.match(migration, /grant select, insert, update, delete[\s\S]*to service_role/);
  assert.match(migration, /failed refresh[\s\S]*last_successful_sync_at := old\.last_successful_sync_at/i);
  assert.doesNotMatch(migration, /\b(password|bearer_token|firebase_token|cookie|authorization_header)\b/i);
});

test("multiuser migration enforces verified identity uniqueness and stores no secrets", () => {
  const migration = readFileSync("supabase/migrations/20260927223000_ghin_multiuser_linking.sql", "utf8");
  assert.match(migration, /association_status in \('LOOKUP_FOUND', 'SELF_ATTESTED', 'VERIFIED', 'DISCONNECTED'\)/);
  assert.match(migration, /create unique index if not exists player_handicap_provider_profiles_provider_player_unique/);
  assert.match(migration, /where association_status = 'VERIFIED'/);
  assert.match(migration, /player_handicap_provider_link_audit/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /unlink_ghin_profile_v1/);
  assert.doesNotMatch(migration, /\b(password|bearer_token|firebase_token|cookie|authorization_header)\b/i);
});
