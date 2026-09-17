-- Isolated Preview only. No pgTAP extension/schema changes required.
begin;
do $$
declare t text; expected text; actual text[];
begin
  foreach t in array array['user_statistics_resets','user_statistics_reset_requests'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) then
      raise exception 'missing reset table or RLS: %',t;
    end if;
    expected:=case when t='user_statistics_resets' then 'statistics reset owner read' else 'statistics reset request owner read' end;
    select array_agg(policyname::text order by policyname) into actual from pg_policies
      where schemaname='public' and tablename=t and permissive='PERMISSIVE';
    if actual is distinct from array[expected] then raise exception 'unexpected reset granting policies: %',actual; end if;
    if exists(select 1 from pg_policies where schemaname='public' and tablename=t and permissive='RESTRICTIVE'
      and (policyname<>'account_active_access' or cmd<>'ALL'
        or coalesce(qual,'') not like '%account_data_access_allowed()%'
        or coalesce(with_check,'') not like '%account_data_access_allowed()%')) then
      raise exception 'unexpected restrictive reset policy';
    end if;
    if not has_table_privilege('authenticated','public.'||t,'SELECT')
      or has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') then
      raise exception 'reset ledger must be client read-only';
    end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.user_statistics_reset_requests'::regclass
    and conname='user_statistics_reset_requests_pkey' and contype='p') then raise exception 'missing idempotency primary key'; end if;
  if (select prorettype from pg_proc where oid=to_regprocedure('public.reset_my_statistics(text,uuid)')) is distinct from 'timestamptz'::regtype
    or not has_function_privilege('authenticated','public.reset_my_statistics(text,uuid)','EXECUTE')
    or has_function_privilege('anon','public.reset_my_statistics(text,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.reset_my_statistics(text)','EXECUTE') then
    raise exception 'reset RPC must require authenticated session and request id';
  end if;
  if to_regclass('public.product_usage_events_v2') is null then raise exception 'missing audit events'; end if;
end;
$$;
rollback;
