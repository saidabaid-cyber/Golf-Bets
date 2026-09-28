-- Scorecard-profile coexistence, grants and player-safe projection contract.
-- Run only against isolated Preview after the scorecard-profile migration.
begin;

do $$
declare
  relation_name text;
  reader_oid oid;
  reader_definition text;
begin
  foreach relation_name in array array[
    'course_scorecard_profiles',
    'course_scorecard_profile_tees',
    'course_scorecard_profile_holes'
  ] loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'missing scorecard profile table: %', relation_name;
    end if;
    if not exists (
      select 1 from pg_class relation
      join pg_namespace schema on schema.oid = relation.relnamespace
      where schema.nspname = 'public' and relation.relname = relation_name and relation.relrowsecurity
    ) then raise exception 'RLS is not enabled on public.%', relation_name; end if;
    if has_table_privilege('anon', format('public.%I', relation_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', relation_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', relation_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', relation_name), 'DELETE') then
      raise exception 'anon unexpectedly has privileges on public.%', relation_name;
    end if;
    if not has_table_privilege('authenticated', format('public.%I', relation_name), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', relation_name), 'DELETE') then
      raise exception 'authenticated scorecard profile grants are unsafe on public.%', relation_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'course_scorecard_profiles_current_default_idx'
      and indexdef like '%UNIQUE INDEX%'
      and indexdef like '%default_for_play%'
      and indexdef like '%historical%'
  ) then raise exception 'one-current-default structural constraint is missing'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'round_course_snapshots'
      and column_name = 'scorecard_profile_snapshot' and data_type = 'jsonb'
  ) then raise exception 'immutable round scorecard snapshot column is missing'; end if;

  select procedure.oid, pg_get_functiondef(procedure.oid)
  into reader_oid, reader_definition
  from pg_proc procedure join pg_namespace schema on schema.oid = procedure.pronamespace
  where schema.nspname = 'public' and procedure.proname = 'read_backyard_scorecard_profiles_v1';
  if reader_oid is null then raise exception 'missing scorecard profile reader'; end if;
  if not has_function_privilege('authenticated', reader_oid, 'EXECUTE')
    or has_function_privilege('anon', reader_oid, 'EXECUTE') then
    raise exception 'scorecard profile reader execute grants are unsafe';
  end if;
  if reader_definition not like '%auth.uid() is null%'
    or reader_definition not like '%not profile.historical%'
    or reader_definition not like '%rating_reuse_authorized%'
    or reader_definition like '%to_jsonb(profile)%'
    or reader_definition like '%created_by%'
    or reader_definition like '%evidence%'
    or reader_definition like '%notes%' then
    raise exception 'scorecard profile reader leaks admin-only or historical material';
  end if;

  if has_function_privilege('anon', 'public.admin_create_scorecard_profile_v1(jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.admin_create_scorecard_profile_v1(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.admin_transition_scorecard_profile_v1(text,text,boolean,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.admin_transition_scorecard_profile_v1(text,text,boolean,text)', 'EXECUTE') then
    raise exception 'scorecard profile admin workflow execute grants are unsafe';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('course_scorecard_profiles','course_scorecard_profile_tees','course_scorecard_profile_holes')
      and column_name ~* '(password|secret|credential|bearer|firebase|authorization|cookie|raw_response)'
  ) then raise exception 'scorecard profile schema persists secret material'; end if;
end $$;

rollback;
