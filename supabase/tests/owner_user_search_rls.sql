-- Contract test. Run only after migrations on an isolated/local Supabase DB.
begin;

do $$
declare definition text;
begin
  if to_regprocedure('public.search_group_users_v1(text)') is null
    or has_function_privilege('anon', 'public.search_group_users_v1(text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.search_group_users_v1(text)', 'EXECUTE') then
    raise exception 'group user directory privilege contract is invalid';
  end if;
  select pg_get_functiondef('private.search_group_users(text)'::regprocedure) into definition;
  if position('lower(u.email) = q.value' in definition) = 0
    or position('blocked_connections' in definition) = 0
    or position('account_subject_active' in definition) = 0
    or position('s.privacy = ''PUBLIC''' in definition) = 0
    or position('s.privacy = ''FRIENDS''' in definition) = 0 then
    raise exception 'directory must keep exact-email, block, lifecycle and audience guards';
  end if;
  if position('select c.user_id, c.username, c.display_name, c.avatar_url, c.is_friend' in definition) = 0 then
    raise exception 'directory result must remain a minimal public identity card';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'social_profiles'
      and indexname = 'social_profiles_display_name_search_idx'
  ) then raise exception 'display-name lookup index is missing'; end if;
end;
$$;

rollback;
