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
  assert.match(route, /GHIN_LA_VISTA_MAPPING_NOT_CONFIRMED/);
  assert.match(route, /details\.data\.facilityId === "19886"/);
  assert.doesNotMatch(route, /scores\/hbh\.json/);
  assert.doesNotMatch(route, /\.postScore|postGhinScoreExactlyOnce/);
});

test("course sync upserts stable identities and verifies idempotent provider links", () => {
  const persistence = source("lib/ghin/course-sync.server.ts");
  assert.match(persistence, /golf_clubs"\)\.upsert\(facilityRow, \{ onConflict: "id" \}/);
  assert.match(persistence, /golf_courses"\)\.upsert\(courseRow, \{ onConflict: "id" \}/);
  assert.match(persistence, /golf_holes"\)\.upsert\(plan\.holes, \{ onConflict: "id" \}/);
  assert.match(persistence, /golf_course_tees"\)\.upsert\(plan\.tees, \{ onConflict: "id" \}/);
  assert.match(persistence, /onConflict: "course_id,provider"/);
  assert.match(persistence, /onConflict: "tee_id,provider"/);
  assert.doesNotMatch(persistence, /from\("rounds_cloud"\)|from\("round_players"\)|delete\(/);
});

test("provisional layouts remain separate and non-postable in the QA catalog", () => {
  const migration = source("supabase/migrations/20260927195527_ghin_course_sync_and_posting_guard.sql");
  assert.match(migration, /course-la-vista-temporary-par-70/);
  assert.match(migration, /course-la-vista-temporary-par-69/);
  assert.match(migration, /BACKYARD_PROVISIONAL/);
  assert.match(migration, /MISSING_REAL_HOLE_CONFIGURATION/);
  const picker = source("app/components/round-tee-picker.tsx");
  assert.match(picker, /No disponible para publicación GHIN/);
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
