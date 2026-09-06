import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260906193435_equipment_ball_fitting.sql";
const sql = readFileSync(migrationPath, "utf8");

const catalogTables = [
  "golf_ball_catalog",
  "golf_club_catalog",
  "golf_shaft_catalog",
] as const;

const ownerTables = [
  "player_equipment_profiles",
  "player_clubs",
  "player_balls",
  "ball_fit_sessions",
  "ball_fit_recommendations",
  "launch_monitor_shots",
] as const;

test("la migración de equipo es aditiva y no modifica rondas, apuestas o histórico", () => {
  assert.match(sql, /^-- The Backyard equipment/m);
  assert.match(sql, /\bbegin;[\s\S]*\bcommit;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:delete\s+from|truncate|drop\s+table|alter\s+table\s+public\.(?:rounds|tournament|bets|history))\b/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.(?:golf_ball_catalog|golf_club_catalog|golf_shaft_catalog)/i);
});

test("catálogos y datos opcionales tienen modelos normalizados y referencias estables", () => {
  for (const table of [...catalogTables, ...ownerTables]) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  }

  assert.match(sql, /compression smallint check \(compression is null/);
  assert.match(sql, /driver_spin text check/);
  assert.match(sql, /short_game_spin text check/);
  assert.match(sql, /verified_at timestamptz/);
  assert.match(sql, /official_url text check/);
  assert.match(sql, /source_url text not null check/);
  assert.match(sql, /catalog_club_id text references public\.golf_club_catalog\(id\) on delete restrict/);
  assert.match(sql, /shaft_id text references public\.golf_shaft_catalog\(id\) on delete restrict/);
  assert.match(sql, /catalog_ball_id text references public\.golf_ball_catalog\(id\) on delete restrict/);
  assert.match(sql, /local_id text not null check/);
  assert.match(sql, /set_composition text\[\]/);
  assert.match(sql, /constraint player_clubs_catalog_or_manual_check/);
  assert.match(sql, /constraint player_balls_catalog_or_manual_check/);
});

test("el fitting rápido es opcional, guardable como borrador y conserva top 3 verificable", () => {
  const fitting = sql.slice(sql.indexOf("create table public.ball_fit_sessions"));
  assert.match(fitting, /status text not null default 'DRAFT'/);
  assert.match(fitting, /fit_mode text not null default 'QUICK'/);
  assert.match(fitting, /launch_monitor_source text check/);
  assert.match(fitting, /driver_swing_speed text/);
  assert.match(fitting, /feel_preference text/);
  assert.match(fitting, /trajectory_preference text/);
  assert.match(fitting, /greens_condition text/);
  assert.match(fitting, /priorities text\[\]/);
  assert.match(fitting, /price_preference text/);
  assert.match(fitting, /jsonb_array_length\(recommendations\) <= 3/);
  assert.match(fitting, /algorithm_version text not null default 'backyard-ball-fit-v1'/);
  assert.match(fitting, /rank smallint not null check \(rank between 1 and 3\)/);
  assert.match(fitting, /match_score numeric\(5,2\) not null check \(match_score between 0 and 100\)/);
});

test("launch monitor soporta el protocolo avanzado y exclusión sin borrar golpes", () => {
  const shots = sql.slice(sql.indexOf("create table public.launch_monitor_shots"));
  for (const slot of ["DRIVER", "IRON_7", "PITCHING_WEDGE", "HALF_WEDGE"]) {
    assert.match(shots, new RegExp(`'${slot}'`));
  }
  for (const field of [
    "club_speed_mph",
    "ball_speed_mph",
    "launch_angle_degrees",
    "spin_rpm",
    "carry_yards",
    "total_yards",
    "peak_height_yards",
    "landing_angle_degrees",
  ]) {
    assert.match(shots, new RegExp(`${field} numeric`));
  }
  assert.match(shots, /excluded boolean not null default false/);
  assert.match(shots, /notes text check/);
  assert.match(shots, /unique \(session_id, club_slot, shot_index\)/);
  assert.doesNotMatch(shots, /grant\s+delete/i);
});

test("el snapshot canónico exige propietario, tamaño, esquema y CAS", () => {
  assert.match(sql, /create table public\.player_equipment_profiles/);
  assert.match(sql, /snapshot jsonb not null check \(jsonb_typeof\(snapshot\) = 'object'\)/);
  assert.match(sql, /player_equipment_profiles_snapshot_owner_check/);
  assert.match(sql, /snapshot ->> 'userId' = user_id::text/);
  assert.match(sql, /player_equipment_profiles_snapshot_schema_check/);
  assert.match(sql, /pg_column_size\(snapshot\) <= 1000000/);
  assert.match(sql, /version bigint not null default 1/);
  assert.match(sql, /expected_version bigint/);
  assert.match(sql, /last_mutation_id uuid not null/);
  assert.match(sql, /message = 'equipment_profile_version_conflict'/);
  assert.match(sql, /message = 'equipment_profile_mutation_id_reused'/);
  assert.match(sql, /new\.expected_version := null/);
  assert.match(sql, /create trigger player_equipment_profiles_cas/);
  assert.doesNotMatch(sql, /security\s+definer/i);
});

test("RLS usa auth.uid para propietarios y app_metadata inmutable para admins", () => {
  for (const table of catalogTables) {
    assert.match(sql, new RegExp(`create policy ${table}_authenticated_read`));
    assert.match(sql, new RegExp(`create policy ${table}_admin_insert`));
    assert.match(sql, new RegExp(`create policy ${table}_admin_update`));
  }
  assert.match(sql, /\(select auth\.jwt\(\)\) -> 'app_metadata' ->> 'role'/);
  assert.doesNotMatch(sql, /->\s*'user_metadata'/);

  for (const table of ownerTables) {
    assert.match(sql, new RegExp(`create policy ${table}_owner_read[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)`));
    assert.match(sql, new RegExp(`create policy ${table}_owner_insert[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)`));
    assert.match(sql, new RegExp(`create policy ${table}_owner_update[\\s\\S]*?using \\(user_id = \\(select auth\\.uid\\(\\)\\)\\)[\\s\\S]*?with check \\(user_id = \\(select auth\\.uid\\(\\)\\)\\)`));
  }
});

test("grants de Data API son explícitos pero ningún cliente puede borrar", () => {
  assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant select, insert, update on table[\s\S]*public\.golf_ball_catalog[\s\S]*to authenticated;/);
  assert.match(sql, /grant select on table[\s\S]*public\.player_equipment_profiles[\s\S]*to authenticated;/);
  assert.doesNotMatch(sql, /grant\s+(?:select,\s*)?insert[^;]*public\.player_equipment_profiles[^;]*to authenticated/i);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*to authenticated/i);
  assert.match(sql, /grant select, insert, update on table[\s\S]*public\.player_equipment_profiles[\s\S]*to service_role;/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*to service_role/i);
  assert.doesNotMatch(sql, /create policy[^;]+for delete/i);

  const contract = readFileSync("supabase/tests/equipment_ball_fitting_rls.sql", "utf8");
  assert.match(contract, /has_table_privilege\('anon'/);
  assert.match(contract, /has_table_privilege\('authenticated',[\s\S]*'DELETE'\)/);
  assert.match(contract, /has_table_privilege\('service_role',[\s\S]*'UPDATE'\)/);
  assert.match(contract, /catalog admin policy is not based exclusively on app_metadata/);
  assert.match(contract, /owner policy does not derive identity from auth\.uid\(\)/);
  assert.match(contract, /rollback;\s*$/i);
});
