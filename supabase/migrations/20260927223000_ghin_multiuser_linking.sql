-- Preview multiuser GHIN ownership. This migration stores only provider profile
-- data; credentials and provider sessions remain ephemeral server memory.
begin;

alter table public.player_handicap_provider_profiles
  add column if not exists provider_home_club_name text
    check (provider_home_club_name is null or length(trim(provider_home_club_name)) between 1 and 240);

update public.player_handicap_provider_profiles
set provider_home_club_name = provider_club_name
where provider_home_club_name is null;

alter table public.player_handicap_provider_profiles
  drop constraint if exists player_handicap_provider_profiles_association_status_check;
alter table public.player_handicap_provider_profiles
  drop constraint if exists player_handicap_provider_profiles_attestation_check;

alter table public.player_handicap_provider_profiles
  add constraint player_handicap_provider_profiles_association_status_check
    check (association_status in ('LOOKUP_FOUND', 'SELF_ATTESTED', 'VERIFIED', 'DISCONNECTED')),
  add constraint player_handicap_provider_profiles_attestation_check check (
    (association_status in ('SELF_ATTESTED', 'VERIFIED') and self_attested_at is not null)
    or (association_status = 'LOOKUP_FOUND' and self_attested_at is null)
    or association_status = 'DISCONNECTED'
  );

-- A provider identity can belong to only one verified Backyard account. Some
-- Preview data predates authenticated linking and can contain duplicate
-- SELF_ATTESTED rows; those rows remain non-active until their owner completes
-- the new confirmation flow. Unlink physically removes the active row, which
-- permits an intentional later relink.
create unique index if not exists player_handicap_provider_profiles_provider_player_unique
  on public.player_handicap_provider_profiles(provider, external_player_id)
  where association_status = 'VERIFIED';

create table if not exists public.player_handicap_provider_link_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider = 'GHIN'),
  external_player_id text not null check (length(trim(external_player_id)) between 1 and 240),
  event text not null check (event in ('UNLINKED')),
  occurred_at timestamptz not null default now()
);

alter table public.player_handicap_provider_link_audit enable row level security;
revoke all on public.player_handicap_provider_link_audit from public, anon, authenticated, service_role;
grant select, insert on public.player_handicap_provider_link_audit to service_role;

create or replace function public.unlink_ghin_profile_v1(p_owner_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed_external_player_id text;
begin
  delete from public.player_handicap_provider_profiles
  where owner_id = p_owner_id and provider = 'GHIN'
  returning external_player_id into removed_external_player_id;

  if removed_external_player_id is null then return false; end if;
  insert into public.player_handicap_provider_link_audit(
    owner_id, provider, external_player_id, event
  ) values (
    p_owner_id, 'GHIN', removed_external_player_id, 'UNLINKED'
  );
  return true;
end;
$$;

revoke all on function public.unlink_ghin_profile_v1(uuid) from public, anon, authenticated;
grant execute on function public.unlink_ghin_profile_v1(uuid) to service_role;

comment on table public.player_handicap_provider_link_audit is
  'Minimal server-only unlink audit. Contains provider identity and time only; never credentials or provider sessions.';
comment on column public.player_handicap_provider_profiles.association_status is
  'VERIFIED means the signed-in Backyard user authenticated to the same GHIN identity and explicitly confirmed linking.';

commit;
