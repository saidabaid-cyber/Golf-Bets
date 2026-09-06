import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260906211937_golf_profile_course_architecture.sql";
const sql = readFileSync(migrationPath, "utf8");
const rlsContractSql = readFileSync("supabase/tests/golf_profile_course_architecture_rls.sql", "utf8");

const newTables = [
  "golf_ball_brands",
  "golf_club_brands",
  "golf_ball_test_results",
  "player_club_distances",
  "golf_clubs",
  "golf_courses",
  "golf_course_tees",
  "golf_holes",
  "golf_tee_hole_yardages",
  "golf_hole_geo_features",
  "player_favorite_courses",
  "player_recent_courses",
] as const;

const catalogTables = [
  "golf_ball_brands",
  "golf_club_brands",
  "golf_ball_test_results",
] as const;

const courseTables = [
  "golf_clubs",
  "golf_courses",
  "golf_course_tees",
  "golf_holes",
  "golf_tee_hole_yardages",
  "golf_hole_geo_features",
] as const;

test("la fase golfística es aditiva y conserva identidad, rondas, apuestas e histórico", () => {
  assert.match(sql, /^-- The Backyard golf profile/m);
  assert.match(sql, /\bbegin;[\s\S]*\bcommit;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:delete\s+from|truncate|drop\s+table)\b/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.(?:rounds_cloud|round_players_cloud|round_scores_cloud|tournaments|tournament_scores|round_bet_configs|round_bet_results)/i);
  assert.doesNotMatch(sql, /create\s+table\s+public\.(?:ball_fit_sessions|launch_monitor_shots|profiles|players)\b/i);
  assert.match(sql, /alter table public\.profiles[\s\S]*add column if not exists typical_score/);
  assert.match(sql, /comment on column public\.profiles\.default_handicap[\s\S]*single optional golfer Handicap Index/);
});

test("Mi juego y el histórico de equipo amplían los modelos existentes", () => {
  for (const field of [
    "given_name",
    "family_name",
    "username",
    "city",
    "state",
    "country",
    "home_club",
    "preferred_tee",
    "handedness",
    "bio",
    "profile_visibility",
    "typical_score",
    "driver_distance_yards",
    "driver_swing_speed_band",
    "usual_trajectory",
    "shot_tendency",
    "green_speed",
    "game_priority",
    "price_importance",
    "golf_profile_updated_at",
  ]) assert.match(sql, new RegExp(`add column if not exists ${field}`));

  assert.match(sql, /driver_swing_speed_band is null or driver_swing_speed_band in \('UNDER_85', 'FROM_85_TO_95', 'FROM_95_TO_105', 'OVER_105'\)/);
  assert.match(sql, /green_speed is null or green_speed in \('SLOW', 'MID', 'FAST', 'VARIABLE'\)/);
  assert.match(sql, /price_importance is null or price_importance in \('LOW', 'MID', 'HIGH'\)/);
  assert.match(sql, /handedness is null or handedness in \('right', 'left', 'ambidextrous'\)/);
  assert.match(sql, /username is null or \(username = trim\(username\) and length\(username\) between 1 and 40\)/);
  assert.match(sql, /create unique index profiles_username_unique_idx on public\.profiles \(lower\(trim\(username\)\)\)/);
  assert.doesNotMatch(sql, /driver_swing_speed_mph|golf_handedness|usual_green_speed/);

  assert.match(sql, /alter table public\.player_clubs[\s\S]*custom_shaft_brand[\s\S]*custom_shaft_model[\s\S]*started_using_at[\s\S]*stopped_using_at/);
  assert.match(sql, /player_clubs_current_usage_check/);
  assert.match(sql, /alter table public\.player_balls[\s\S]*started_using_at[\s\S]*stopped_using_at[\s\S]*notes text/);
  assert.match(sql, /player_balls_current_usage_check/);
});

test("catálogos enriquecidos conservan fuente y desconocidos como null", () => {
  for (const field of [
    "brand_id",
    "year_from",
    "year_to",
    "construction_pieces",
    "dimple_count",
    "compression_type",
    "compression_source",
    "compression_min",
    "compression_max",
    "compression_average",
    "feel_profile",
    "recommended_swing_speed_min_mph",
    "recommended_swing_speed_max_mph",
    "target_player_description",
    "usga_conforming",
  ]) assert.match(sql, new RegExp(`add column if not exists ${field}`));

  assert.match(sql, /compression_type is null or compression_type in \('MANUFACTURER', 'INDEPENDENT_MEASURED', 'ESTIMATED', 'UNKNOWN'\)/);
  assert.doesNotMatch(sql, /compression_type text[^;]*default\s+'(?:ESTIMATED|MANUFACTURER)'/i);
  assert.match(sql, /golf_ball_catalog_compression_average_check/);
  assert.match(sql, /golf_ball_catalog_compression_provenance_check[\s\S]*compression_type is not null[\s\S]*compression_type in \('MANUFACTURER', 'INDEPENDENT_MEASURED', 'ESTIMATED'\)[\s\S]*compression_source is not null[\s\S]*compression_source_url is not null[\s\S]*not valid/);
  assert.match(sql, /create or replace function public\.canonicalize_golf_catalog_brand\(\)/);
  assert.match(sql, /if new\.brand_id is null[\s\S]*if tg_op = 'INSERT'[\s\S]*elsif old\.brand_id is not null[\s\S]*elsif new\.brand is distinct from old\.brand/);
  assert.match(sql, /new\.brand := canonical_name/);
  assert.match(sql, /create trigger golf_ball_catalog_canonical_brand[\s\S]*create trigger golf_club_catalog_canonical_brand/);
  assert.match(sql, /create or replace function public\.cascade_golf_catalog_brand_name\(\)/);
  assert.match(sql, /update public\.golf_ball_catalog[\s\S]*set brand = new\.name[\s\S]*update public\.golf_club_catalog[\s\S]*set brand = new\.name/);
  assert.match(sql, /create trigger golf_ball_brands_cascade_name[\s\S]*create trigger golf_club_brands_cascade_name/);
  assert.match(sql, /golf_ball_test_results[\s\S]*source_url text not null[\s\S]*source_license[\s\S]*verified_at timestamptz not null/);
});

test("distancias son owner-scoped, trazables y no reemplazan el snapshot CAS", () => {
  assert.match(sql, /create table public\.player_club_distances/);
  assert.match(sql, /foreign key \(user_id, player_club_local_id\)[\s\S]*references public\.player_clubs\(user_id, local_id\)/);
  for (const source of ["MANUAL", "ROUND_ESTIMATE", "LAUNCH_MONITOR", "GPS", "IMPORT"]) {
    assert.match(sql, new RegExp(`'${source}'`));
  }
  assert.match(sql, /unique \(user_id, player_club_local_id, source\)/);
  assert.match(sql, /unit text not null default 'YD' check \(unit in \('YD', 'M'\)\)/);
  assert.match(sql, /sample_count integer check \(sample_count is null or sample_count between 1 and 1000000\)/);
  assert.match(sql, /confidence numeric\(5,2\) check \(confidence is null or confidence between 0 and 100\)/);
  assert.match(sql, /carry_distance numeric\(7,2\) check \(carry_distance is null or carry_distance between 0 and 800\)/);
  assert.match(sql, /total_distance numeric\(7,2\) check \(total_distance is null or total_distance between 0 and 800\)/);
  assert.match(sql, /player_club_distances_order_check[\s\S]*total_distance >= carry_distance/);
  assert.match(sql, /grant select on table public\.player_club_distances to authenticated/);
  assert.doesNotMatch(sql, /grant[^;]*insert[^;]*public\.player_club_distances[^;]*to authenticated/i);
  assert.match(sql, /player_equipment_profiles\.snapshot until a transactional projector/i);
  assert.match(sql, /alter table public\.player_equipment_profiles[\s\S]*alter column schema_version set default 2/);
});

test("las pruebas de bola conservan desconocidos y unidades explícitas", () => {
  assert.match(sql, /test_year smallint check \(test_year is null or test_year between 1900 and 2200\)/);
  assert.doesNotMatch(sql, /test_year smallint not null/i);
  assert.match(sql, /peak_height_yards numeric\(6,2\)/);
  assert.doesNotMatch(sql, /peak_height_feet/);
  assert.match(sql, /swing_speed_mph[^\n]*between 20 and 180/);
  assert.match(sql, /ball_speed_mph[^\n]*between 20 and 250/);
  assert.match(sql, /launch_angle_degrees[\s\S]*between -20 and 90/);
  assert.match(sql, /spin_rate_rpm[^\n]*between 0 and 20000/);
  assert.match(sql, /carry_yards[^\n]*between 0 and 500/);
  assert.match(sql, /total_yards[^\n]*between 0 and 600/);
  assert.match(sql, /peak_height_yards[\s\S]*between 0 and 300/);
  assert.match(sql, /descent_angle_degrees[\s\S]*between -20 and 90/);
  assert.match(sql, /dispersion_yards[^\n]*between 0 and 250/);
});

test("la arquitectura de campos separa club, course, tee, hoyo, yardaje y geometría", () => {
  for (const table of newTables) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
  assert.match(sql, /golf_clubs_coordinate_pair_check/);
  assert.match(sql, /golf_courses_coordinate_pair_check/);
  assert.match(sql, /foreign key \(tee_id, course_id\)[\s\S]*references public\.golf_course_tees\(id, course_id\)/);
  assert.match(sql, /foreign key \(hole_id, course_id\)[\s\S]*references public\.golf_holes\(id, course_id\)/);
  assert.match(sql, /create table public\.golf_clubs \([\s\S]*?id text primary key default gen_random_uuid\(\)::text/);
  assert.match(sql, /create table public\.golf_courses \([\s\S]*?id text primary key default gen_random_uuid\(\)::text[\s\S]*?club_id text not null/);
  assert.match(sql, /create table public\.golf_course_tees \([\s\S]*?id text primary key default gen_random_uuid\(\)::text[\s\S]*?course_id text not null/);
  assert.doesNotMatch(sql, /check \(length\(trim\(id\)\) between 3 and (?:240|300)\)/);
  assert.match(sql, /unique \(course_id, stroke_index\)/);
  assert.match(sql, /geometry jsonb check \(geometry is null or jsonb_typeof\(geometry\) = 'object'\)/);
  assert.match(sql, /golf_hole_geo_features_location_check/);
  assert.match(sql, /alter table public\.courses_cloud[\s\S]*catalog_course_id text[\s\S]*catalog_tee_id text/);
  assert.match(sql, /courses_cloud_catalog_tee_course_fk[\s\S]*foreign key \(catalog_tee_id, catalog_course_id\)[\s\S]*references public\.golf_course_tees\(id, course_id\)/);
  assert.match(sql, /courses_cloud_catalog_tee_requires_course_check[\s\S]*catalog_tee_id is null or catalog_course_id is not null/);
});

test("búsqueda, proveedores y claves foráneas tienen índices escalables", () => {
  assert.match(sql, /create extension if not exists pg_trgm with schema extensions/);
  for (const index of [
    "golf_ball_catalog_search_idx",
    "golf_club_catalog_search_idx",
    "golf_shaft_catalog_search_idx",
    "golf_clubs_search_idx",
    "golf_courses_search_idx",
  ]) assert.match(sql, new RegExp(`create index ${index}`));
  for (const index of [
    "golf_clubs_provider_external_idx",
    "golf_courses_provider_external_idx",
    "golf_course_tees_provider_external_idx",
    "golf_holes_provider_external_idx",
    "golf_tee_hole_yardages_provider_external_idx",
    "golf_hole_geo_features_provider_external_idx",
  ]) assert.match(sql, new RegExp(`create unique index ${index}`));
  assert.match(sql, /golf_clubs_coordinates_idx/);
  assert.match(sql, /golf_courses_coordinates_idx/);
  assert.match(sql, /player_favorite_courses_course_idx/);
  assert.match(sql, /player_recent_courses_user_recency_idx/);
});

test("RLS separa propietarios y admin inmutable, nunca user metadata", () => {
  assert.match(sql, /\(select auth\.jwt\(\)\) -> 'app_metadata' ->> 'role'/);
  assert.doesNotMatch(sql, /user_metadata/i);

  for (const table of catalogTables) {
    assert.match(sql, new RegExp(`create policy ${table}_authenticated_read`));
    assert.match(sql, new RegExp(`create policy ${table}_admin_insert`));
    assert.match(sql, new RegExp(`create policy ${table}_admin_update`));
  }
  for (const table of courseTables) {
    assert.match(sql, new RegExp(`create policy ${table}_authenticated_read`));
    assert.match(sql, new RegExp(`create policy ${table}_authorized_insert`));
    assert.match(sql, new RegExp(`create policy ${table}_authorized_update`));
  }
  for (const table of ["player_club_distances", "player_favorite_courses", "player_recent_courses"]) {
    assert.match(sql, new RegExp(`create policy ${table}_owner_read[\\s\\S]*?\\(select auth\\.uid\\(\\)\\)`));
  }
  assert.match(sql, /provider = 'USER_MANUAL' and visibility = 'PRIVATE'/);
  assert.match(rlsContractSql, /set local role authenticated/);
  assert.match(rlsContractSql, /request\.jwt\.claims/);
  assert.match(rlsContractSql, /non-owner can read another player club distance/);
  assert.match(rlsContractSql, /non-owner can read a private manual course/);
  assert.match(rlsContractSql, /non-owner favorite write unexpectedly succeeded/);
  assert.match(rlsContractSql, /non-admin catalog write unexpectedly succeeded/);
  assert.match(rlsContractSql, /canonical catalog row lost its brand reference/);
  assert.match(rlsContractSql, /reset role;[\s\S]*rollback;/);
});

test("grants Data API son explícitos y los catálogos solo se archivan", () => {
  assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant select, insert, update on table[\s\S]*public\.golf_ball_brands[\s\S]*public\.golf_hole_geo_features[\s\S]*to authenticated;/);
  assert.match(sql, /grant select, insert, delete on table public\.player_favorite_courses to authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.player_recent_courses to authenticated;/);

  const beforePreferenceGrants = sql.slice(0, sql.indexOf("grant select, insert, delete on table public.player_favorite_courses"));
  assert.doesNotMatch(beforePreferenceGrants, /grant[^;]*delete[^;]*public\.(?:golf_ball|golf_club|golf_shaft|golf_courses|golf_course_tees|golf_holes|golf_tee_hole_yardages|golf_hole_geo_features)/i);
  assert.doesNotMatch(sql, /create policy (?:golf_ball|golf_club|golf_shaft|golf_courses|golf_course_tees|golf_holes|golf_tee_hole_yardages|golf_hole_geo_features)[^\n]*delete/i);
});
