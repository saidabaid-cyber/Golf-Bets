-- Read-only schema/RLS contract for 20260906193435_equipment_ball_fitting.sql.
-- Run only against an isolated/local Supabase database after applying migrations.
-- The transaction is rolled back and this file never creates application data.

begin;

do $$
declare
  table_name text;
  catalog_table text;
  owner_table text;
  policy_text text;
begin
  foreach table_name in array array[
    'golf_ball_catalog',
    'golf_club_catalog',
    'golf_shaft_catalog',
    'player_equipment_profiles',
    'player_clubs',
    'player_balls',
    'ball_fit_sessions',
    'ball_fit_recommendations',
    'launch_monitor_shots'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'missing equipment table: %', table_name;
    end if;

    if not exists (
      select 1
      from pg_class as relations
      join pg_namespace as schemas on schemas.oid = relations.relnamespace
      where schemas.nspname = 'public'
        and relations.relname = table_name
        and relations.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'anon unexpectedly has privileges on public.%', table_name;
    end if;

    if has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'authenticated unexpectedly has DELETE on public.%', table_name;
    end if;

    if not has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('service_role', format('public.%I', table_name), 'DELETE') then
      raise exception 'service_role grants are incomplete or overbroad on public.%', table_name;
    end if;

    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and cmd = 'DELETE'
    ) then
      raise exception 'client DELETE policy unexpectedly exists on public.%', table_name;
    end if;
  end loop;

  foreach catalog_table in array array[
    'golf_ball_catalog', 'golf_club_catalog', 'golf_shaft_catalog'
  ] loop
    if not has_table_privilege('authenticated', format('public.%I', catalog_table), 'SELECT')
      or not has_table_privilege('authenticated', format('public.%I', catalog_table), 'INSERT')
      or not has_table_privilege('authenticated', format('public.%I', catalog_table), 'UPDATE') then
      raise exception 'catalog grants are incomplete on public.%', catalog_table;
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = catalog_table
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
    ) then
      raise exception 'authenticated catalog read policy missing on public.%', catalog_table;
    end if;

    select string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ')
    into policy_text
    from pg_policies
    where schemaname = 'public'
      and tablename = catalog_table
      and cmd in ('INSERT', 'UPDATE');

    if policy_text is null
      or policy_text not like '%app_metadata%'
      or policy_text not like '%admin%'
      or policy_text like '%user_metadata%' then
      raise exception 'catalog admin policy is not based exclusively on app_metadata for public.%', catalog_table;
    end if;
  end loop;

  foreach owner_table in array array[
    'player_equipment_profiles',
    'player_clubs',
    'player_balls',
    'ball_fit_sessions',
    'ball_fit_recommendations',
    'launch_monitor_shots'
  ] loop
    if not has_table_privilege('authenticated', format('public.%I', owner_table), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', owner_table), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', owner_table), 'UPDATE') then
      raise exception 'owner tables must be client-read-only; writes use the validated server route: public.%', owner_table;
    end if;

    if (select count(*) from pg_policies
        where schemaname = 'public'
          and tablename = owner_table
          and cmd in ('SELECT', 'INSERT', 'UPDATE')) <> 3 then
      raise exception 'expected separate SELECT/INSERT/UPDATE owner policies on public.%', owner_table;
    end if;

    select string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ')
    into policy_text
    from pg_policies
    where schemaname = 'public' and tablename = owner_table;

    if policy_text is null
      or policy_text not like '%auth.uid()%'
      or policy_text like '%user_metadata%' then
      raise exception 'owner policy does not derive identity from auth.uid() on public.%', owner_table;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'player_equipment_profiles'
      and column_name = 'expected_version'
  ) then
    raise exception 'canonical snapshot has no expected_version CAS field';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.player_equipment_profiles'::regclass
      and tgname = 'player_equipment_profiles_cas'
      and not tgisinternal
  ) then
    raise exception 'canonical snapshot CAS trigger is missing';
  end if;

  if exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as schemas on schemas.oid = procedures.pronamespace
    where schemas.nspname = 'public'
      and procedures.proname in (
        'touch_equipment_catalog_record',
        'bump_player_equipment_record',
        'enforce_player_equipment_profile_cas'
      )
      and procedures.prosecdef
  ) then
    raise exception 'equipment trigger functions must remain SECURITY INVOKER';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.enforce_player_equipment_profile_cas()',
      'EXECUTE'
    ) then
    raise exception 'authenticated must not call the CAS trigger function directly';
  end if;
end;
$$;

rollback;
