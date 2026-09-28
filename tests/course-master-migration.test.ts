import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260928040000_course_master_sources.sql", "utf8");
const projectionFix = readFileSync("supabase/migrations/20260928050000_course_master_projection_visibility.sql", "utf8");
const rls = readFileSync("supabase/tests/course_master_sources_rls.sql", "utf8");

test("Course Master source registry is additive, explicit and blocks unauthorized NCRDB ingestion", () => {
  assert.match(migration, /^-- Provider-agnostic Backyard Course Master/m);
  assert.match(migration, /create table public\.golf_course_data_sources/);
  assert.match(migration, /authorization_status in \('AUTHORIZED','LEGAL_REVIEW_REQUIRED','BLOCKED_EXTERNAL'\)/);
  assert.match(migration, /golf_course_data_sources_authorized_check/);
  assert.match(migration, /'USGA_NCRDB'[\s\S]+LEGAL_REVIEW_REQUIRED[\s\S]+false, false, false/);
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+table|drop\s+table/i);
});

test("Course Master projection requires auth and only includes display-authorized sources", () => {
  assert.match(migration, /create function public\.read_backyard_course_master_v1\(\)/);
  assert.match(migration, /security definer[\s\S]+set search_path = ''/);
  assert.match(migration, /if auth\.uid\(\) is null/);
  assert.match(migration, /private\.account_subject_active\(auth\.uid\(\)\)/);
  assert.match(migration, /source\.authorized_for_display = true/g);
  assert.match(migration, /revoke all on function public\.read_backyard_course_master_v1\(\) from public, anon/);
  assert.match(migration, /grant execute on function public\.read_backyard_course_master_v1\(\) to authenticated, service_role/);
  assert.doesNotMatch(migration, /GHIN_TEST_PASSWORD|golfer_user_token|authorization header/i);
});

test("private storage visibility is not mistaken for player catalog publication", () => {
  assert.match(projectionFix, /create or replace function public\.read_backyard_course_master_v1\(\)/);
  assert.match(projectionFix, /course\.provider = 'OWNER_CATALOG_REVIEW'/);
  assert.match(projectionFix, /source\.authorized_for_display = true/g);
  assert.doesNotMatch(projectionFix, /(?:course|club)\.visibility\s*=\s*'PUBLIC'/);
  assert.match(rls, /reader_definition like '%course\.visibility%'/);
});

test("new Data API table has explicit grants, RLS and executable QA contract", () => {
  assert.match(migration, /alter table public\.golf_course_data_sources enable row level security/);
  assert.match(migration, /revoke all on public\.golf_course_data_sources from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on public\.golf_course_data_sources to authenticated/);
  assert.match(migration, /grant select, insert, update, delete on public\.golf_course_data_sources to service_role/);
  assert.match(rls, /NCRDB must remain blocked pending legal authorization/);
  assert.match(rls, /Course Master reader execute grants are unsafe/);
  assert.match(rls, /rollback;/);
});
