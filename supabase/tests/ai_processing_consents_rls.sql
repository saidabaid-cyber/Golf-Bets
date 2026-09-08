-- Read-only schema/RLS contract for 20260908134650_ai_processing_consents.sql.
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
        and tablename = 'ai_processing_consents') <> 1 then
    raise exception 'consent ledger must expose exactly one self-read policy';
  end if;

  select coalesce(qual, '') || ' ' || coalesce(with_check, '')
  into policy_text
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ai_processing_consents'
    and cmd = 'SELECT'
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
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'client mutation policy unexpectedly exists on consent ledger';
  end if;
end;
$$;

rollback;
