-- No pgTAP dependency; unexpected granting policies still fail.
begin;
do $$
declare t text; actual text[];
begin
  foreach t in array array['round_shots_v2','product_usage_events_v2'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) then
      raise exception 'missing table or RLS: %',t;
    end if;
    if exists(select 1 from pg_policies where schemaname='public' and tablename=t and permissive='RESTRICTIVE'
      and (policyname<>'account_active_access' or cmd<>'ALL'
        or coalesce(qual,'') not like '%account_data_access_allowed()%'
        or coalesce(with_check,'') not like '%account_data_access_allowed()%')) then
      raise exception 'unexpected restrictive policy on %',t;
    end if;
  end loop;
  select array_agg(policyname::text order by policyname) into actual from pg_policies
    where schemaname='public' and tablename='round_shots_v2' and permissive='PERMISSIVE';
  if actual is distinct from array['round shots authorized insert','round shots owner delete','round shots owner update','round shots participant read'] then
    raise exception 'unexpected shot granting policies: %',actual;
  end if;
  select array_agg(policyname::text order by policyname) into actual from pg_policies
    where schemaname='public' and tablename='product_usage_events_v2' and permissive='PERMISSIVE';
  if actual is distinct from array['usage events self insert'] then raise exception 'unexpected analytics granting policies'; end if;
  if to_regclass('public.round_shots_v2_round_player_idx') is null
    or to_regclass('public.product_usage_events_v2_name_time_idx') is null then raise exception 'required indexes missing'; end if;
  if (select prorettype from pg_proc where oid=to_regprocedure('public.phase2_admin_aggregate_metrics()')) is distinct from 'jsonb'::regtype
    or not has_function_privilege('authenticated','public.phase2_admin_aggregate_metrics()','EXECUTE') then
    raise exception 'aggregate RPC return/grant contract changed';
  end if;
end;
$$;
rollback;
