begin;
alter table public.feedback_requests drop constraint feedback_requests_request_status_check;
alter table public.feedback_requests add constraint feedback_requests_request_status_check
check(request_status in ('NEW','IN_REVIEW','APPROVED','RESOLVED','REJECTED'));
create function public.admin_review_request_v2(feedback_id uuid,expected_status text,next_status text,review_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.feedback_requests;updated public.feedback_requests;
begin
  if not private.account_data_access_allowed() or not private.admin_has_scope_v1('REQUEST','GLOBAL',null,'REVIEW') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if next_status not in ('IN_REVIEW','APPROVED','RESOLVED','REJECTED') or next_status is null or length(trim(coalesce(review_reason,''))) not between 3 and 1000 then raise exception 'INVALID_REVIEW'; end if;
  select * into prior from public.feedback_requests where id=feedback_id for update;
  if prior.id is null or prior.data_environment<>'PRODUCTION' then raise exception 'REQUEST_NOT_AVAILABLE'; end if;
  if expected_status is null or prior.request_status<>expected_status then raise exception 'STALE_REQUEST' using errcode='40001'; end if;
  if prior.request_status in ('RESOLVED','REJECTED') or prior.request_status=next_status then raise exception 'REQUEST_CLOSED_OR_UNCHANGED'; end if;
  update public.feedback_requests set request_status=next_status,updated_at=now(),resolved_at=case when next_status in ('RESOLVED','REJECTED') then now() else null end where id=feedback_id returning * into updated;
  perform private.admin_audit_v1('REVIEW_REQUEST','REQUEST',feedback_id::text,jsonb_build_object('status',prior.request_status),jsonb_build_object('status',updated.request_status),review_reason,null);
  return jsonb_build_object('id',feedback_id,'status',updated.request_status);
end;
$$;
revoke all on function public.admin_review_request_v2(uuid,text,text,text) from public,anon;
grant execute on function public.admin_review_request_v2(uuid,text,text,text) to authenticated;
commit;
