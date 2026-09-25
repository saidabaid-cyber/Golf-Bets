-- Polla Live owner isolation, grants, audit and lifecycle contract.
-- Synthetic fixtures and transaction-scoped test grants always roll back.
begin;

-- Clear only this contract's fixed synthetic identities inside the transaction.
-- Rollback restores any pre-existing rows if an older interrupted harness used
-- the same IDs.
delete from public.score_audit_log
where tournament_id in (
  '47100000-0000-4000-8000-000000000001'::uuid,
  '47100000-0000-4000-8000-000000000002'::uuid
);
delete from public.tournaments
where id in (
  '47100000-0000-4000-8000-000000000001'::uuid,
  '47100000-0000-4000-8000-000000000002'::uuid,
  '47100000-0000-4000-8000-000000000003'::uuid,
  '47100000-0000-4000-8000-000000000004'::uuid
)
or short_code in ('PQA1A', 'PQA1B', 'PQADENY', 'PQAOWN');
delete from private.account_lifecycle_state
where user_id in (
  '47000000-0000-4000-8000-000000000001'::uuid,
  '47000000-0000-4000-8000-000000000002'::uuid
);
delete from auth.users
where id in (
  '47000000-0000-4000-8000-000000000001'::uuid,
  '47000000-0000-4000-8000-000000000002'::uuid
);

do $$
declare
  table_name text;
  sensitive_function regprocedure;
begin
  foreach table_name in array array[
    'tournaments',
    'tournament_groups',
    'tournament_players',
    'group_members',
    'tournament_access',
    'tournament_scores',
    'score_audit_log',
    'tournament_prizes',
    'tournament_oyes',
    'tournament_invites',
    'tournament_leaderboard_events',
    'polla_join_attempts'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'missing Polla table public.%', table_name;
    end if;
    if not exists (
      select 1
      from pg_class relation
      join pg_namespace schema on schema.oid = relation.relnamespace
      where schema.nspname = 'public'
        and relation.relname = table_name
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = 'account_active_access'
        and permissive = 'RESTRICTIVE'
        and cmd = 'ALL'
        and 'authenticated' = any(roles)
        and coalesce(qual, '') like '%account_data_access_allowed%'
        and coalesce(with_check, '') like '%account_data_access_allowed%'
    ) then
      raise exception 'lifecycle guard is missing or permissive on public.%', table_name;
    end if;
  end loop;

  if to_regprocedure('private.account_data_access_allowed()') is null then
    raise exception 'missing private.account_data_access_allowed()';
  end if;

  if has_table_privilege('anon', 'public.tournament_players', 'SELECT')
    or has_table_privilege('anon', 'public.tournament_scores', 'SELECT') then
    raise exception 'anon unexpectedly has direct player or score SELECT grants';
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('tournament_scores', 'tournament_groups')
  ) then
    raise exception 'raw Polla tables must not be published through Realtime';
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournament_leaderboard_events'
  ) then
    raise exception 'sanitized Polla leaderboard event signal is not published';
  end if;

  foreach sensitive_function in array array[
    'public.join_polla(uuid,uuid,text)'::regprocedure,
    'public.join_polla_secure(uuid,uuid,text,text)'::regprocedure,
    'public.resolve_polla_access(text)'::regprocedure,
    'public.add_tournament_player(uuid,uuid,text,numeric,text,boolean)'::regprocedure,
    'public.set_tournament_player_pin(uuid,text)'::regprocedure,
    'public.record_tournament_oyes(uuid,smallint,uuid,numeric,uuid,boolean)'::regprocedure,
    'public.audit_score_change()'::regprocedure,
    'public.touch_tournament_score()'::regprocedure,
    'public.sync_tournament_leaderboard_event()'::regprocedure,
    'public.signal_leaderboard_change()'::regprocedure
  ] loop
    if has_function_privilege('anon', sensitive_function, 'EXECUTE')
      or has_function_privilege('authenticated', sensitive_function, 'EXECUTE')
      or not has_function_privilege('service_role', sensitive_function, 'EXECUTE') then
      raise exception 'Polla function grants are unsafe for %', sensitive_function;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.is_polla_admin(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.is_polla_admin(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.is_polla_admin(uuid)', 'EXECUTE') then
    raise exception 'is_polla_admin grants no longer match its authenticated RLS-helper contract';
  end if;

  if has_table_privilege('anon', 'public.polla_join_attempts', 'SELECT')
    or has_table_privilege('anon', 'public.polla_join_attempts', 'INSERT')
    or has_table_privilege('anon', 'public.polla_join_attempts', 'UPDATE')
    or has_table_privilege('anon', 'public.polla_join_attempts', 'DELETE')
    or has_table_privilege('authenticated', 'public.polla_join_attempts', 'SELECT')
    or has_table_privilege('authenticated', 'public.polla_join_attempts', 'INSERT')
    or has_table_privilege('authenticated', 'public.polla_join_attempts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.polla_join_attempts', 'DELETE')
    or not has_table_privilege('service_role', 'public.polla_join_attempts', 'SELECT')
    or not has_table_privilege('service_role', 'public.polla_join_attempts', 'INSERT')
    or not has_table_privilege('service_role', 'public.polla_join_attempts', 'UPDATE')
    or not has_table_privilege('service_role', 'public.polla_join_attempts', 'DELETE') then
    raise exception 'polla_join_attempts must remain server-only';
  end if;
  if has_sequence_privilege('anon', 'public.polla_join_attempts_id_seq', 'USAGE')
    or has_sequence_privilege('anon', 'public.polla_join_attempts_id_seq', 'SELECT')
    or has_sequence_privilege('authenticated', 'public.polla_join_attempts_id_seq', 'USAGE')
    or has_sequence_privilege('authenticated', 'public.polla_join_attempts_id_seq', 'SELECT')
    or not has_sequence_privilege('service_role', 'public.polla_join_attempts_id_seq', 'USAGE')
    or not has_sequence_privilege('service_role', 'public.polla_join_attempts_id_seq', 'SELECT') then
    raise exception 'polla_join_attempts identity sequence must remain server-only';
  end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('47000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'polla-owner-a@backyard.invalid', '', now(), '{}', '{}', now(), now()),
  ('47000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'polla-owner-b@backyard.invalid', '', now(), '{}', '{}', now(), now());

insert into public.tournaments (
  id, public_id, short_code, created_by, name, tournament_date,
  course_name, course_snapshot, holes, start_hole, format
) values
  (
    '47100000-0000-4000-8000-000000000001',
    '47100000-0000-4000-8000-000000000101',
    'PQA1A',
    '47000000-0000-4000-8000-000000000001',
    'Polla RLS Owner A', current_date, 'Synthetic Course A', '[]'::jsonb, 18, 1, 'both'
  ),
  (
    '47100000-0000-4000-8000-000000000002',
    '47100000-0000-4000-8000-000000000102',
    'PQA1B',
    '47000000-0000-4000-8000-000000000002',
    'Polla RLS Owner B', current_date, 'Synthetic Course B', '[]'::jsonb, 18, 1, 'both'
  );

insert into public.tournament_groups(id, tournament_id, name) values
  ('47200000-0000-4000-8000-000000000001', '47100000-0000-4000-8000-000000000001', 'Group A'),
  ('47200000-0000-4000-8000-000000000002', '47100000-0000-4000-8000-000000000002', 'Group B');

insert into public.tournament_players(id, tournament_id, name, handicap) values
  ('47300000-0000-4000-8000-000000000001', '47100000-0000-4000-8000-000000000001', 'Player A', 8),
  ('47300000-0000-4000-8000-000000000002', '47100000-0000-4000-8000-000000000002', 'Player B', 12);

insert into public.group_members(group_id, tournament_player_id, is_scorer) values
  ('47200000-0000-4000-8000-000000000001', '47300000-0000-4000-8000-000000000001', true),
  ('47200000-0000-4000-8000-000000000002', '47300000-0000-4000-8000-000000000002', true);

insert into public.tournament_scores(
  tournament_id, group_id, player_id, hole, score, entered_by
) values
  (
    '47100000-0000-4000-8000-000000000001',
    '47200000-0000-4000-8000-000000000001',
    '47300000-0000-4000-8000-000000000001',
    1, 4, '47000000-0000-4000-8000-000000000001'
  ),
  (
    '47100000-0000-4000-8000-000000000002',
    '47200000-0000-4000-8000-000000000002',
    '47300000-0000-4000-8000-000000000002',
    1, 6, '47000000-0000-4000-8000-000000000002'
  );

-- The production architecture keeps direct Polla tables server-only. These
-- transaction-scoped grants exercise the existing RLS predicates themselves;
-- the structural assertions above verify the real anon/server grant boundary.
grant select, insert, update, delete on table
  public.tournaments,
  public.tournament_groups,
  public.tournament_players,
  public.group_members,
  public.tournament_scores
to authenticated;
grant select on table public.score_audit_log to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '47000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  changed integer;
  denied boolean := false;
begin
  if not exists (select 1 from public.tournaments where id = '47100000-0000-4000-8000-000000000001')
    or exists (select 1 from public.tournaments where id = '47100000-0000-4000-8000-000000000002') then
    raise exception 'owner A tournament isolation failed';
  end if;
  if not exists (select 1 from public.tournament_groups where id = '47200000-0000-4000-8000-000000000001')
    or exists (select 1 from public.tournament_groups where id = '47200000-0000-4000-8000-000000000002') then
    raise exception 'owner A group isolation failed';
  end if;
  if not exists (select 1 from public.tournament_players where id = '47300000-0000-4000-8000-000000000001')
    or exists (select 1 from public.tournament_players where id = '47300000-0000-4000-8000-000000000002') then
    raise exception 'owner A player isolation failed';
  end if;
  if not exists (select 1 from public.group_members where group_id = '47200000-0000-4000-8000-000000000001')
    or exists (select 1 from public.group_members where group_id = '47200000-0000-4000-8000-000000000002') then
    raise exception 'owner A membership isolation failed';
  end if;
  if not exists (select 1 from public.tournament_scores where tournament_id = '47100000-0000-4000-8000-000000000001')
    or exists (select 1 from public.tournament_scores where tournament_id = '47100000-0000-4000-8000-000000000002') then
    raise exception 'owner A score isolation failed';
  end if;

  insert into public.tournaments (
    id, public_id, short_code, created_by, name, tournament_date,
    course_name, course_snapshot, holes, start_hole, format
  ) values (
    '47100000-0000-4000-8000-000000000004',
    '47100000-0000-4000-8000-000000000104',
    'PQAOWN',
    '47000000-0000-4000-8000-000000000001',
    'Owner A positive insert', current_date, 'Synthetic Course', '[]'::jsonb, 18, 1, 'both'
  );
  if not exists (
    select 1 from public.tournaments
    where id = '47100000-0000-4000-8000-000000000004'
      and created_by = '47000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'owner A could not create its own tournament';
  end if;

  begin
    insert into public.tournaments (
      id, public_id, short_code, created_by, name, tournament_date,
      course_name, course_snapshot, holes, start_hole, format
    ) values (
      '47100000-0000-4000-8000-000000000003',
      '47100000-0000-4000-8000-000000000103',
      'PQADENY',
      '47000000-0000-4000-8000-000000000002',
      'Must be denied', current_date, 'Synthetic Course', '[]'::jsonb, 18, 1, 'both'
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'owner A created a tournament for owner B'; end if;

  update public.tournament_scores
  set score = 9
  where tournament_id = '47100000-0000-4000-8000-000000000002'
    and player_id = '47300000-0000-4000-8000-000000000002'
    and hole = 1;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'owner A updated owner B score'; end if;
end;
$$;

update public.tournament_scores
set score = 5,
    entered_by = '47000000-0000-4000-8000-000000000001'
where tournament_id = '47100000-0000-4000-8000-000000000001'
  and player_id = '47300000-0000-4000-8000-000000000001'
  and hole = 1;

do $$
declare
  audit_rows integer;
begin
  select count(*) into audit_rows
  from public.score_audit_log
  where tournament_id = '47100000-0000-4000-8000-000000000001'
    and player_id = '47300000-0000-4000-8000-000000000001'
    and hole = 1
    and old_score = 4
    and new_score = 5
    and changed_by = '47000000-0000-4000-8000-000000000001';
  if audit_rows <> 1 then
    raise exception 'owner A score update did not append exact old/new audit evidence';
  end if;
  if exists (
    select 1 from public.score_audit_log
    where tournament_id = '47100000-0000-4000-8000-000000000002'
  ) then
    raise exception 'owner A read owner B score audit';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '47000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
begin
  if not exists (select 1 from public.tournaments where id = '47100000-0000-4000-8000-000000000002')
    or exists (select 1 from public.tournaments where id = '47100000-0000-4000-8000-000000000001') then
    raise exception 'owner B tournament isolation failed';
  end if;
  if not exists (select 1 from public.tournament_groups where id = '47200000-0000-4000-8000-000000000002')
    or exists (select 1 from public.tournament_groups where id = '47200000-0000-4000-8000-000000000001') then
    raise exception 'owner B group isolation failed';
  end if;
  if not exists (select 1 from public.tournament_players where id = '47300000-0000-4000-8000-000000000002')
    or exists (select 1 from public.tournament_players where id = '47300000-0000-4000-8000-000000000001') then
    raise exception 'owner B player isolation failed';
  end if;
  if not exists (select 1 from public.group_members where group_id = '47200000-0000-4000-8000-000000000002')
    or exists (select 1 from public.group_members where group_id = '47200000-0000-4000-8000-000000000001') then
    raise exception 'owner B membership isolation failed';
  end if;
  if not exists (select 1 from public.tournament_scores where tournament_id = '47100000-0000-4000-8000-000000000002')
    or exists (select 1 from public.tournament_scores where tournament_id = '47100000-0000-4000-8000-000000000001') then
    raise exception 'owner B score isolation failed';
  end if;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare
  visible integer;
  denied boolean;
begin
  denied := false;
  begin
    select count(*) into visible from public.tournament_players;
    if visible <> 0 then raise exception 'anon read tournament players'; end if;
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied and visible <> 0 then raise exception 'anon read tournament players'; end if;

  denied := false;
  begin
    select count(*) into visible from public.tournament_scores;
    if visible <> 0 then raise exception 'anon read tournament scores'; end if;
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied and visible <> 0 then raise exception 'anon read tournament scores'; end if;
end;
$$;

reset role;
insert into private.account_lifecycle_state(user_id, account_status, archived_at)
values ('47000000-0000-4000-8000-000000000001', 'archived', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '47000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  visible integer;
  changed integer;
begin
  select count(*) into visible from public.tournaments
  where id = '47100000-0000-4000-8000-000000000001';
  if visible <> 0 then raise exception 'archived owner retained tournament access'; end if;
  select count(*) into visible from public.tournament_groups
  where id = '47200000-0000-4000-8000-000000000001';
  if visible <> 0 then raise exception 'archived owner retained group access'; end if;
  select count(*) into visible from public.tournament_players
  where id = '47300000-0000-4000-8000-000000000001';
  if visible <> 0 then raise exception 'archived owner retained player access'; end if;
  select count(*) into visible from public.tournament_scores
  where tournament_id = '47100000-0000-4000-8000-000000000001';
  if visible <> 0 then raise exception 'archived owner retained score access'; end if;
  select count(*) into visible from public.score_audit_log
  where tournament_id = '47100000-0000-4000-8000-000000000001';
  if visible <> 0 then raise exception 'archived owner retained score-audit access'; end if;

  update public.tournament_scores
  set score = 7
  where tournament_id = '47100000-0000-4000-8000-000000000001'
    and player_id = '47300000-0000-4000-8000-000000000001'
    and hole = 1;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'archived owner updated a score'; end if;
end;
$$;

reset role;
rollback;
