begin;

do $$
declare
  policy_count integer;
  ingest_oid oid;
  ingest_is_definer boolean;
  ingest_config text[];
begin
  if to_regclass('public.legal_evidence_events') is null then
    raise exception 'missing public.legal_evidence_events';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.legal_evidence_events'::regclass) then
    raise exception 'RLS is not enabled on public.legal_evidence_events';
  end if;
  if has_table_privilege('anon', 'public.legal_evidence_events', 'SELECT')
    or has_table_privilege('anon', 'public.legal_evidence_events', 'INSERT')
    or has_table_privilege('anon', 'public.legal_evidence_events', 'UPDATE')
    or has_table_privilege('anon', 'public.legal_evidence_events', 'DELETE') then
    raise exception 'anon unexpectedly has legal evidence privileges';
  end if;
  if not has_table_privilege('authenticated', 'public.legal_evidence_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.legal_evidence_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.legal_evidence_events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.legal_evidence_events', 'DELETE') then
    raise exception 'authenticated legal evidence grants are not read-only';
  end if;
  if not has_table_privilege('service_role', 'public.legal_evidence_events', 'SELECT')
    or not has_table_privilege('service_role', 'public.legal_evidence_events', 'INSERT')
    or has_table_privilege('service_role', 'public.legal_evidence_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.legal_evidence_events', 'DELETE') then
    raise exception 'service_role legal evidence grants are not append-only';
  end if;
  select count(*) into policy_count from pg_policies
    where schemaname = 'public' and tablename = 'legal_evidence_events'
      and policyname not in ('legal_evidence_events_self_read', 'account_active_access');
  if policy_count <> 0 then raise exception 'legal evidence exposes an unexpected RLS policy'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'legal_evidence_events'
      and policyname = 'legal_evidence_events_self_read'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%auth.uid()%user_id%'
  ) then raise exception 'missing authenticated owner-read legal evidence policy'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'legal_evidence_events'
      and policyname = 'account_active_access'
      and permissive = 'RESTRICTIVE'
      and cmd = 'ALL'
      and roles = array['authenticated']::name[]
      and qual like '%private.account_data_access_allowed()%'
      and with_check like '%private.account_data_access_allowed()%'
  ) then raise exception 'missing restrictive account lifecycle policy on legal evidence'; end if;

  ingest_oid := to_regprocedure('public.record_legal_evidence_batch(uuid,text,text,jsonb)');
  if ingest_oid is null then raise exception 'missing transactional legal evidence ingest RPC'; end if;
  select p.prosecdef, p.proconfig into ingest_is_definer, ingest_config
    from pg_proc as p where p.oid = ingest_oid;
  if ingest_is_definer then raise exception 'legal evidence ingest RPC must be SECURITY INVOKER'; end if;
  if ingest_config is null or not exists (
    select 1 from unnest(ingest_config) as setting
    where split_part(setting, '=', 1) = 'search_path'
      and split_part(setting, '=', 2) in ('', '""')
  ) then
    raise exception 'legal evidence ingest RPC does not pin an empty search_path';
  end if;
  if has_function_privilege('anon', ingest_oid, 'EXECUTE')
    or has_function_privilege('authenticated', ingest_oid, 'EXECUTE')
    or not has_function_privilege('service_role', ingest_oid, 'EXECUTE') then
    raise exception 'legal evidence ingest RPC grants are not service-only';
  end if;
end $$;

insert into auth.users (id) values
  ('40000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000003');

set local role service_role;
do $$
declare
  receipt record;
  stored_count integer;
begin
  select * into receipt from public.record_legal_evidence_batch(
    '40000000-0000-4000-8000-000000000003',
    'preview',
    'rls-contract',
    jsonb_build_array(jsonb_build_object(
      'subject', 'terms',
      'action', 'accepted',
      'documentKey', 'terms',
      'documentVersion', 'test-v1',
      'documentHash', repeat('a', 64),
      'statementKey', 'terms.accepted.test-v1',
      'statementText', 'Synthetic service-only RPC acceptance',
      'statementHash', repeat('b', 64),
      'locale', 'es-MX',
      'origin', 'onboarding',
      'clientOccurredAt', '2026-09-24T12:00:00.000Z',
      'idempotencyKey', '41000000-0000-4000-8000-000000000003'
    ))
  );
  if not receipt.created or receipt.replayed or receipt.deduplicated then
    raise exception 'service-only ingest did not create its first evidence event';
  end if;

  select * into receipt from public.record_legal_evidence_batch(
    '40000000-0000-4000-8000-000000000003',
    'preview',
    'rls-contract',
    jsonb_build_array(jsonb_build_object(
      'subject', 'terms',
      'action', 'accepted',
      'documentKey', 'terms',
      'documentVersion', 'test-v1',
      'documentHash', repeat('a', 64),
      'statementKey', 'terms.accepted.test-v1',
      'statementText', 'Synthetic service-only RPC acceptance',
      'statementHash', repeat('b', 64),
      'locale', 'es-MX',
      'origin', 'existing_user_update',
      'clientOccurredAt', '2026-09-24T12:05:00.000Z',
      'idempotencyKey', '41000000-0000-4000-8000-000000000004'
    ))
  );
  if receipt.created or receipt.replayed or not receipt.deduplicated
    or receipt.canonical_idempotency_key <> '41000000-0000-4000-8000-000000000003'::uuid then
    raise exception 'service-only ingest did not semantically deduplicate the latest decision';
  end if;

  select count(*) into stored_count from public.legal_evidence_events
   where user_id = '40000000-0000-4000-8000-000000000003';
  if stored_count <> 1 then raise exception 'semantic dedup created % legal evidence rows', stored_count; end if;
end $$;
reset role;

insert into public.legal_evidence_events (
  user_id, environment, document_key, purpose_key, document_version,
  document_hash, statement_key, statement_text, statement_hash, action,
  locale, origin, client_occurred_at, idempotency_key
) values
  ('40000000-0000-4000-8000-000000000001', 'preview', 'terms', 'terms', 'test-v1', repeat('a', 64), 'terms.accepted.test-v1', 'Synthetic owner A acceptance', repeat('b', 64), 'accepted', 'es-MX', 'onboarding', now(), '41000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', 'preview', 'terms', 'terms', 'test-v1', repeat('a', 64), 'terms.accepted.test-v1', 'Synthetic owner B acceptance', repeat('b', 64), 'accepted', 'es-MX', 'onboarding', now(), '41000000-0000-4000-8000-000000000002');

-- The force flag is transactional test scaffolding: it makes owner/superuser-like
-- local harnesses exercise the same policy path as an authenticated API role.
alter table public.legal_evidence_events force row level security;
set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  visible_count integer;
  denied boolean := false;
begin
  select count(*) into visible_count from public.legal_evidence_events;
  if visible_count <> 1 then raise exception 'owner A legal evidence visibility count was %', visible_count; end if;
  if not exists (select 1 from public.legal_evidence_events where user_id = '40000000-0000-4000-8000-000000000001') then
    raise exception 'owner A cannot read own legal evidence';
  end if;
  begin
    insert into public.legal_evidence_events (
      user_id, environment, document_key, purpose_key, document_version,
      document_hash, statement_key, statement_text, statement_hash, action,
      locale, origin, client_occurred_at, idempotency_key
    ) values (
      '40000000-0000-4000-8000-000000000001', 'preview', 'terms', 'terms', 'test-v1',
      repeat('a', 64), 'terms.accepted.test-v1', 'Client write must fail', repeat('b', 64), 'accepted',
      'es-MX', 'onboarding', now(), '41000000-0000-4000-8000-000000000003'
    );
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated client inserted legal evidence'; end if;
end $$;

do $$
declare denied boolean := false;
begin
  begin
    perform * from public.record_legal_evidence_batch(
      '40000000-0000-4000-8000-000000000001',
      'preview',
      null,
      '[]'::jsonb
    );
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated client executed legal evidence ingest RPC'; end if;
end $$;

-- A stale authenticated session must lose even owner visibility once account
-- lifecycle state closes the account. The write is privileged test scaffolding
-- and is rolled back with every other fixture below.
reset role;
insert into private.account_lifecycle_state (user_id, account_status)
values ('40000000-0000-4000-8000-000000000001', 'archived')
on conflict (user_id) do update set account_status = excluded.account_status;
set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare visible_count integer;
begin
  select count(*) into visible_count from public.legal_evidence_events;
  if visible_count <> 0 then raise exception 'archived account retained legal evidence visibility'; end if;
end $$;

rollback;
