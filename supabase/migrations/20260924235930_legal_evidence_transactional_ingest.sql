-- Preview-only hardening for the canonical legal evidence ledger.
-- Do not apply to Production during consolidation. A later controlled rollout
-- must first reconcile the Production migration ledger and repeat RLS/RPC QA.

begin;

create or replace function public.record_legal_evidence_batch(
  p_user_id uuid,
  p_environment text,
  p_deployment_ref text,
  p_events jsonb
)
returns table (
  requested_idempotency_key uuid,
  canonical_idempotency_key uuid,
  server_received_at timestamptz,
  replayed boolean,
  deduplicated boolean,
  created boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_event jsonb;
  v_key uuid;
  v_client_occurred_at timestamptz;
  v_prior public.legal_evidence_events%rowtype;
  v_latest public.legal_evidence_events%rowtype;
  v_created public.legal_evidence_events%rowtype;
  v_recent_count integer;
  v_next_received_at timestamptz;
  v_rate_limit constant integer := 40;
  v_rate_window constant interval := interval '10 minutes';
begin
  if p_user_id is null
    or p_environment is null
    or p_environment not in ('production', 'preview', 'development', 'test')
    or p_events is null
    or jsonb_typeof(p_events) <> 'array' then
    raise exception using errcode = '22023', message = 'legal_evidence_batch_invalid';
  end if;
  if jsonb_array_length(p_events) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'legal_evidence_batch_invalid';
  end if;

  -- This transaction-scoped database lock is shared by every application
  -- instance. It serializes deduplication, transition ordering and rate-limit
  -- accounting for exactly one owner/environment ledger.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('legal-evidence:' || p_user_id::text || ':' || p_environment, 0)
  );

  select count(*)::integer
    into v_recent_count
    from public.legal_evidence_events as e
   where e.user_id = p_user_id
     and e.environment = p_environment
     and e.server_received_at >= pg_catalog.clock_timestamp() - v_rate_window;

  select greatest(
      pg_catalog.clock_timestamp(),
      coalesce(max(e.server_received_at) + interval '1 microsecond', pg_catalog.clock_timestamp())
    )
    into v_next_received_at
    from public.legal_evidence_events as e
   where e.user_id = p_user_id
     and e.environment = p_environment;

  for v_event in
    select items.value
      from pg_catalog.jsonb_array_elements(p_events) with ordinality as items(value, ordinal)
     order by items.ordinal
  loop
    if pg_catalog.jsonb_typeof(v_event) <> 'object' then
      raise exception using errcode = '22023', message = 'legal_evidence_batch_invalid';
    end if;

    begin
      v_key := (v_event ->> 'idempotencyKey')::uuid;
      v_client_occurred_at := (v_event ->> 'clientOccurredAt')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'legal_evidence_batch_invalid';
    end;
    if v_key is null or v_client_occurred_at is null then
      raise exception using errcode = '22023', message = 'legal_evidence_batch_invalid';
    end if;

    select e.*
      into v_prior
      from public.legal_evidence_events as e
     where e.user_id = p_user_id
       and e.environment = p_environment
       and e.idempotency_key = v_key;

    if found then
      if v_prior.document_key is distinct from (v_event ->> 'documentKey')
        or v_prior.purpose_key is distinct from (v_event ->> 'subject')
        or v_prior.document_version is distinct from (v_event ->> 'documentVersion')
        or v_prior.document_hash is distinct from (v_event ->> 'documentHash')
        or v_prior.statement_key is distinct from (v_event ->> 'statementKey')
        or v_prior.statement_text is distinct from (v_event ->> 'statementText')
        or v_prior.statement_hash is distinct from (v_event ->> 'statementHash')
        or v_prior.action is distinct from (v_event ->> 'action')
        or v_prior.locale is distinct from (v_event ->> 'locale')
        or v_prior.origin is distinct from (v_event ->> 'origin')
        or v_prior.client_occurred_at is distinct from v_client_occurred_at then
        raise exception using errcode = 'P0001', message = 'legal_evidence_idempotency_conflict';
      end if;

      return query select v_key, v_prior.idempotency_key, v_prior.server_received_at, true, false, false;
      continue;
    end if;

    select e.*
      into v_latest
      from public.legal_evidence_events as e
     where e.user_id = p_user_id
       and e.environment = p_environment
       and e.purpose_key = (v_event ->> 'subject')
     order by e.server_received_at desc, e.idempotency_key desc
     limit 1;

    -- A fresh UUID does not create duplicate evidence when the last effective
    -- decision already has the same canonical meaning. Origin/client clock are
    -- provenance, not decision semantics. Any action or document transition,
    -- including rejection/revocation, is still appended below.
    if found
      and v_latest.document_key is not distinct from (v_event ->> 'documentKey')
      and v_latest.purpose_key is not distinct from (v_event ->> 'subject')
      and v_latest.document_version is not distinct from (v_event ->> 'documentVersion')
      and v_latest.document_hash is not distinct from (v_event ->> 'documentHash')
      and v_latest.statement_key is not distinct from (v_event ->> 'statementKey')
      and v_latest.statement_text is not distinct from (v_event ->> 'statementText')
      and v_latest.statement_hash is not distinct from (v_event ->> 'statementHash')
      and v_latest.action is not distinct from (v_event ->> 'action')
      and v_latest.locale is not distinct from (v_event ->> 'locale') then
      return query select v_key, v_latest.idempotency_key, v_latest.server_received_at, false, true, false;
      continue;
    end if;

    if v_recent_count >= v_rate_limit then
      raise exception using errcode = 'P0001', message = 'legal_evidence_rate_limited';
    end if;

    insert into public.legal_evidence_events (
      user_id,
      environment,
      deployment_ref,
      document_key,
      purpose_key,
      document_version,
      document_hash,
      statement_key,
      statement_text,
      statement_hash,
      action,
      locale,
      origin,
      client_occurred_at,
      server_received_at,
      idempotency_key
    ) values (
      p_user_id,
      p_environment,
      nullif(p_deployment_ref, ''),
      v_event ->> 'documentKey',
      v_event ->> 'subject',
      v_event ->> 'documentVersion',
      v_event ->> 'documentHash',
      v_event ->> 'statementKey',
      v_event ->> 'statementText',
      v_event ->> 'statementHash',
      v_event ->> 'action',
      v_event ->> 'locale',
      v_event ->> 'origin',
      v_client_occurred_at,
      v_next_received_at,
      v_key
    )
    returning * into v_created;

    v_recent_count := v_recent_count + 1;
    v_next_received_at := v_next_received_at + interval '1 microsecond';
    return query select v_key, v_created.idempotency_key, v_created.server_received_at, false, false, true;
  end loop;
end;
$$;

revoke execute on function public.record_legal_evidence_batch(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_legal_evidence_batch(uuid, text, text, jsonb)
  to service_role;

comment on function public.record_legal_evidence_batch(uuid, text, text, jsonb) is
  'Service-only, SECURITY INVOKER transactional legal-evidence ingest. Serializes per user/environment, rate-limits new rows, preserves transitions and deduplicates identical latest decisions.';

commit;
