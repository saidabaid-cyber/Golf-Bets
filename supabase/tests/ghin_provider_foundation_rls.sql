-- GHIN/provider foundation schema and RLS contract.
-- Run only after migrations on an isolated/local Supabase database.
-- All behavioral fixtures roll back.
begin;

-- Fixed synthetic identities may remain in long-lived QA databases after an
-- interrupted historical harness. Remove them only inside this transaction so
-- the test is repeatable; the final rollback restores any pre-existing rows.
delete from public.player_handicap_provider_profiles
where owner_id in (
  '40000000-0000-4000-8000-000000000001'::uuid,
  '40000000-0000-4000-8000-000000000002'::uuid
);
delete from public.golf_tee_provider_links
where tee_id in ('provider-test-tee-a', 'provider-test-tee-b')
   or course_id in ('provider-test-course-a', 'provider-test-course-b');
delete from public.golf_course_provider_links
where course_id in ('provider-test-course-a', 'provider-test-course-b');
delete from public.golf_course_tees
where id in ('provider-test-tee-a', 'provider-test-tee-b');
delete from public.golf_courses
where id in ('provider-test-course-a', 'provider-test-course-b');
delete from public.golf_clubs
where id in ('provider-test-club-a', 'provider-test-club-b');
delete from auth.users
where id in (
  '40000000-0000-4000-8000-000000000001'::uuid,
  '40000000-0000-4000-8000-000000000002'::uuid
);

do $$
declare
  table_name text;
  handicap_nullable text;
  handicap_default text;
begin
  foreach table_name in array array[
    'golf_course_provider_links',
    'golf_tee_provider_links',
    'player_handicap_provider_profiles'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'missing provider foundation table: %', table_name;
    end if;
    if not exists (
      select 1 from pg_class relation
      join pg_namespace schema on schema.oid = relation.relnamespace
      where schema.nspname = 'public'
        and relation.relname = table_name
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', table_name), 'DELETE') then
      raise exception 'anon unexpectedly has provider table privileges on public.%', table_name;
    end if;
    if not has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'UPDATE')
      or not has_table_privilege('service_role', format('public.%I', table_name), 'DELETE') then
      raise exception 'service_role provider privileges are incomplete on public.%', table_name;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.player_handicap_provider_profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.player_handicap_provider_profiles', 'INSERT')
    or has_table_privilege('authenticated', 'public.player_handicap_provider_profiles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.player_handicap_provider_profiles', 'DELETE') then
    raise exception 'provider profile must be owner-readable and server-write-only';
  end if;

  foreach table_name in array array['golf_course_provider_links', 'golf_tee_provider_links'] loop
    if not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'provider mappings must be authenticated-read-only on public.%', table_name;
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and cmd = 'SELECT'
        and coalesce(qual, '') like '%auth.uid()%'
        and coalesce(qual, '') like '%account_subject_active%'
    ) then
      raise exception 'provider mapping read policy is missing an active authenticated subject guard on public.%', table_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'player_handicap_provider_profiles'
      and policyname = 'player_handicap_provider_profiles_owner_read'
      and cmd = 'SELECT'
      and coalesce(qual, '') like '%auth.uid()%'
      and coalesce(qual, '') like '%is_anonymous%'
      and coalesce(qual, '') like '%account_subject_active%'
  ) then
    raise exception 'provider profile owner policy is missing or unsafe';
  end if;

  if exists (
    select 1 from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name in (
        'golf_course_provider_links',
        'golf_tee_provider_links',
        'player_handicap_provider_profiles'
      )
      and columns.column_name ~* '(password|secret|credential|bearer|token|cookie|raw_response)'
  ) then
    raise exception 'provider foundation must not persist credentials, tokens or raw responses';
  end if;

  select is_nullable, column_default
  into handicap_nullable, handicap_default
  from information_schema.columns as columns
  where columns.table_schema = 'public'
    and columns.table_name = 'player_handicap_provider_profiles'
    and columns.column_name = 'handicap_index';
  if handicap_nullable <> 'YES' or handicap_default is not null then
    raise exception 'provider handicap must remain nullable with no default';
  end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'provider-owner-a@backyard.invalid', '', now(), '{}', '{}', now(), now()),
  ('40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'provider-owner-b@backyard.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles(id, name) values
  ('40000000-0000-4000-8000-000000000001', 'Provider Owner A'),
  ('40000000-0000-4000-8000-000000000002', 'Provider Owner B')
on conflict(id) do update set name=excluded.name;

insert into public.golf_clubs(id, name, provider, visibility)
values
  ('provider-test-club-a', 'Provider Test Club A', 'BACKYARD_INTERNAL', 'PUBLIC'),
  ('provider-test-club-b', 'Provider Test Club B', 'BACKYARD_INTERNAL', 'PUBLIC');
insert into public.golf_courses(id, club_id, name, holes, provider, visibility)
values
  ('provider-test-course-a', 'provider-test-club-a', 'Provider Test Course A', 18, 'BACKYARD_INTERNAL', 'PUBLIC'),
  ('provider-test-course-b', 'provider-test-club-b', 'Provider Test Course B', 18, 'BACKYARD_INTERNAL', 'PUBLIC');
insert into public.golf_course_tees(id, course_id, name, provider)
values
  ('provider-test-tee-a', 'provider-test-course-a', 'Blue', 'BACKYARD_INTERNAL'),
  ('provider-test-tee-b', 'provider-test-course-b', 'White', 'BACKYARD_INTERNAL');

insert into public.golf_course_provider_links(
  course_id, provider, external_facility_id, external_course_id,
  match_method, sync_status, source_url, last_observed_at, last_verified_at
) values (
  'provider-test-course-a', 'GHIN', 'facility-23233', 'course-23233',
  'MANUAL', 'CONFIRMED', 'https://example.invalid/provider/course-23233', now(), now()
);

insert into public.golf_tee_provider_links(
  course_provider_link_id, course_id, tee_id, provider, external_tee_set_id,
  match_method, sync_status, source_url, last_observed_at, last_verified_at
) select
  id, course_id, 'provider-test-tee-a', provider, 'tee-set-106087',
  'MANUAL', 'CONFIRMED', 'https://example.invalid/provider/tee-set-106087', now(), now()
from public.golf_course_provider_links
where course_id = 'provider-test-course-a' and provider = 'GHIN';

do $$
declare
  denied boolean := false;
  link_id uuid;
begin
  select id into link_id
  from public.golf_course_provider_links
  where course_id = 'provider-test-course-a' and provider = 'GHIN';
  begin
    insert into public.golf_tee_provider_links(
      course_provider_link_id, course_id, tee_id, provider, external_tee_set_id
    ) values (
      link_id, 'provider-test-course-a', 'provider-test-tee-b', 'GHIN', 'tee-set-mismatched'
    );
  exception when foreign_key_violation then
    denied := true;
  end;
  if not denied then
    raise exception 'tee mapping crossed Backyard course boundaries';
  end if;
end;
$$;

insert into public.player_handicap_provider_profiles(
  owner_id, provider, external_player_id, association_status,
  provider_player_name, provider_club_name, provider_player_status,
  handicap_index, handicap_effective_at, provider_updated_at,
  last_successful_sync_at, last_attempted_sync_at, last_attempt_status
) values (
  '40000000-0000-4000-8000-000000000001', 'GHIN', '11103349', 'LOOKUP_FOUND',
  'Synthetic Player', 'Synthetic Club', 'ACTIVE',
  7.9, '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z',
  '2026-09-20T01:00:00Z', '2026-09-20T01:00:00Z', 'SUCCESS'
);

-- A failed refresh may update only attempt metadata. The trigger retains every
-- field from the last successful provider response, including a valid index.
update public.player_handicap_provider_profiles
set provider_player_name = 'Must Not Replace Last Success',
    provider_club_name = null,
    handicap_index = null,
    handicap_effective_at = null,
    last_successful_sync_at = '2026-09-21T01:00:00Z',
    last_attempted_sync_at = '2026-09-21T01:00:00Z',
    last_attempt_status = 'TIMEOUT',
    last_error_code = 'PROVIDER_TIMEOUT'
where owner_id = '40000000-0000-4000-8000-000000000001' and provider = 'GHIN';

do $$
declare
  profile public.player_handicap_provider_profiles;
  rejected boolean := false;
begin
  select * into profile
  from public.player_handicap_provider_profiles
  where owner_id = '40000000-0000-4000-8000-000000000001' and provider = 'GHIN';
  if profile.handicap_index is distinct from 7.9
    or profile.provider_player_name is distinct from 'Synthetic Player'
    or profile.provider_club_name is distinct from 'Synthetic Club'
    or profile.last_successful_sync_at is distinct from '2026-09-20T01:00:00Z'::timestamptz
    or profile.last_attempt_status is distinct from 'TIMEOUT'
    or profile.last_error_code is distinct from 'PROVIDER_TIMEOUT' then
    raise exception 'failed refresh did not preserve the last successful provider values';
  end if;

  begin
    update public.player_handicap_provider_profiles
    set association_status = 'VERIFIED'
    where owner_id = '40000000-0000-4000-8000-000000000001' and provider = 'GHIN';
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'a provider lookup was incorrectly representable as verified ownership';
  end if;
end;
$$;

-- A later successful response may legitimately report no Handicap Index. Null
-- stays null and the successful timestamp advances; it is never coerced to 0.
update public.player_handicap_provider_profiles
set handicap_index = null,
    handicap_effective_at = null,
    provider_updated_at = '2026-09-22T00:00:00Z',
    last_attempted_sync_at = '2026-09-22T01:00:00Z',
    last_attempt_status = 'SUCCESS',
    last_error_code = 'MUST_BE_CLEARED'
where owner_id = '40000000-0000-4000-8000-000000000001' and provider = 'GHIN';

do $$
declare
  profile public.player_handicap_provider_profiles;
begin
  select * into profile
  from public.player_handicap_provider_profiles
  where owner_id = '40000000-0000-4000-8000-000000000001' and provider = 'GHIN';
  if profile.handicap_index is not null
    or profile.last_successful_sync_at is distinct from '2026-09-22T01:00:00Z'::timestamptz
    or profile.last_error_code is not null then
    raise exception 'successful null provider index was coerced or sync state was stale';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  row_count integer;
  denied boolean := false;
begin
  select count(*) into row_count from public.player_handicap_provider_profiles;
  if row_count <> 1 then raise exception 'owner cannot read its provider profile'; end if;
  select count(*) into row_count from public.golf_course_provider_links where provider = 'GHIN';
  if row_count <> 1 then raise exception 'authenticated account cannot read provider mappings'; end if;
  begin
    update public.player_handicap_provider_profiles
    set association_status = 'SELF_ATTESTED'
    where owner_id = (select auth.uid()) and provider = 'GHIN';
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'owner mutated server-managed provider profile'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare row_count integer;
begin
  select count(*) into row_count from public.player_handicap_provider_profiles;
  if row_count <> 0 then raise exception 'provider profile leaked across owners'; end if;
end;
$$;

reset role;
rollback;
