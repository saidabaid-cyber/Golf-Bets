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

-- Foreign-key lookup indexes reported by the Security/Performance Advisor.
-- Existing primary/unique indexes already cover owner_id/round_id keys; these
-- cover only FK columns that otherwise require a sequential scan on cascades
-- or common joins.
create index if not exists players_profile_id_idx on public.players(profile_id);
create index if not exists course_versions_created_by_idx on public.course_versions(created_by);
create index if not exists tournaments_created_by_idx on public.tournaments(created_by);
create index if not exists tournament_groups_tournament_id_idx on public.tournament_groups(tournament_id);
create index if not exists tournament_groups_confirmed_by_idx on public.tournament_groups(confirmed_by);
create index if not exists tournament_players_player_id_idx on public.tournament_players(player_id);
create index if not exists tournament_players_profile_id_idx on public.tournament_players(profile_id);
create index if not exists group_members_player_id_idx on public.group_members(tournament_player_id);
create index if not exists tournament_access_tournament_id_idx on public.tournament_access(tournament_id);
create index if not exists tournament_access_group_id_idx on public.tournament_access(group_id);
create index if not exists tournament_access_player_id_idx on public.tournament_access(tournament_player_id);
create index if not exists tournament_access_user_id_idx on public.tournament_access(user_id);
create index if not exists tournament_scores_group_id_idx on public.tournament_scores(group_id);
create index if not exists tournament_scores_player_id_idx on public.tournament_scores(player_id);
create index if not exists tournament_scores_entered_by_idx on public.tournament_scores(entered_by);
create index if not exists tournament_scores_access_id_idx on public.tournament_scores(access_id);
create index if not exists tournament_oyes_player_id_idx on public.tournament_oyes(player_id);
create index if not exists tournament_oyes_entered_by_idx on public.tournament_oyes(entered_by);
create index if not exists tournament_oyes_access_id_idx on public.tournament_oyes(access_id);
create index if not exists tournament_invites_tournament_id_idx on public.tournament_invites(tournament_id);
create index if not exists tournament_invites_group_id_idx on public.tournament_invites(group_id);
create index if not exists shared_round_links_round_id_idx on public.shared_round_links(round_id);

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

-- Recreate account/round policies with auth.uid() as an init-plan so Postgres
-- evaluates it once per statement instead of once per row. Policy names and
-- access semantics stay unchanged.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists players_owner on public.players;
create policy players_owner on public.players for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists courses_owner on public.courses_cloud;
create policy courses_owner on public.courses_cloud for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists course_versions_owner on public.course_versions;
create policy course_versions_owner on public.course_versions for all to authenticated
using (exists(select 1 from public.courses_cloud c where c.id = course_id and c.owner_id = (select auth.uid())))
with check (exists(select 1 from public.courses_cloud c where c.id = course_id and c.owner_id = (select auth.uid())));
drop policy if exists tournaments_admin on public.tournaments;
create policy tournaments_admin on public.tournaments for all to authenticated
using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
drop policy if exists groups_admin on public.tournament_groups;
create policy groups_admin on public.tournament_groups for all to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())))
with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())));
drop policy if exists tournament_players_admin on public.tournament_players;
create policy tournament_players_admin on public.tournament_players for all to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())))
with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())));
drop policy if exists group_members_admin on public.group_members;
create policy group_members_admin on public.group_members for all to authenticated
using (exists(select 1 from public.tournament_groups g join public.tournaments t on t.id = g.tournament_id where g.id = group_id and t.created_by = (select auth.uid())))
with check (exists(select 1 from public.tournament_groups g join public.tournaments t on t.id = g.tournament_id where g.id = group_id and t.created_by = (select auth.uid())));
drop policy if exists scores_admin on public.tournament_scores;
create policy scores_admin on public.tournament_scores for all to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())))
with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())));
drop policy if exists audit_admin_read on public.score_audit_log;
create policy audit_admin_read on public.score_audit_log for select to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())));
drop policy if exists access_admin on public.tournament_access;
create policy access_admin on public.tournament_access for select to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())) or user_id = (select auth.uid()));
drop policy if exists prizes_admin on public.tournament_prizes;
create policy prizes_admin on public.tournament_prizes for all to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())))
with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())));
drop policy if exists oyes_admin on public.tournament_oyes;
create policy oyes_admin on public.tournament_oyes for all to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())))
with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())));
drop policy if exists invites_admin on public.tournament_invites;
create policy invites_admin on public.tournament_invites for all to authenticated
using (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())))
with check (exists(select 1 from public.tournaments t where t.id = tournament_id and t.created_by = (select auth.uid())));
drop policy if exists rounds_owner on public.rounds_cloud;
create policy rounds_owner on public.rounds_cloud for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists round_players_owner on public.round_players_cloud;
create policy round_players_owner on public.round_players_cloud for all to authenticated
using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = (select auth.uid())))
with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = (select auth.uid())));
drop policy if exists round_scores_owner on public.round_scores_cloud;
create policy round_scores_owner on public.round_scores_cloud for all to authenticated
using (exists(select 1 from public.round_players_cloud rp join public.rounds_cloud r on r.id = rp.round_id where rp.id = round_player_id and r.owner_id = (select auth.uid())))
with check (exists(select 1 from public.round_players_cloud rp join public.rounds_cloud r on r.id = rp.round_id where rp.id = round_player_id and r.owner_id = (select auth.uid())));
drop policy if exists shared_links_owner on public.shared_round_links;
create policy shared_links_owner on public.shared_round_links for all to authenticated
using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = (select auth.uid())))
with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = (select auth.uid())));

drop policy if exists legal_acceptances_self_read on public.legal_acceptances;
create policy legal_acceptances_self_read on public.legal_acceptances for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists legal_acceptances_self_insert on public.legal_acceptances;
create policy legal_acceptances_self_insert on public.legal_acceptances for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists rules_referee_self_read on public.rules_referee_acceptances;
create policy rules_referee_self_read on public.rules_referee_acceptances for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists rules_referee_self_insert on public.rules_referee_acceptances;
create policy rules_referee_self_insert on public.rules_referee_acceptances for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists user_preferences_self on public.user_preferences;
create policy user_preferences_self on public.user_preferences for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists account_migrations_self on public.account_data_migrations;
create policy account_migrations_self on public.account_data_migrations for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists frequent_groups_owner on public.frequent_groups_cloud;
create policy frequent_groups_owner on public.frequent_groups_cloud for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists personal_rivals_owner on public.personal_rivals_cloud;
create policy personal_rivals_owner on public.personal_rivals_cloud for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists user_cloud_state_owner on public.user_cloud_state;
create policy user_cloud_state_owner on public.user_cloud_state for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists cloud_deletions_owner on public.cloud_deletions;
create policy cloud_deletions_owner on public.cloud_deletions for all to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

do $$
declare policy_table text;
begin
  foreach policy_table in array array[
    'round_bet_configs', 'round_bet_results', 'personal_bets_cloud',
    'manual_bets_cloud', 'expenses_cloud', 'round_course_snapshots',
    'round_local_rules_snapshots'
  ] loop
    execute format('drop policy if exists %I on public.%I', policy_table || '_owner', policy_table);
    execute format(
      'create policy %I on public.%I for all to authenticated using (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = (select auth.uid()))) with check (exists(select 1 from public.rounds_cloud r where r.id = round_id and r.owner_id = (select auth.uid())))',
      policy_table || '_owner', policy_table
    );
  end loop;
end $$;

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

-- is_polla_admin(uuid) intentionally remains executable by authenticated:
-- delegated-admin SELECT policies call it with the current tournament id. The
-- SECURITY DEFINER function derives identity from auth.uid() and accepts no user
-- id, while direct table writes remain protected by RLS. Revoking EXECUTE would
-- make those policies fail rather than harden them.
comment on function public.is_polla_admin(uuid) is
  'RLS helper for delegated Polla admins; authenticated EXECUTE is required by policies and identity is derived from auth.uid().';

commit;
