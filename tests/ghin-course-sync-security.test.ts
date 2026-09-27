import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("course sync is Preview/admin/QA bound and never exposes score posting", () => {
  const route = source("app/api/admin/dev/ghin/course-sync/route.ts");
  assert.match(route, /VERCEL_ENV\s*!==\s*"preview"/);
  assert.match(route, /admin_memberships/);
  assert.match(route, /isolatedPreviewDatabaseEnabled/);
  assert.match(route, /GHIN_COURSE_SYNC_NOT_CONFIRMED/);
  assert.doesNotMatch(route, /scores\/hbh\.json/);
  assert.doesNotMatch(route, /\.postScore|postGhinScoreExactlyOnce/);
});

test("GHIN schema stores normalized evidence but no secret or raw response", () => {
  const migration = source("supabase/migrations/20260927195527_ghin_course_sync_and_posting_guard.sql");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /unique \(owner_id, fingerprint\)/);
  assert.match(migration, /unique \(round_id, golfer_id\)/);
  assert.match(migration, /MISSING_REAL_HOLE_CONFIGURATION/);
  assert.doesNotMatch(migration, /\b(password|bearer_token|firebase_token|authorization_header|raw_response|cookie)\s+(text|json|jsonb|bytea)/i);
});

test("live GHIN client remains read-only", () => {
  const client = source("lib/ghin/client.ts");
  assert.doesNotMatch(client, /scores\/hbh\.json/);
  assert.doesNotMatch(client, /postScore|publishScore/i);
});
