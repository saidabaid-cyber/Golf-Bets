-- Restore Data API access for account/cloud tables on projects created after
-- Supabase stopped auto-exposing new public tables. This migration is
-- additive/idempotent: it repairs missing profiles and does not delete data.

begin;

alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add column if not exists version bigint not null default 1;
alter table public.profiles add column if not exists updated_by_device text;

alter table public.players add column if not exists version bigint not null default 1;
alter table public.players add column if not exists updated_by_device text;
alter table public.courses_cloud add column if not exists version bigint not null default 1;
alter table public.courses_cloud add column if not exists updated_by_device text;
alter table public.rounds_cloud add column if not exists version bigint not null default 1;
alter table public.rounds_cloud add column if not exists updated_by_device text;
alter table public.frequent_groups_cloud add column if not exists version bigint not null default 1;
alter table public.frequent_groups_cloud add column if not exists updated_by_device text;
alter table public.personal_rivals_cloud add column if not exists version bigint not null default 1;
alter table public.personal_rivals_cloud add column if not exists updated_by_device text;
alter table public.user_preferences add column if not exists version bigint not null default 1;
alter table public.user_preferences add column if not exists updated_by_device text;
alter table public.user_cloud_state add column if not exists version bigint not null default 1;
alter table public.user_cloud_state add column if not exists updated_by_device text;
alter table public.cloud_deletions add column if not exists version bigint not null default 1;
alter table public.cloud_deletions add column if not exists deleted_by_device text;
alter table public.account_data_migrations add column if not exists last_attempt_at timestamptz;
alter table public.account_data_migrations add column if not exists last_error_code text;

alter table public.round_players_cloud add column if not exists updated_at timestamptz not null default now();
alter table public.round_players_cloud add column if not exists version bigint not null default 1;
alter table public.round_players_cloud add column if not exists updated_by_device text;
alter table public.round_scores_cloud add column if not exists updated_at timestamptz not null default now();
alter table public.round_scores_cloud add column if not exists version bigint not null default 1;
alter table public.round_scores_cloud add column if not exists updated_by_device text;

alter table public.round_bet_configs add column if not exists updated_at timestamptz not null default now();
alter table public.round_bet_configs add column if not exists version bigint not null default 1;
alter table public.round_bet_configs add column if not exists updated_by_device text;
alter table public.round_bet_results add column if not exists updated_at timestamptz not null default now();
alter table public.round_bet_results add column if not exists version bigint not null default 1;
alter table public.round_bet_results add column if not exists updated_by_device text;
alter table public.personal_bets_cloud add column if not exists updated_at timestamptz not null default now();
alter table public.personal_bets_cloud add column if not exists version bigint not null default 1;
alter table public.personal_bets_cloud add column if not exists updated_by_device text;
alter table public.manual_bets_cloud add column if not exists updated_at timestamptz not null default now();
alter table public.manual_bets_cloud add column if not exists version bigint not null default 1;
alter table public.manual_bets_cloud add column if not exists updated_by_device text;
alter table public.expenses_cloud add column if not exists updated_at timestamptz not null default now();
alter table public.expenses_cloud add column if not exists version bigint not null default 1;
alter table public.expenses_cloud add column if not exists updated_by_device text;
alter table public.round_course_snapshots add column if not exists updated_at timestamptz not null default now();
alter table public.round_course_snapshots add column if not exists version bigint not null default 1;
alter table public.round_course_snapshots add column if not exists updated_by_device text;
alter table public.round_local_rules_snapshots add column if not exists updated_at timestamptz not null default now();
alter table public.round_local_rules_snapshots add column if not exists version bigint not null default 1;
alter table public.round_local_rules_snapshots add column if not exists updated_by_device text;

create table if not exists public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 8 and 120),
  last_seen_at timestamptz not null default now(),
  last_sync_at timestamptz,
  app_version text,
  primary key (user_id, device_id)
);

create table if not exists public.cloud_record_versions (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('round', 'active_draft')),
  local_id text not null,
  version bigint not null,
  previous_snapshot jsonb,
  replaced_at timestamptz not null default now(),
  replaced_by_device text
);
create index if not exists cloud_record_versions_owner_entity_idx
  on public.cloud_record_versions(owner_id, entity_type, local_id, replaced_at desc);

create or replace function public.handle_backyard_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), 'Jugador'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_backyard_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_backyard_profile on auth.users;
create trigger on_auth_user_created_backyard_profile
after insert on auth.users
for each row execute function public.handle_backyard_user_profile();

-- Repair accounts created before the trigger existed or while it was failing.
insert into public.profiles (id, name, display_name, avatar_url, default_handicap)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', split_part(coalesce(users.email, ''), '@', 1), ''),
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', split_part(coalesce(users.email, ''), '@', 1), 'Jugador'),
  coalesce(users.raw_user_meta_data ->> 'avatar_url', users.raw_user_meta_data ->> 'picture'),
  null
from auth.users as users
left join public.profiles as profiles on profiles.id = users.id
where profiles.id is null
on conflict (id) do nothing;

create or replace function public.bump_backyard_cloud_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := greatest(coalesce(old.version, 0) + 1, coalesce(new.version, 1));
  return new;
end;
$$;
revoke all on function public.bump_backyard_cloud_version() from public, anon, authenticated;

create or replace function public.archive_backyard_round_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.snapshot is not distinct from old.snapshot then
    return new;
  end if;
  insert into public.cloud_record_versions
    (owner_id, entity_type, local_id, version, previous_snapshot, replaced_by_device)
  values
    (old.owner_id, 'round', coalesce(old.local_id, old.local_round_id), old.version, old.snapshot,
     case when tg_op = 'UPDATE' then new.updated_by_device else old.updated_by_device end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.archive_backyard_round_version() from public, anon, authenticated;

create or replace function public.archive_backyard_draft_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.active_draft is not distinct from old.active_draft then
    return new;
  end if;
  insert into public.cloud_record_versions
    (owner_id, entity_type, local_id, version, previous_snapshot, replaced_by_device)
  values
    (old.user_id, 'active_draft', 'active-draft', old.version, old.active_draft,
     case when tg_op = 'UPDATE' then new.updated_by_device else old.updated_by_device end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.archive_backyard_draft_version() from public, anon, authenticated;

drop trigger if exists rounds_cloud_archive_version on public.rounds_cloud;
create trigger rounds_cloud_archive_version before update or delete on public.rounds_cloud
for each row execute function public.archive_backyard_round_version();
drop trigger if exists user_cloud_state_archive_version on public.user_cloud_state;
create trigger user_cloud_state_archive_version before update or delete on public.user_cloud_state
for each row execute function public.archive_backyard_draft_version();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'players', 'courses_cloud', 'rounds_cloud',
    'frequent_groups_cloud', 'personal_rivals_cloud', 'user_preferences',
    'user_cloud_state', 'cloud_deletions', 'round_players_cloud', 'round_scores_cloud',
    'round_bet_configs', 'round_bet_results', 'personal_bets_cloud',
    'manual_bets_cloud', 'expenses_cloud', 'round_course_snapshots',
    'round_local_rules_snapshots'
  ] loop
    execute format('drop trigger if exists backyard_version_bump on public.%I', table_name);
    execute format(
      'create trigger backyard_version_bump before update on public.%I for each row execute function public.bump_backyard_cloud_version()',
      table_name
    );
  end loop;
end $$;

alter table public.user_devices enable row level security;
alter table public.cloud_record_versions enable row level security;

drop policy if exists user_devices_self on public.user_devices;
create policy user_devices_self on public.user_devices for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
drop policy if exists cloud_record_versions_self_read on public.cloud_record_versions;
create policy cloud_record_versions_self_read on public.cloud_record_versions for select to authenticated
using ((select auth.uid()) = owner_id);

-- Explicit grants are required for projects using the new opt-in Data API
-- behavior. RLS remains the row-level boundary for every private table.
grant usage on schema public to anon, authenticated;

revoke all on table
  public.profiles,
  public.players,
  public.courses_cloud,
  public.course_versions,
  public.rounds_cloud,
  public.round_players_cloud,
  public.round_scores_cloud,
  public.shared_round_links,
  public.legal_acceptances,
  public.rules_referee_acceptances,
  public.user_preferences,
  public.account_data_migrations,
  public.frequent_groups_cloud,
  public.personal_rivals_cloud,
  public.user_cloud_state,
  public.cloud_deletions,
  public.round_bet_configs,
  public.round_bet_results,
  public.personal_bets_cloud,
  public.manual_bets_cloud,
  public.expenses_cloud,
  public.round_course_snapshots,
  public.round_local_rules_snapshots,
  public.user_devices,
  public.cloud_record_versions
from anon;

grant select, insert, update, delete on table
  public.profiles,
  public.players,
  public.courses_cloud,
  public.course_versions,
  public.rounds_cloud,
  public.round_players_cloud,
  public.round_scores_cloud,
  public.shared_round_links,
  public.legal_acceptances,
  public.rules_referee_acceptances,
  public.user_preferences,
  public.account_data_migrations,
  public.frequent_groups_cloud,
  public.personal_rivals_cloud,
  public.user_cloud_state,
  public.cloud_deletions,
  public.round_bet_configs,
  public.round_bet_results,
  public.personal_bets_cloud,
  public.manual_bets_cloud,
  public.expenses_cloud,
  public.round_course_snapshots,
  public.round_local_rules_snapshots,
  public.user_devices
to authenticated;
grant select on table public.cloud_record_versions to authenticated;

revoke all on table public.legal_documents from anon;
grant select on table public.legal_documents to anon, authenticated;
grant select on table public.tournament_leaderboard_events to anon, authenticated;

grant usage, select on sequence public.cloud_deletions_id_seq to authenticated;

-- Preserve the intentional hardening: join attempts are never client-accessible.
revoke all on table public.polla_join_attempts from public, anon, authenticated;
revoke all on sequence public.polla_join_attempts_id_seq from public, anon, authenticated;

commit;
