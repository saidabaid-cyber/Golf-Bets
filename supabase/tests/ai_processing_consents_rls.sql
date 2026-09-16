-- Read-only schema/RLS contract for the canonical ledger and onboarding decisions.
-- Run only against an isolated/local Supabase database after migrations.

begin;

do $$
declare
  policy_text text;
begin
  if to_regclass('public.ai_processing_consents') is null then
    raise exception 'missing public.ai_processing_consents';
  end if;

  if not exists (
    select 1
    from pg_class as relations
    join pg_namespace as schemas on schemas.oid = relations.relnamespace
    where schemas.nspname = 'public'
      and relations.relname = 'ai_processing_consents'
      and relations.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.ai_processing_consents';
  end if;

  if has_table_privilege('anon', 'public.ai_processing_consents', 'SELECT')
    or has_table_privilege('anon', 'public.ai_processing_consents', 'INSERT')
    or has_table_privilege('anon', 'public.ai_processing_consents', 'UPDATE')
    or has_table_privilege('anon', 'public.ai_processing_consents', 'DELETE') then
    raise exception 'anon unexpectedly has consent ledger privileges';
  end if;

  if not has_table_privilege('authenticated', 'public.ai_processing_consents', 'SELECT')
    or has_table_privilege('authenticated', 'public.ai_processing_consents', 'INSERT')
    or has_table_privilege('authenticated', 'public.ai_processing_consents', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ai_processing_consents', 'DELETE') then
    raise exception 'authenticated consent ledger grants are not read-only';
  end if;

  if not has_table_privilege('service_role', 'public.ai_processing_consents', 'SELECT')
    or not has_table_privilege('service_role', 'public.ai_processing_consents', 'INSERT')
    or not has_table_privilege('service_role', 'public.ai_processing_consents', 'UPDATE')
    or has_table_privilege('service_role', 'public.ai_processing_consents', 'DELETE') then
    raise exception 'service_role consent ledger grants are incomplete or destructive';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename = 'ai_processing_consents'
        and permissive = 'PERMISSIVE') <> 1 then
    raise exception 'consent ledger must expose exactly one permissive self-read policy';
  end if;

  select coalesce(qual, '') || ' ' || coalesce(with_check, '')
  into policy_text
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ai_processing_consents'
    and cmd = 'SELECT'
    and permissive = 'PERMISSIVE'
    and roles = array['authenticated']::name[];

  if policy_text is null
    or policy_text not like '%auth.uid()%'
    or policy_text not like '%user_id%'
    or policy_text like '%user_metadata%' then
    raise exception 'consent self-read policy must derive ownership from auth.uid()';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_processing_consents'
      and (cmd in ('INSERT', 'UPDATE', 'DELETE')
        or (cmd = 'ALL' and permissive = 'PERMISSIVE'))
  ) then
    raise exception 'client mutation policy unexpectedly exists on consent ledger';
  end if;

  -- The account lifecycle migration adds a restrictive FOR ALL policy to all
  -- user-data tables. It narrows access; it is not a second granting policy.
  if exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'ai_processing_consents' and permissive = 'RESTRICTIVE'
      and (policyname <> 'account_active_access' or cmd <> 'ALL'
        or roles <> array['authenticated']::name[]
        or lower(regexp_replace(coalesce(qual, ''), '\s', '', 'g'))
          <> '(selectprivate.account_data_access_allowed()asaccount_data_access_allowed)'
        or lower(regexp_replace(coalesce(with_check, ''), '\s', '', 'g'))
          <> '(selectprivate.account_data_access_allowed()asaccount_data_access_allowed)'
        or coalesce(qual, '') like '%user_metadata%'
        or coalesce(with_check, '') like '%user_metadata%')
  ) then
    raise exception 'unexpected restrictive consent access policy';
  end if;

  if to_regprocedure('public.record_ai_processing_consent_decisions(uuid,text,jsonb,text)') is null then
    raise exception 'missing atomic onboarding consent decisions function';
  end if;
  if has_function_privilege('anon', 'public.record_ai_processing_consent_decisions(uuid,text,jsonb,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_ai_processing_consent_decisions(uuid,text,jsonb,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.record_ai_processing_consent_decisions(uuid,text,jsonb,text)', 'EXECUTE') then
    raise exception 'atomic consent decisions must be server-only';
  end if;
  if (select prosecdef from pg_proc
      where oid = 'public.record_ai_processing_consent_decisions(uuid,text,jsonb,text)'::regprocedure) then
    raise exception 'atomic consent function must remain SECURITY INVOKER';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'ai_processing_consents'
      and column_name in ('decision_status', 'source', 'decided_at')) <> 3 then
    raise exception 'missing versioned consent decision audit fields';
  end if;
end;
$$;

rollback;
