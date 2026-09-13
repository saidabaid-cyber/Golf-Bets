-- Run only on a local/isolated Preview Supabase project after migrations.
begin;

do $$
declare
  table_name text;
  policy_text text;
begin
  foreach table_name in array array[
    'group_bet_templates_v2',
    'group_bet_template_participants_v2',
    'group_team_templates_v2',
    'group_team_template_members_v2',
    'round_group_snapshots_v2',
    'round_group_snapshot_players_v2'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'missing group preset table %', table_name;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'anon unexpectedly has access to public.%', table_name;
    end if;
  end loop;

  select string_agg(coalesce(qual, '') || coalesce(with_check, ''), ' ')
  into policy_text
  from pg_policies
  where schemaname = 'public'
    and tablename in ('group_bet_templates_v2', 'round_group_snapshots_v2');
  if policy_text is null or policy_text not like '%auth.uid()%' and policy_text not like '%is_group_%' then
    raise exception 'group preset policies do not derive ownership from auth/group membership';
  end if;

  if has_table_privilege('authenticated', 'public.round_group_snapshots_v2', 'DELETE')
    or has_table_privilege('authenticated', 'public.round_group_snapshot_players_v2', 'DELETE') then
    raise exception 'round group snapshots must not be client-deletable independently of their round';
  end if;
end;
$$;

rollback;
