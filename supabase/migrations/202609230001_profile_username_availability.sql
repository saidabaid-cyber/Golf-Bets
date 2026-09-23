begin;

create or replace function public.profile_username_available(candidate_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized text := lower(regexp_replace(trim(coalesce(candidate_username, '')), '^@+', ''));
begin
  if (select auth.uid()) is null then return false; end if;
  if normalized !~ '^[a-z0-9][a-z0-9._]{1,39}$' then return false; end if;
  return not exists (
    select 1 from public.profiles profile
    where profile.id <> (select auth.uid())
      and lower(regexp_replace(trim(coalesce(profile.username, '')), '^@+', '')) = normalized
  ) and not exists (
    select 1 from public.social_profiles profile
    where profile.user_id <> (select auth.uid())
      and lower(profile.username) = normalized
  );
end;
$$;

revoke all on function public.profile_username_available(text) from public, anon;
grant execute on function public.profile_username_available(text) to authenticated;

commit;
