-- Read-only external provider foundation for GHIN and future golf providers.
-- This migration is additive only. It stores no credentials, bearer tokens,
-- cookies or raw provider responses, and it does not activate any integration.
begin;

create table public.golf_course_provider_links (
  id uuid primary key default gen_random_uuid(),
  course_id text not null references public.golf_courses(id) on delete cascade,
  provider text not null
    check (provider = upper(trim(provider)) and provider ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'),
  external_facility_id text
    check (external_facility_id is null or length(trim(external_facility_id)) between 1 and 240),
  external_course_id text not null
    check (length(trim(external_course_id)) between 1 and 240),
  match_method text not null default 'MANUAL'
    check (match_method in ('MANUAL', 'EXACT_ID', 'EXACT_NAME', 'ALIAS', 'IMPORT')),
  sync_status text not null default 'CANDIDATE'
    check (sync_status in ('DISCOVERED', 'CANDIDATE', 'CONFIRMED', 'STALE', 'BLOCKED', 'DISABLED')),
  source_url text
    check (source_url is null or (length(source_url) <= 1000 and source_url ~ '^https://[^[:space:]]+$')),
  last_observed_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text
    check (last_error_code is null or length(trim(last_error_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_course_provider_links_confirmed_check
    check (sync_status <> 'CONFIRMED' or last_verified_at is not null),
  unique (course_id, provider),
  unique (provider, external_course_id),
  unique (id, course_id, provider)
);

create index golf_course_provider_links_facility_idx
  on public.golf_course_provider_links(provider, external_facility_id)
  where external_facility_id is not null;
create index golf_course_provider_links_sync_idx
  on public.golf_course_provider_links(provider, sync_status, updated_at desc);

create table public.golf_tee_provider_links (
  id uuid primary key default gen_random_uuid(),
  course_provider_link_id uuid not null,
  course_id text not null,
  tee_id text not null,
  provider text not null
    check (provider = upper(trim(provider)) and provider ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'),
  external_tee_set_id text not null
    check (length(trim(external_tee_set_id)) between 1 and 240),
  match_method text not null default 'MANUAL'
    check (match_method in ('MANUAL', 'EXACT_ID', 'EXACT_NAME', 'ALIAS', 'IMPORT')),
  sync_status text not null default 'CANDIDATE'
    check (sync_status in ('DISCOVERED', 'CANDIDATE', 'CONFIRMED', 'STALE', 'BLOCKED', 'DISABLED')),
  source_url text
    check (source_url is null or (length(source_url) <= 1000 and source_url ~ '^https://[^[:space:]]+$')),
  last_observed_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text
    check (last_error_code is null or length(trim(last_error_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint golf_tee_provider_links_course_link_fk
    foreign key (course_provider_link_id, course_id, provider)
    references public.golf_course_provider_links(id, course_id, provider)
    on delete cascade,
  constraint golf_tee_provider_links_tee_course_fk
    foreign key (tee_id, course_id)
    references public.golf_course_tees(id, course_id)
    on delete cascade,
  constraint golf_tee_provider_links_confirmed_check
    check (sync_status <> 'CONFIRMED' or last_verified_at is not null),
  unique (tee_id, provider),
  unique (provider, external_tee_set_id)
);

create index golf_tee_provider_links_course_idx
  on public.golf_tee_provider_links(course_id, provider, sync_status);

-- One last-known provider projection per Backyard account/provider. A successful
-- lookup is deliberately represented as LOOKUP_FOUND, not as verified ownership.
-- Signed-in owners may read this projection; only server-side service code writes.
create table public.player_handicap_provider_profiles (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null
    check (provider = upper(trim(provider)) and provider ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'),
  external_player_id text not null
    check (length(trim(external_player_id)) between 1 and 240),
  association_status text not null default 'LOOKUP_FOUND'
    check (association_status in ('LOOKUP_FOUND', 'SELF_ATTESTED', 'DISCONNECTED')),
  self_attested_at timestamptz,
  provider_player_name text not null
    check (length(trim(provider_player_name)) between 1 and 240),
  provider_club_name text
    check (provider_club_name is null or length(trim(provider_club_name)) between 1 and 240),
  provider_association_name text
    check (provider_association_name is null or length(trim(provider_association_name)) between 1 and 240),
  provider_player_status text
    check (provider_player_status is null or length(trim(provider_player_status)) between 1 and 120),
  handicap_index numeric(5,1)
    check (handicap_index is null or handicap_index between -20 and 54),
  handicap_effective_at timestamptz,
  provider_updated_at timestamptz,
  last_successful_sync_at timestamptz not null,
  last_attempted_sync_at timestamptz not null,
  last_attempt_status text not null default 'SUCCESS'
    check (last_attempt_status in (
      'SUCCESS', 'NOT_FOUND', 'INACTIVE', 'UNAVAILABLE', 'RATE_LIMITED',
      'AUTH_FAILED', 'INVALID_RESPONSE', 'TIMEOUT'
    )),
  last_error_code text
    check (last_error_code is null or length(trim(last_error_code)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider),
  constraint player_handicap_provider_profiles_attestation_check check (
    (association_status = 'SELF_ATTESTED' and self_attested_at is not null)
    or (association_status = 'LOOKUP_FOUND' and self_attested_at is null)
    or association_status = 'DISCONNECTED'
  ),
  constraint player_handicap_provider_profiles_attempt_order_check
    check (last_attempted_sync_at >= last_successful_sync_at),
  constraint player_handicap_provider_profiles_attempt_error_check check (
    (last_attempt_status = 'SUCCESS' and last_error_code is null)
    or (last_attempt_status <> 'SUCCESS' and last_error_code is not null)
  )
);

create index player_handicap_provider_profiles_external_idx
  on public.player_handicap_provider_profiles(provider, external_player_id);
create index player_handicap_provider_profiles_sync_idx
  on public.player_handicap_provider_profiles(owner_id, last_successful_sync_at desc);

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
    -- A failed refresh records its sanitized status while retaining every field
    -- from the last successful provider response. In particular, null is never
    -- converted to zero and a transient failure cannot erase a valid index.
    new.provider_player_name := old.provider_player_name;
    new.provider_club_name := old.provider_club_name;
    new.provider_association_name := old.provider_association_name;
    new.provider_player_status := old.provider_player_status;
    new.handicap_index := old.handicap_index;
    new.handicap_effective_at := old.handicap_effective_at;
    new.provider_updated_at := old.provider_updated_at;
    new.last_successful_sync_at := old.last_successful_sync_at;
  end if;

  if new.association_status = 'SELF_ATTESTED' and new.self_attested_at is null then
    new.self_attested_at := now();
  elsif new.association_status = 'LOOKUP_FOUND' then
    new.self_attested_at := null;
  end if;

  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.preserve_handicap_provider_profile_v1()
  from public, anon, authenticated;

create trigger golf_course_provider_links_touch
before insert or update on public.golf_course_provider_links
for each row execute function public.touch_golf_architecture_record();

create trigger golf_tee_provider_links_touch
before insert or update on public.golf_tee_provider_links
for each row execute function public.touch_golf_architecture_record();

create trigger player_handicap_provider_profiles_preserve
before update on public.player_handicap_provider_profiles
for each row execute function private.preserve_handicap_provider_profile_v1();

alter table public.golf_course_provider_links enable row level security;
alter table public.golf_tee_provider_links enable row level security;
alter table public.player_handicap_provider_profiles enable row level security;

revoke all on public.golf_course_provider_links,
  public.golf_tee_provider_links,
  public.player_handicap_provider_profiles
  from public, anon, authenticated, service_role;

grant select on public.golf_course_provider_links,
  public.golf_tee_provider_links
  to authenticated;
grant select on public.player_handicap_provider_profiles to authenticated;
grant select, insert, update, delete on public.golf_course_provider_links,
  public.golf_tee_provider_links,
  public.player_handicap_provider_profiles
  to service_role;

create policy golf_course_provider_links_authenticated_read
on public.golf_course_provider_links for select to authenticated
using (
  (select auth.uid()) is not null
  and private.account_subject_active((select auth.uid()))
);

create policy golf_tee_provider_links_authenticated_read
on public.golf_tee_provider_links for select to authenticated
using (
  (select auth.uid()) is not null
  and private.account_subject_active((select auth.uid()))
);

create policy player_handicap_provider_profiles_owner_read
on public.player_handicap_provider_profiles for select to authenticated
using (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) = false
  and private.account_subject_active(owner_id)
);

comment on table public.golf_course_provider_links is
  'Provider-neutral mapping from a Backyard course to one external course/facility. Server-managed; never replaces the Backyard catalog.';
comment on table public.golf_tee_provider_links is
  'Provider-neutral mapping from a Backyard tee to one external tee set. Server-managed; candidate data requires QA before catalog changes.';
comment on table public.player_handicap_provider_profiles is
  'Owner-readable, server-managed last-known handicap provider projection. LOOKUP_FOUND and SELF_ATTESTED do not prove provider account ownership.';
comment on column public.player_handicap_provider_profiles.handicap_index is
  'Nullable provider value with no default. Missing or unavailable values must never be coerced to zero.';
comment on column public.player_handicap_provider_profiles.last_successful_sync_at is
  'Timestamp of the response that produced the retained provider fields; failed refreshes leave those fields intact.';

commit;
