-- Transactional schema/RLS contract for the golf profile/course architecture.
-- Run only against an isolated/local Supabase database after migrations.
-- Its behavioral fixtures are temporary because the transaction always rolls back.

begin;

do $$
declare
  table_name text;
  policy_text text;
  unit_constraint_text text;
  confidence_constraint_text text;
begin
  foreach table_name in array array[
    'golf_ball_brands',
    'golf_club_brands',
    'golf_ball_test_results',
    'player_club_distances',
    'golf_clubs',
    'golf_courses',
    'golf_course_tees',
    'golf_holes',
    'golf_tee_hole_yardages',
    'golf_hole_geo_features',
    'player_favorite_courses',
    'player_recent_courses'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'missing golf architecture table: %', table_name;
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
  end loop;

  foreach table_name in array array[
    'golf_ball_brands', 'golf_club_brands', 'golf_ball_test_results',
    'golf_clubs', 'golf_courses', 'golf_course_tees', 'golf_holes',
    'golf_tee_hole_yardages', 'golf_hole_geo_features'
  ] loop
    if has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'catalog DELETE must stay revoked on public.%', table_name;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
      or not has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      or not has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE') then
      raise exception 'catalog grants are incomplete on public.%', table_name;
    end if;

    select string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ')
    into policy_text
    from pg_policies
    where schemaname = 'public' and tablename = table_name;

    if policy_text is null
      or policy_text not like '%app_metadata%'
      or policy_text like '%user_metadata%' then
      raise exception 'catalog/course authorization does not use immutable app_metadata on public.%', table_name;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.player_club_distances', 'INSERT')
    or has_table_privilege('authenticated', 'public.player_club_distances', 'UPDATE')
    or has_table_privilege('authenticated', 'public.player_club_distances', 'DELETE') then
    raise exception 'distance projection must remain client-read-only';
  end if;

  foreach table_name in array array[
    'player_club_distances', 'player_favorite_courses', 'player_recent_courses'
  ] loop
    select string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' ')
    into policy_text
    from pg_policies
    where schemaname = 'public' and tablename = table_name;

    if policy_text is null
      or policy_text not like '%auth.uid()%'
      or policy_text like '%user_metadata%' then
      raise exception 'owner policy is not based on auth.uid() for public.%', table_name;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.player_favorite_courses', 'DELETE')
    or not has_table_privilege('authenticated', 'public.player_recent_courses', 'DELETE') then
    raise exception 'owners cannot remove course preferences';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'golf_ball_test_results'
      and column_name = 'test_year' and is_nullable = 'YES'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'golf_ball_test_results'
      and column_name = 'peak_height_yards'
  ) then
    raise exception 'ball test unknown-year or peak-height unit contract is missing';
  end if;

  select pg_get_constraintdef(constraints.oid)
  into unit_constraint_text
  from pg_constraint as constraints
  where constraints.conrelid = 'public.player_club_distances'::regclass
    and constraints.conname = 'player_club_distances_unit_check';

  select pg_get_constraintdef(constraints.oid)
  into confidence_constraint_text
  from pg_constraint as constraints
  where constraints.conrelid = 'public.player_club_distances'::regclass
    and constraints.conname = 'player_club_distances_confidence_check';

  if unit_constraint_text is null
    or unit_constraint_text not like '%YD%'
    or unit_constraint_text not like '%M%'
    or confidence_constraint_text is null
    or confidence_constraint_text not like '%100%' then
    raise exception 'club-distance unit/confidence projection is not aligned with the local-first model';
  end if;

  if exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as schemas on schemas.oid = procedures.pronamespace
    where schemas.nspname = 'public'
      and procedures.proname = 'touch_golf_architecture_record'
      and procedures.prosecdef
  ) then
    raise exception 'golf architecture trigger function must remain SECURITY INVOKER';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.golf_ball_catalog'::regclass
      and tgname = 'golf_ball_catalog_canonical_brand'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.golf_club_catalog'::regclass
      and tgname = 'golf_club_catalog_canonical_brand'
      and not tgisinternal
  ) then
    raise exception 'canonical brand enforcement triggers are missing';
  end if;

  if exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as schemas on schemas.oid = procedures.pronamespace
    where schemas.nspname = 'public'
      and procedures.proname = 'canonicalize_golf_catalog_brand'
      and procedures.prosecdef
  ) then
    raise exception 'canonical brand trigger must remain SECURITY INVOKER';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.golf_ball_brands'::regclass
      and tgname = 'golf_ball_brands_cascade_name'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.golf_club_brands'::regclass
      and tgname = 'golf_club_brands_cascade_name'
      and not tgisinternal
  ) then
    raise exception 'canonical brand rename cascade triggers are missing';
  end if;

  if exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as schemas on schemas.oid = procedures.pronamespace
    where schemas.nspname = 'public'
      and procedures.proname = 'cascade_golf_catalog_brand_name'
      and procedures.prosecdef
  ) then
    raise exception 'brand rename cascade trigger must remain SECURITY INVOKER';
  end if;
end;
$$;

-- Behavioral A/B fixtures. They are transaction-scoped and the final rollback
-- removes the auth users and every application row created below.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'rls-owner@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'rls-other@backyard.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.player_clubs (
  user_id, local_id, custom_brand, custom_model, category, is_current
) values (
  '10000000-0000-4000-8000-000000000001', 'rls-driver', 'QA', 'Owner Driver', 'DRIVER', true
);

insert into public.player_club_distances (
  user_id, player_club_local_id, carry_distance, total_distance, unit, source
) values (
  '10000000-0000-4000-8000-000000000001', 'rls-driver', 230, 245, 'YD', 'MANUAL'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"member"}}',
  true
);

insert into public.golf_clubs (
  id, name, provider, visibility, created_by
) values (
  'rls-private-club', 'Owner private club', 'USER_MANUAL', 'PRIVATE',
  '10000000-0000-4000-8000-000000000001'
);
insert into public.golf_courses (
  id, club_id, name, holes, provider, visibility, created_by
) values
  (
    'rls-private-course', 'rls-private-club', 'Owner private course', 18,
    'USER_MANUAL', 'PRIVATE', '10000000-0000-4000-8000-000000000001'
  ),
  (
    'rls-private-course-2', 'rls-private-club', 'Owner private course two', 18,
    'USER_MANUAL', 'PRIVATE', '10000000-0000-4000-8000-000000000001'
  );
insert into public.player_favorite_courses (user_id, course_id) values (
  '10000000-0000-4000-8000-000000000001', 'rls-private-course'
);

do $$
declare
  visible_rows integer;
  write_denied boolean := false;
begin
  select count(*) into visible_rows
  from public.player_club_distances
  where user_id = '10000000-0000-4000-8000-000000000001';
  if visible_rows <> 1 then
    raise exception 'owner cannot read their club distance';
  end if;

  -- The normalized distance table is a server-owned projection of the CAS
  -- snapshot, so even its owner must not write it through the Data API.
  begin
    update public.player_club_distances
    set carry_distance = 231
    where user_id = '10000000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then
    write_denied := true;
  end;
  if not write_denied then
    raise exception 'authenticated distance projection write unexpectedly succeeded';
  end if;

  update public.golf_courses
  set name = 'Owner private course updated'
  where id = 'rls-private-course';
  get diagnostics visible_rows = row_count;
  if visible_rows <> 1 then
    raise exception 'owner cannot update their private manual course';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"member"}}',
  true
);

do $$
declare
  visible_rows integer;
  denied boolean;
begin
  select count(*) into visible_rows from public.player_club_distances
  where user_id = '10000000-0000-4000-8000-000000000001';
  if visible_rows <> 0 then
    raise exception 'non-owner can read another player club distance';
  end if;

  select count(*) into visible_rows from public.golf_courses
  where id = 'rls-private-course';
  if visible_rows <> 0 then
    raise exception 'non-owner can read a private manual course';
  end if;

  select count(*) into visible_rows from public.player_favorite_courses
  where user_id = '10000000-0000-4000-8000-000000000001';
  if visible_rows <> 0 then
    raise exception 'non-owner can read another player favorites';
  end if;

  denied := false;
  begin
    insert into public.player_favorite_courses (user_id, course_id) values (
      '10000000-0000-4000-8000-000000000001', 'rls-private-course-2'
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'non-owner favorite write unexpectedly succeeded';
  end if;

  denied := false;
  begin
    insert into public.golf_clubs (id, name, provider, visibility, created_by) values (
      'rls-spoofed-club', 'Spoofed', 'USER_MANUAL', 'PRIVATE',
      '10000000-0000-4000-8000-000000000001'
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'non-owner manual course ownership spoof unexpectedly succeeded';
  end if;

  update public.golf_courses set name = 'Spoofed update' where id = 'rls-private-course';
  get diagnostics visible_rows = row_count;
  if visible_rows <> 0 then
    raise exception 'non-owner updated a private manual course';
  end if;

  denied := false;
  begin
    insert into public.golf_ball_brands (id, name) values ('rls-member-brand', 'Member brand');
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'non-admin catalog write unexpectedly succeeded';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}',
  true
);
insert into public.golf_ball_brands (id, name) values ('rls-admin-brand', 'Admin brand');
insert into public.golf_ball_catalog (
  id, brand_id, brand, model, source_name, source_url, verified_at
) values (
  'rls-admin-ball', 'rls-admin-brand', 'Admin brand', 'Canonical ball',
  'Behavioral RLS fixture', 'https://example.invalid/rls-admin-ball', now()
);
insert into public.golf_club_brands (id, name) values ('rls-admin-club-brand', 'Admin club brand');
insert into public.golf_club_catalog (
  id, brand_id, brand, model, category, source_name, source_url, verified_at
) values (
  'rls-admin-club', 'rls-admin-club-brand', 'Admin club brand', 'Canonical club', 'DRIVER',
  'Behavioral RLS fixture', 'https://example.invalid/rls-admin-club', now()
);

update public.golf_ball_brands set name = 'Admin brand renamed'
where id = 'rls-admin-brand';
update public.golf_club_brands set name = 'Admin club brand renamed'
where id = 'rls-admin-club-brand';

do $$
declare
  denied boolean := false;
  ball_brand text;
  ball_search text;
  club_brand text;
  club_search text;
begin
  select brand, search_text into ball_brand, ball_search
  from public.golf_ball_catalog where id = 'rls-admin-ball';
  select brand, search_text into club_brand, club_search
  from public.golf_club_catalog where id = 'rls-admin-club';
  if ball_brand <> 'Admin brand renamed' or ball_search not like 'admin brand renamed %' then
    raise exception 'ball brand rename did not refresh its denormalized search contract';
  end if;
  if club_brand <> 'Admin club brand renamed' or club_search not like 'admin club brand renamed %' then
    raise exception 'club brand rename did not refresh its denormalized search contract';
  end if;

  begin
    update public.golf_ball_catalog
    set brand_id = null
    where id = 'rls-admin-ball';
  exception when check_violation then
    denied := true;
  end;
  if not denied then
    raise exception 'canonical catalog row lost its brand reference';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"member"}}',
  true
);
delete from public.player_favorite_courses
where user_id = '10000000-0000-4000-8000-000000000001'
  and course_id = 'rls-private-course';

do $$
declare remaining integer;
begin
  select count(*) into remaining from public.player_favorite_courses
  where user_id = '10000000-0000-4000-8000-000000000001'
    and course_id = 'rls-private-course';
  if remaining <> 0 then
    raise exception 'owner cannot remove their favorite course';
  end if;
end;
$$;

reset role;

rollback;
