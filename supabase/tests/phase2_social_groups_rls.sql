-- Contract test. Run only on an isolated/local Supabase project after migrations.
begin;

do $$
declare table_name text;
declare policies text;
begin
  foreach table_name in array array[
    'social_profiles', 'friend_requests', 'friendships', 'blocked_connections',
    'recent_players', 'groups_v2', 'guest_players_v2', 'group_memberships_v2',
    'group_memories_v2', 'group_invites_v2', 'round_invites_v2',
    'guest_player_claims_v2', 'feature_entitlements', 'feature_usage_counters', 'app_admins'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then raise exception 'missing Phase 2A table %', table_name; end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relrowsecurity
    ) then raise exception 'RLS is not enabled on public.%', table_name; end if;
    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'anon unexpectedly has access to public.%', table_name;
    end if;
  end loop;

  select string_agg(coalesce(qual, '') || coalesce(with_check, ''), ' ') into policies
  from pg_policies where schemaname = 'public' and tablename in ('social_profiles', 'friend_requests', 'groups_v2', 'group_memberships_v2', 'guest_player_claims_v2');
  if policies is null or policies not like '%auth.uid()%' or policies like '%user_metadata%' then
    raise exception 'Phase 2A ownership policies must derive identity from auth.uid()';
  end if;

  if has_table_privilege('authenticated', 'public.friendships', 'INSERT')
    or has_table_privilege('authenticated', 'public.friendships', 'UPDATE')
    or has_table_privilege('authenticated', 'public.friendships', 'DELETE') then
    raise exception 'friendship rows must not be client-created or rewritten';
  end if;
  if has_table_privilege('authenticated', 'public.feature_entitlements', 'INSERT')
    or has_table_privilege('authenticated', 'public.feature_entitlements', 'UPDATE') then
    raise exception 'plan assignments must remain server-managed';
  end if;
end;
$$;

rollback;

