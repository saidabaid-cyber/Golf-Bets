-- One canonical ledger for onboarding choices, existing-account choices and
-- later settings. Declining is a resolved choice, never a fabricated acceptance.
alter table public.ai_processing_consents
  add column if not exists decision_status text,
  add column if not exists source text not null default 'legacy',
  add column if not exists decided_at timestamptz;

update public.ai_processing_consents
set decision_status = case when revoked_at is null then 'accepted' else 'revoked' end,
    decided_at = coalesce(revoked_at, accepted_at)
where decision_status is null;

alter table public.ai_processing_consents
  alter column accepted_at drop not null,
  alter column accepted_at drop default,
  alter column decision_status set not null,
  alter column decided_at set not null;

alter table public.ai_processing_consents
  drop constraint if exists ai_processing_consents_scope_check,
  drop constraint if exists ai_processing_consents_decision_shape,
  drop constraint if exists ai_processing_consents_source;
alter table public.ai_processing_consents
  add constraint ai_processing_consents_scope_check check (scope in (
    'AI_PROVIDER_PROCESSING_CONSENT', 'AI_IMAGE_PROCESSING_CONSENT', 'AI_LAUNCH_MONITOR_PROCESSING_CONSENT'
  )),
  add constraint ai_processing_consents_decision_shape check (
    (decision_status = 'accepted' and accepted_at is not null and revoked_at is null)
    or (decision_status = 'declined' and accepted_at is null and revoked_at is null)
    or (decision_status = 'revoked' and accepted_at is not null and revoked_at is not null)
  ),
  add constraint ai_processing_consents_source
    check (source in ('onboarding', 'account_update', 'settings', 'legacy'));

drop index if exists public.ai_processing_consents_one_active_scope_idx;
create unique index ai_processing_consents_one_active_scope_idx
  on public.ai_processing_consents (user_id, scope, policy_version)
  where decision_status = 'accepted' and revoked_at is null;

-- Only the server calls this function after verifying Auth.getUser and the
-- account lifecycle state. No browser-provided user id reaches this argument.
-- SECURITY INVOKER deliberately avoids a publicly exposed privilege escalation.
create or replace function public.record_ai_processing_consent_decisions(
  p_user_id uuid,
  p_policy_version text,
  p_decisions jsonb,
  p_source text
)
returns setof public.ai_processing_consents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  latest public.ai_processing_consents%rowtype;
  chosen_scope text;
  accepted boolean;
  decision_time timestamptz := clock_timestamp();
begin
  if p_user_id is null
    or p_policy_version is null or char_length(p_policy_version) not between 1 and 80
    or p_source is null or p_source not in ('onboarding', 'account_update', 'settings')
    or p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'Invalid consent decision request' using errcode = '22023';
  end if;
  if jsonb_array_length(p_decisions) not between 1 and 3 then
    raise exception 'Invalid consent decision count' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_decisions) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'scope' and item ? 'accepted')
      or item - 'scope' - 'accepted' <> '{}'::jsonb
      or jsonb_typeof(item->'accepted') <> 'boolean'
      or coalesce(item->>'scope', '') not in ('AI_PROVIDER_PROCESSING_CONSENT', 'AI_IMAGE_PROCESSING_CONSENT', 'AI_LAUNCH_MONITOR_PROCESSING_CONSENT') then
      raise exception 'Invalid consent decision' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct value->>'scope') from jsonb_array_elements(p_decisions)) <> jsonb_array_length(p_decisions) then
    raise exception 'Duplicate consent scope' using errcode = '22023';
  end if;

  -- Serializes checkpoints/settings for one account, including empty-ledger
  -- races. A stale onboarding submission can never override a later revocation.
  perform pg_advisory_xact_lock(hashtextextended('ai-processing-consent:' || p_user_id::text, 0));
  for item in select value from jsonb_array_elements(p_decisions) loop
    chosen_scope := item->>'scope';
    accepted := (item->>'accepted')::boolean;
    select * into latest from public.ai_processing_consents c
      where c.user_id = p_user_id and c.scope = chosen_scope and c.policy_version = p_policy_version
      order by c.id desc limit 1;

    if found and p_source <> 'settings' then continue; end if;
    if latest.id is not null and latest.decision_status = 'accepted' then
      if not accepted then
        update public.ai_processing_consents
          set decision_status = 'revoked', revoked_at = greatest(decision_time, latest.accepted_at),
              decided_at = greatest(decision_time, latest.accepted_at), updated_at = decision_time
          where id = latest.id and user_id = p_user_id;
      end if;
      continue;
    end if;
    -- Repeated opt-out is idempotent. Reauthorization appends an acceptance,
    -- retaining the original refusal/revocation history and original source.
    if latest.id is not null and not accepted then continue; end if;
    insert into public.ai_processing_consents
      (user_id, scope, policy_version, decision_status, source, decided_at, accepted_at, locale, updated_at)
      values (p_user_id, chosen_scope, p_policy_version,
        case when accepted then 'accepted' else 'declined' end, p_source, decision_time,
        case when accepted then decision_time else null end, 'es-MX', decision_time);
  end loop;

  return query select distinct on (c.scope) c.* from public.ai_processing_consents c
    where c.user_id = p_user_id and c.policy_version = p_policy_version
    order by c.scope, c.id desc;
end;
$$;

revoke all on function public.record_ai_processing_consent_decisions(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.record_ai_processing_consent_decisions(uuid, text, jsonb, text)
  to service_role;
comment on function public.record_ai_processing_consent_decisions(uuid, text, jsonb, text) is
  'Server-only atomic AI choices. Onboarding/account_update fill missing scopes only; settings can explicitly accept/revoke. LEGAL_REVIEW_REQUIRED for policy wording and mandatory/optional classification.';
