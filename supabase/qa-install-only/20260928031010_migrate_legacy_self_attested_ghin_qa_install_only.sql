-- REVIEW DRAFT ONLY: NOT APPLIED. Target only gvzeymebltssgjkvksxt.
-- Original automatic data reconciliation/cleanup omitted pending explicit approval.
-- Retire the legacy QA-era SELF_ATTESTED state without losing a user's useful
-- manual handicap declaration. Only VERIFIED rows represent active GHIN links.
begin;


create table if not exists private.ghin_legacy_self_attested_migrations (
  owner_id uuid not null,
  provider text not null check (provider = 'GHIN'),
  external_player_id text not null,
  provider_player_name text not null,
  provider_club_name text,
  provider_home_club_name text,
  provider_association_name text,
  provider_player_status text,
  legacy_handicap_index numeric(5,1),
  handicap_effective_at timestamptz,
  provider_updated_at timestamptz,
  last_successful_sync_at timestamptz not null,
  last_attempted_sync_at timestamptz not null,
  last_attempt_status text not null,
  last_error_code text,
  legacy_self_attested_at timestamptz,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  manual_hcp_before numeric,
  manual_hcp_after numeric,
  migration_outcome text not null check (migration_outcome in (
    'EXISTING_MANUAL_PRESERVED',
    'EXISTING_CHOICE_PRESERVED',
    'LEGACY_VALUE_MIGRATED_TO_MANUAL',
    'NO_MANUAL_VALUE'
  )),
  migrated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);


alter table private.ghin_legacy_self_attested_migrations enable row level security;

revoke all on private.ghin_legacy_self_attested_migrations
  from public, anon, authenticated, service_role;

grant select on private.ghin_legacy_self_attested_migrations to service_role;


comment on table private.ghin_legacy_self_attested_migrations is
  'Server-only audit of retired QA-era SELF_ATTESTED GHIN projections. Contains no credentials, sessions, tokens, cookies or raw provider responses.';


alter table public.player_handicap_provider_profiles
  drop constraint if exists player_handicap_provider_profiles_association_status_check;

alter table public.player_handicap_provider_profiles
  drop constraint if exists player_handicap_provider_profiles_attestation_check;


alter table public.player_handicap_provider_profiles
  add constraint player_handicap_provider_profiles_association_status_check
    check (association_status in ('LOOKUP_FOUND', 'VERIFIED', 'DISCONNECTED')),
  add constraint player_handicap_provider_profiles_attestation_check check (
    (association_status = 'VERIFIED' and self_attested_at is not null)
    or (association_status = 'LOOKUP_FOUND' and self_attested_at is null)
    or association_status = 'DISCONNECTED'
  );


create or replace function private.preserve_handicap_provider_profile_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
    or new.provider is distinct from old.provider
    or new.external_player_id is distinct from old.external_player_id then
    raise exception 'PROVIDER_PROFILE_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;

  if new.last_attempted_sync_at < old.last_attempted_sync_at then
    raise exception 'PROVIDER_SYNC_TIME_REGRESSION' using errcode = '23514';
  end if;

  if new.last_attempt_status = 'SUCCESS' then
    new.last_successful_sync_at := new.last_attempted_sync_at;
    new.last_error_code := null;
  else
    new.provider_player_name := old.provider_player_name;
    new.provider_club_name := old.provider_club_name;
    new.provider_home_club_name := old.provider_home_club_name;
    new.provider_association_name := old.provider_association_name;
    new.provider_player_status := old.provider_player_status;
    new.handicap_index := old.handicap_index;
    new.handicap_effective_at := old.handicap_effective_at;
    new.provider_updated_at := old.provider_updated_at;
    new.last_successful_sync_at := old.last_successful_sync_at;
  end if;

  if new.association_status = 'LOOKUP_FOUND' then
    new.self_attested_at := null;
  end if;

  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;


revoke all on function private.preserve_handicap_provider_profile_v1()
  from public, anon, authenticated;


drop policy if exists player_handicap_provider_profiles_owner_read
  on public.player_handicap_provider_profiles;

create policy player_handicap_provider_profiles_owner_read
on public.player_handicap_provider_profiles for select to authenticated
using (
  owner_id = (select auth.uid())
  and association_status = 'VERIFIED'
  and coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) = false
  and private.account_subject_active(owner_id)
);


comment on table public.player_handicap_provider_profiles is
  'Owner-readable, server-managed handicap-provider projections. Only VERIFIED rows represent active user-to-GHIN connections.';

comment on column public.player_handicap_provider_profiles.association_status is
  'VERIFIED means the authenticated Backyard user completed provider authentication and explicitly confirmed the same GHIN identity. SELF_ATTESTED is retired.';


commit;