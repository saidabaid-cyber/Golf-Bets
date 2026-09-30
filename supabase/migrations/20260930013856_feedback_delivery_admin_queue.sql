begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Rich, server-filtered support queue. The existing v1/v2 RPCs remain intact
-- for older deployments; this additive version exposes only fields required by
-- authorized support operators.
create function public.admin_feedback_queue_page_v3(
  queue_limit integer default 50,
  queue_offset integer default 0,
  include_non_operational boolean default false
)
returns table(
  id uuid,
  user_id uuid,
  category text,
  contextual_category text,
  request_status text,
  title text,
  description text,
  reply_email text,
  source_screen text,
  identity_snapshot jsonb,
  payload jsonb,
  app_build text,
  attachment_status text,
  notification_status text,
  provider_message_id text,
  error_code text,
  created_at timestamptz,
  data_environment text,
  total_count bigint,
  operational_total bigint,
  qa_total bigint
)
language sql stable security definer set search_path=''
as $$
  with authorized as (
    select request.*
    from public.feedback_requests request
    where private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ')
  ), visibility as (
    select request.*
    from authorized request
    where request.data_environment='PRODUCTION'
      or (
        include_non_operational
        and exists(
          select 1 from public.admin_memberships membership
          where membership.user_id=(select auth.uid())
            and membership.role='SUPER_ADMIN'
            and membership.scope_type='GLOBAL'
            and membership.active
        )
      )
  ), totals as (
    select
      (select count(*) from visibility) total_count,
      count(*) filter(where authorized.data_environment='PRODUCTION') operational_total,
      count(*) filter(where authorized.data_environment<>'PRODUCTION') qa_total
    from authorized
  )
  select request.id,request.user_id,request.category,request.contextual_category,
    request.request_status,request.title,request.description,request.reply_email,
    request.source_screen,request.identity_snapshot,request.payload,request.app_build,
    request.attachment_status,request.notification_status,request.provider_message_id,
    request.error_code,request.created_at,request.data_environment,totals.total_count,
    totals.operational_total,totals.qa_total
  from visibility request cross join totals
  order by request.created_at desc
  limit greatest(1,least(queue_limit,100))
  offset greatest(0,queue_offset);
$$;
revoke all on function public.admin_feedback_queue_page_v3(integer,integer,boolean) from public,anon;
grant execute on function public.admin_feedback_queue_page_v3(integer,integer,boolean) to authenticated,service_role;

-- Attachment object paths never reach the queue payload. An authenticated
-- support operator resolves one authorized READY attachment at a time; the
-- Next server then exchanges this path for a short-lived Storage signed URL.
create function private.admin_feedback_attachment_path_impl_v1(
  target_feedback_id uuid,
  include_non_operational boolean default false
)
returns text
language plpgsql stable security definer set search_path=''
as $$
declare object_path text;
begin
  if not private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ') then
    raise exception 'SUPPORT_ADMIN_REQUIRED' using errcode='42501';
  end if;
  select request.attachment_path into object_path
  from public.feedback_requests request
  where request.id=target_feedback_id
    and request.attachment_status='READY'
    and request.attachment_path is not null
    and (
      request.data_environment='PRODUCTION'
      or (
        include_non_operational
        and exists(
          select 1 from public.admin_memberships membership
          where membership.user_id=(select auth.uid())
            and membership.role='SUPER_ADMIN'
            and membership.scope_type='GLOBAL'
            and membership.active
        )
      )
    );
  if object_path is null then raise exception 'ATTACHMENT_NOT_AVAILABLE' using errcode='P0002'; end if;
  return object_path;
end;
$$;
revoke all on function private.admin_feedback_attachment_path_impl_v1(uuid,boolean) from public,anon;
grant execute on function private.admin_feedback_attachment_path_impl_v1(uuid,boolean) to authenticated,service_role;

create function public.admin_feedback_attachment_path_v1(
  target_feedback_id uuid,
  include_non_operational boolean default false
)
returns text
language sql stable security invoker set search_path=''
as $$
  select private.admin_feedback_attachment_path_impl_v1(target_feedback_id,include_non_operational)
$$;
revoke all on function public.admin_feedback_attachment_path_v1(uuid,boolean) from public,anon;
grant execute on function public.admin_feedback_attachment_path_v1(uuid,boolean) to authenticated,service_role;

commit;
