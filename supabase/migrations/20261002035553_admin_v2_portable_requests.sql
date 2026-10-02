-- Portable request environment configuration. Empty configuration means PRODUCTION.
-- No project identifiers, seed rows, cleanup or account actions are installed.
begin;
create table if not exists private.admin_runtime_configuration_v2(
 singleton boolean primary key default true check(singleton),
 request_environment text not null check(request_environment in ('PRODUCTION','QA')),
 reason text not null check(length(trim(reason)) between 10 and 1000),
 configured_at timestamptz not null default now()
);
alter table private.admin_runtime_configuration_v2 enable row level security;
revoke all on private.admin_runtime_configuration_v2 from public,anon,authenticated;
grant select,insert,update on private.admin_runtime_configuration_v2 to service_role;
drop policy if exists admin_runtime_operator_only on private.admin_runtime_configuration_v2;
create policy admin_runtime_operator_only on private.admin_runtime_configuration_v2 for all to service_role using(true) with check(true);
create or replace function private.admin_audit_runtime_configuration_v2() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.configured_at:=now();
 insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason)
 values(null,'SERVICE_ROLE','CONFIGURE_ADMIN_RUNTIME','REQUEST','request-environment',case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),new.reason);
 return new;
end $$;
revoke all on function private.admin_audit_runtime_configuration_v2() from public,anon,authenticated;
drop trigger if exists admin_audit_runtime_configuration_v2 on private.admin_runtime_configuration_v2;
create trigger admin_audit_runtime_configuration_v2 before insert or update on private.admin_runtime_configuration_v2 for each row execute function private.admin_audit_runtime_configuration_v2();
create or replace function private.admin_request_environment_v2() returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select request_environment from private.admin_runtime_configuration_v2 where singleton),'PRODUCTION')
$$;
revoke all on function private.admin_request_environment_v2() from public,anon,authenticated;
create or replace function public.admin_simple_request_queue_v2(page_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare request_environment text;
begin
  if not private.account_data_access_allowed() or not private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  if page_offset is null or page_offset<0 or page_offset>100000 then raise exception 'INVALID_PAGE' using errcode='22023'; end if;
  request_environment:=private.admin_request_environment_v2();
  return jsonb_build_object('isolatedQa',request_environment='QA','items',coalesce((
    select jsonb_agg(to_jsonb(visible) order by visible.created_at desc) from (
      select id,title,description,contextual_category,request_status,created_at,data_environment
      from public.feedback_requests
      where data_environment=request_environment
      order by created_at desc limit 40 offset page_offset
    ) visible
  ),'[]'::jsonb));
end $$;
revoke all on function public.admin_simple_request_queue_v2(integer) from public,anon;
grant execute on function public.admin_simple_request_queue_v2(integer) to authenticated;

create or replace function public.admin_review_request_v2(feedback_id uuid,expected_status text,next_status text,review_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.feedback_requests;updated public.feedback_requests;
begin
  if not private.account_data_access_allowed() or not private.admin_has_scope_v1('REQUEST','GLOBAL',null,'REVIEW') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if next_status not in ('IN_REVIEW','APPROVED','RESOLVED','REJECTED') or next_status is null or length(trim(coalesce(review_reason,''))) not between 3 and 1000 then raise exception 'INVALID_REVIEW'; end if;
  select * into prior from public.feedback_requests where id=feedback_id for update;
  if prior.id is null or not (prior.data_environment=private.admin_request_environment_v2()) then raise exception 'REQUEST_NOT_AVAILABLE'; end if;
  if expected_status is null or prior.request_status<>expected_status then raise exception 'STALE_REQUEST' using errcode='40001'; end if;
  if prior.request_status in ('RESOLVED','REJECTED') or prior.request_status=next_status then raise exception 'REQUEST_CLOSED_OR_UNCHANGED'; end if;
  update public.feedback_requests set request_status=next_status,updated_at=now(),resolved_at=case when next_status in ('RESOLVED','REJECTED') then now() else null end where id=feedback_id returning * into updated;
  perform private.admin_audit_v1('REVIEW_REQUEST','REQUEST',feedback_id::text,jsonb_build_object('status',prior.request_status),jsonb_build_object('status',updated.request_status,'dataEnvironment',prior.data_environment),review_reason,null);
  return jsonb_build_object('id',feedback_id,'status',updated.request_status);
end $$;
revoke all on function public.admin_review_request_v2(uuid,text,text,text) from public,anon;
grant execute on function public.admin_review_request_v2(uuid,text,text,text) to authenticated;
commit;
