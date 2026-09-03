-- The Backyard cloud sync + Polla Live hardening.
-- Additive/idempotent: preserves all V3 local data and existing tournament rows.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

alter table public.profiles add column if not exists onboarding_completed_at timestamptz;

alter table public.players add column if not exists local_id text;
alter table public.players add column if not exists usage_count integer not null default 0;
alter table public.players add column if not exists snapshot jsonb;
alter table public.players add column if not exists updated_at timestamptz not null default now();

alter table public.courses_cloud add column if not exists local_id text;
alter table public.courses_cloud add column if not exists snapshot jsonb;
alter table public.courses_cloud add column if not exists updated_at timestamptz not null default now();

alter table public.rounds_cloud add column if not exists local_id text;
alter table public.rounds_cloud add column if not exists updated_at timestamptz not null default now();
update public.rounds_cloud set local_id = local_round_id where local_id is null;
alter table public.round_players_cloud add column if not exists local_player_id text;

create unique index if not exists players_owner_local_uidx on public.players(owner_id, local_id);
create unique index if not exists courses_cloud_owner_local_uidx on public.courses_cloud(owner_id, local_id);
create unique index if not exists rounds_cloud_owner_local_uidx on public.rounds_cloud(owner_id, local_id);
create unique index if not exists round_players_cloud_round_local_uidx on public.round_players_cloud(round_id, local_player_id);

-- Repair legacy duplicates deterministically before enforcing one scorer and
-- one closest-to-pin result per group/hole.
with ranked_scorers as (
  select group_id, tournament_player_id,
    row_number() over (partition by group_id order by tournament_player_id) as position
  from public.group_members where is_scorer = true
)
update public.group_members as member set is_scorer = false
from ranked_scorers as ranked
where member.group_id = ranked.group_id
  and member.tournament_player_id = ranked.tournament_player_id
  and ranked.position > 1;
create unique index if not exists group_members_one_scorer_uidx on public.group_members(group_id) where is_scorer = true;

delete from public.tournament_oyes as older
using public.tournament_oyes as better
where older.tournament_id = better.tournament_id
  and older.hole = better.hole
  and (older.distance_meters > better.distance_meters
    or (older.distance_meters = better.distance_meters and older.id > better.id));
create unique index if not exists tournament_oyes_hole_uidx on public.tournament_oyes(tournament_id, hole);

create table if not exists public.frequent_groups_cloud (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  name text not null check (length(trim(name)) between 1 and 160),
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

create table if not exists public.personal_rivals_cloud (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  name text not null check (length(trim(name)) between 1 and 120),
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  unique(owner_id, local_id)
);

create table if not exists public.user_cloud_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_draft jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.cloud_deletions (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('round','frequent_player','frequent_group','rival','course')),
  local_id text not null,
  deleted_at timestamptz not null default now(),
  unique(owner_id, entity_type, local_id)
);

-- Canonical round snapshots stay in rounds_cloud. These projections make the
-- economic configuration auditable/queryable without changing the local engine.
create table if not exists public.round_bet_configs (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  config jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.round_bet_results (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  results jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.personal_bets_cloud (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  bets jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.manual_bets_cloud (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  bets jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.expenses_cloud (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  expenses jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.round_course_snapshots (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  course jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.round_local_rules_snapshots (
  round_id uuid primary key references public.rounds_cloud(id) on delete cascade,
  local_rules jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.frequent_groups_cloud enable row level security;
alter table public.personal_rivals_cloud enable row level security;
alter table public.user_cloud_state enable row level security;
alter table public.cloud_deletions enable row level security;
alter table public.round_bet_configs enable row level security;
alter table public.round_bet_results enable row level security;
alter table public.personal_bets_cloud enable row level security;
alter table public.manual_bets_cloud enable row level security;
alter table public.expenses_cloud enable row level security;
alter table public.round_course_snapshots enable row level security;
alter table public.round_local_rules_snapshots enable row level security;

drop policy if exists frequent_groups_owner on public.frequent_groups_cloud;
create policy frequent_groups_owner on public.frequent_groups_cloud for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists personal_rivals_owner on public.personal_rivals_cloud;
create policy personal_rivals_owner on public.personal_rivals_cloud for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists user_cloud_state_owner on public.user_cloud_state;
create policy user_cloud_state_owner on public.user_cloud_state for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cloud_deletions_owner on public.cloud_deletions;
create policy cloud_deletions_owner on public.cloud_deletions for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists round_bet_configs_owner on public.round_bet_configs;
create policy round_bet_configs_owner on public.round_bet_configs for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));
drop policy if exists round_bet_results_owner on public.round_bet_results;
create policy round_bet_results_owner on public.round_bet_results for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));
drop policy if exists personal_bets_cloud_owner on public.personal_bets_cloud;
create policy personal_bets_cloud_owner on public.personal_bets_cloud for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));
drop policy if exists manual_bets_cloud_owner on public.manual_bets_cloud;
create policy manual_bets_cloud_owner on public.manual_bets_cloud for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));
drop policy if exists expenses_cloud_owner on public.expenses_cloud;
create policy expenses_cloud_owner on public.expenses_cloud for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));
drop policy if exists round_course_snapshots_owner on public.round_course_snapshots;
create policy round_course_snapshots_owner on public.round_course_snapshots for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));
drop policy if exists round_local_rules_snapshots_owner on public.round_local_rules_snapshots;
create policy round_local_rules_snapshots_owner on public.round_local_rules_snapshots for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid())) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = auth.uid()));

-- Private scorecard photos. The first path segment must be auth.uid().
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('scorecard-photos', 'scorecard-photos', false, 8000000, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists scorecard_photos_read_own on storage.objects;
create policy scorecard_photos_read_own on storage.objects for select to authenticated
using (bucket_id = 'scorecard-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists scorecard_photos_insert_own on storage.objects;
create policy scorecard_photos_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'scorecard-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists scorecard_photos_update_own on storage.objects;
create policy scorecard_photos_update_own on storage.objects for update to authenticated
using (bucket_id = 'scorecard-photos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'scorecard-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists scorecard_photos_delete_own on storage.objects;
create policy scorecard_photos_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'scorecard-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Polla roles: created_by is the OWNER; tournament_access.role='admin' grants
-- additional administrators without making an enum migration unsafe.

drop policy if exists tournaments_delegated_admin on public.tournaments;
drop policy if exists groups_delegated_admin on public.tournament_groups;
drop policy if exists tournament_players_delegated_admin on public.tournament_players;
drop policy if exists scores_delegated_admin on public.tournament_scores;
drop function if exists public.is_polla_admin(uuid, uuid);

create or replace function public.is_polla_admin(p_tournament_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.tournaments t where t.id = p_tournament_id and t.created_by = auth.uid())
    or exists(select 1 from public.tournament_access a where a.tournament_id = p_tournament_id and a.user_id = auth.uid() and a.role = 'admin' and a.revoked_at is null and (a.expires_at is null or a.expires_at > now()))
$$;
revoke all on function public.is_polla_admin(uuid) from public;
grant execute on function public.is_polla_admin(uuid) to authenticated, service_role;

create policy tournaments_delegated_admin on public.tournaments for select to authenticated using (public.is_polla_admin(id));
create policy groups_delegated_admin on public.tournament_groups for select to authenticated using (public.is_polla_admin(tournament_id));
create policy tournament_players_delegated_admin on public.tournament_players for select to authenticated using (public.is_polla_admin(tournament_id));
create policy scores_delegated_admin on public.tournament_scores for select to authenticated using (public.is_polla_admin(tournament_id));

create table if not exists public.polla_join_attempts (
  id bigint generated always as identity primary key,
  public_id uuid not null,
  player_id uuid not null,
  requester_hash text not null,
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);
alter table public.polla_join_attempts enable row level security;
create index if not exists polla_join_attempts_guard_idx on public.polla_join_attempts(requester_hash, attempted_at desc);

create or replace function public.join_polla_secure(p_public_id uuid, p_player_id uuid, p_pin text, p_requester_hash text)
returns table(access_token text, tournament_id uuid, group_id uuid, role public.tournament_role, player_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_recent_failures integer;
  v_result record;
begin
  select count(*) into v_recent_failures from public.polla_join_attempts
  where requester_hash = p_requester_hash and succeeded = false and attempted_at > now() - interval '10 minutes';
  if v_recent_failures >= 10 then raise exception 'rate_limited'; end if;
  begin
    select * into v_result from public.join_polla(p_public_id, p_player_id, p_pin);
    insert into public.polla_join_attempts(public_id, player_id, requester_hash, succeeded) values(p_public_id, p_player_id, p_requester_hash, true);
    return query select v_result.access_token, v_result.tournament_id, v_result.group_id, v_result.role, v_result.player_name;
  exception when others then
    insert into public.polla_join_attempts(public_id, player_id, requester_hash, succeeded) values(p_public_id, p_player_id, p_requester_hash, false);
    return;
  end;
end $$;
revoke all on function public.join_polla_secure(uuid, uuid, text, text) from public;
grant execute on function public.join_polla_secure(uuid, uuid, text, text) to service_role;
revoke all on function public.join_polla(uuid, uuid, text) from anon, authenticated;
grant execute on function public.join_polla(uuid, uuid, text) to service_role;

create or replace function public.set_tournament_player_pin(p_player_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'invalid_pin'; end if;
  update public.tournament_players set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_player_id;
end $$;
revoke all on function public.set_tournament_player_pin(uuid, text) from public;
grant execute on function public.set_tournament_player_pin(uuid, text) to service_role;

create or replace function public.record_tournament_oyes(
  p_tournament_id uuid,
  p_hole smallint,
  p_player_id uuid,
  p_distance_meters numeric,
  p_access_id uuid,
  p_force boolean default false
)
returns table(hole smallint, player_id uuid, distance_meters numeric, accepted boolean)
language plpgsql security definer set search_path = public as $$
declare v_row public.tournament_oyes%rowtype;
begin
  insert into public.tournament_oyes(tournament_id, hole, player_id, distance_meters, access_id)
  values(p_tournament_id, p_hole, p_player_id, p_distance_meters, p_access_id)
  on conflict(tournament_id, hole) do update
    set player_id = excluded.player_id,
        distance_meters = excluded.distance_meters,
        access_id = excluded.access_id,
        entered_by = null,
        created_at = now()
    where p_force or excluded.distance_meters < public.tournament_oyes.distance_meters
  returning public.tournament_oyes.* into v_row;
  if found then
    return query select v_row.hole, v_row.player_id, v_row.distance_meters, true;
  else
    select * into v_row from public.tournament_oyes
    where tournament_id = p_tournament_id and hole = p_hole;
    return query select v_row.hole, v_row.player_id, v_row.distance_meters, false;
  end if;
end $$;
revoke all on function public.record_tournament_oyes(uuid, smallint, uuid, numeric, uuid, boolean) from public;
grant execute on function public.record_tournament_oyes(uuid, smallint, uuid, numeric, uuid, boolean) to service_role;

create or replace function public.touch_tournament_score()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists tournament_score_touch on public.tournament_scores;
create trigger tournament_score_touch before update on public.tournament_scores for each row execute function public.touch_tournament_score();

-- Realtime publishes only a revision signal. Clients refetch the sanitized API;
-- raw scores, emails, PINs and private bets are never in this public event row.
create table if not exists public.tournament_leaderboard_events (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  public_id uuid not null unique,
  is_public boolean not null default false,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.tournament_leaderboard_events add column if not exists is_public boolean not null default false;
alter table public.tournament_leaderboard_events enable row level security;
drop policy if exists leaderboard_events_public on public.tournament_leaderboard_events;
create policy leaderboard_events_public on public.tournament_leaderboard_events for select to anon, authenticated
using (is_public = true);

create or replace function public.sync_tournament_leaderboard_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tournament_leaderboard_events(tournament_id, public_id, is_public, revision, updated_at)
  values(new.id, new.public_id, new.public_leaderboard, 1, now())
  on conflict(tournament_id) do update set public_id = excluded.public_id, is_public = excluded.is_public,
    revision = public.tournament_leaderboard_events.revision + 1, updated_at = now();
  return new;
end $$;
drop trigger if exists tournament_leaderboard_event_sync on public.tournaments;
create trigger tournament_leaderboard_event_sync after insert or update of public_leaderboard on public.tournaments
for each row execute function public.sync_tournament_leaderboard_event();

insert into public.tournament_leaderboard_events(tournament_id, public_id, is_public)
select id, public_id, public_leaderboard from public.tournaments
on conflict(tournament_id) do update set public_id = excluded.public_id, is_public = excluded.is_public, updated_at = now();

create or replace function public.signal_leaderboard_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_public_id uuid; v_is_public boolean;
begin
  select public_id, public_leaderboard into v_public_id, v_is_public from public.tournaments where id = new.tournament_id;
  insert into public.tournament_leaderboard_events(tournament_id, public_id, is_public, revision, updated_at)
  values(new.tournament_id, v_public_id, v_is_public, 1, now())
  on conflict(tournament_id) do update set is_public = excluded.is_public, revision = public.tournament_leaderboard_events.revision + 1, updated_at = now();
  return new;
end $$;
drop trigger if exists tournament_score_leaderboard_signal on public.tournament_scores;
create trigger tournament_score_leaderboard_signal after insert or update on public.tournament_scores for each row execute function public.signal_leaderboard_change();
drop trigger if exists tournament_oyes_leaderboard_signal on public.tournament_oyes;
create trigger tournament_oyes_leaderboard_signal after insert or update on public.tournament_oyes for each row execute function public.signal_leaderboard_change();

do $$ begin
  alter publication supabase_realtime add table public.tournament_leaderboard_events;
exception when duplicate_object then null;
end $$;
