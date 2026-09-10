-- Phase 2B: additive player tee preferences and immutable course-handicap snapshots.
-- This migration must be applied only during a controlled Preview/Beta DB window.

create table if not exists public.player_course_tee_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_key text not null,
  course_id text not null,
  tee_id text not null,
  source text not null check (source in ('PLAYER_COURSE', 'LAST_USED', 'GROUP_DEFAULT')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, player_key, course_id, source)
);

create table if not exists public.round_course_handicap_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  round_id text not null,
  player_key text not null,
  tee_id text not null,
  tee_name text not null,
  index_value numeric not null check (index_value between -15 and 36),
  index_source text not null check (index_source in ('BACKYARD_MANUAL', 'BACKYARD_WHS_FUTURE', 'GHIN_OFFICIAL_FUTURE')),
  slope integer not null check (slope between 55 and 155),
  course_rating numeric not null check (course_rating between 40 and 100),
  course_par integer not null check (course_par between 27 and 90),
  course_handicap integer not null,
  formula_version text not null,
  effective_at timestamptz not null,
  calculated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, round_id, player_key)
);

create index if not exists player_course_tee_preferences_lookup_idx
  on public.player_course_tee_preferences (user_id, player_key, course_id, updated_at desc);
create index if not exists round_course_handicap_snapshots_round_idx
  on public.round_course_handicap_snapshots (user_id, round_id);

alter table public.player_course_tee_preferences enable row level security;
alter table public.round_course_handicap_snapshots enable row level security;

revoke all on public.player_course_tee_preferences from anon, authenticated;
revoke all on public.round_course_handicap_snapshots from anon, authenticated;
grant select, insert, update, delete on public.player_course_tee_preferences to authenticated;
grant select, insert on public.round_course_handicap_snapshots to authenticated;

drop policy if exists "tee preferences select own" on public.player_course_tee_preferences;
create policy "tee preferences select own" on public.player_course_tee_preferences for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "tee preferences insert own" on public.player_course_tee_preferences;
create policy "tee preferences insert own" on public.player_course_tee_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "tee preferences update own" on public.player_course_tee_preferences;
create policy "tee preferences update own" on public.player_course_tee_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "tee preferences delete own" on public.player_course_tee_preferences;
create policy "tee preferences delete own" on public.player_course_tee_preferences for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "course handicap snapshots select own" on public.round_course_handicap_snapshots;
create policy "course handicap snapshots select own" on public.round_course_handicap_snapshots for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "course handicap snapshots insert own" on public.round_course_handicap_snapshots;
create policy "course handicap snapshots insert own" on public.round_course_handicap_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
