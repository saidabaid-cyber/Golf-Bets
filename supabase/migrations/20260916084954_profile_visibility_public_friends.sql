-- Add an explicit public social-profile audience. No stored private account is
-- widened. Email, geography, consent and account rows retain owner-only RLS.
begin;

alter table public.profiles drop constraint if exists profiles_profile_visibility_check;
alter table public.profiles add constraint profiles_profile_visibility_check
  check (profile_visibility in ('private', 'friends', 'public')) not valid;
alter table public.profiles validate constraint profiles_profile_visibility_check;
alter table public.social_profiles drop constraint if exists social_profiles_privacy_check;
alter table public.social_profiles add constraint social_profiles_privacy_check
  check (privacy in ('PRIVATE', 'FRIENDS', 'PUBLIC')) not valid;
alter table public.social_profiles validate constraint social_profiles_privacy_check;

-- Public discovery stays behind the existing guarded directory RPC. Do not add
-- direct-table public policies: blocked_connections is owner-scoped and an
-- invoker subquery cannot safely check blocks owned by the other party.
-- Full social rows remain owner/friend only; private account rows remain owner only.

create or replace function public.set_my_profile_visibility(requested_visibility text)
returns text language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid := (select auth.uid()); saved text;
begin
  if owner_id is null then raise insufficient_privilege using message = 'authentication_required'; end if;
  if requested_visibility is null or requested_visibility not in ('public','friends') then
    raise invalid_parameter_value using message = 'invalid_profile_audience';
  end if;
  update public.profiles set profile_visibility = requested_visibility
    where id = owner_id returning profile_visibility into saved;
  if saved is null then raise insufficient_privilege using message = 'profile_not_available'; end if;
  update public.social_profiles set privacy = upper(requested_visibility), updated_at = now()
    where user_id = owner_id;
  -- Do not change social_privacy or social_activity_preferences_v3: opting into
  -- a public identity card does not authorize publishing existing rounds/posts.
  return saved;
end;
$$;
revoke all on function public.set_my_profile_visibility(text) from public, anon;
grant execute on function public.set_my_profile_visibility(text) to authenticated;

-- Retain the existing lifecycle guard, block rules, projection and privileges.
-- The old RPC intentionally returns only identity fields, even for PUBLIC.
do $$ declare definition text; begin
  select pg_get_functiondef('public.search_social_profiles_v2(text,integer)'::regprocedure) into definition;
  if position('profile.privacy = ''FRIENDS''' in definition) > 0 then
    execute replace(definition, 'profile.privacy = ''FRIENDS''', 'profile.privacy in (''FRIENDS'',''PUBLIC'')');
  elsif position('profile.privacy in (''FRIENDS'',''PUBLIC'')' in definition) = 0 then
    raise exception 'social_directory_review_required';
  end if;
end $$;

comment on function public.set_my_profile_visibility(text) is
  'Owner-only explicit social profile audience. Keeps legacy private until selected; does not publish rounds or account data.';
commit;
