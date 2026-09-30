begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function private.admin_feedback_queue_page_impl_v3(
  queue_limit integer default 50,
  queue_offset integer default 0,
  include_non_operational boolean default false
)
returns table(
  id uuid,user_id uuid,category text,contextual_category text,request_status text,
  title text,description text,reply_email text,source_screen text,
  identity_snapshot jsonb,payload jsonb,app_build text,attachment_status text,
  notification_status text,provider_message_id text,error_code text,
  created_at timestamptz,data_environment text,total_count bigint,
  operational_total bigint,qa_total bigint
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
revoke all on function private.admin_feedback_queue_page_impl_v3(integer,integer,boolean) from public,anon;
grant execute on function private.admin_feedback_queue_page_impl_v3(integer,integer,boolean) to authenticated,service_role;

create or replace function public.admin_feedback_queue_page_v3(
  queue_limit integer default 50,
  queue_offset integer default 0,
  include_non_operational boolean default false
)
returns table(
  id uuid,user_id uuid,category text,contextual_category text,request_status text,
  title text,description text,reply_email text,source_screen text,
  identity_snapshot jsonb,payload jsonb,app_build text,attachment_status text,
  notification_status text,provider_message_id text,error_code text,
  created_at timestamptz,data_environment text,total_count bigint,
  operational_total bigint,qa_total bigint
)
language sql stable security invoker set search_path=''
as $$
  select * from private.admin_feedback_queue_page_impl_v3(queue_limit,queue_offset,include_non_operational)
$$;
revoke all on function public.admin_feedback_queue_page_v3(integer,integer,boolean) from public,anon;
grant execute on function public.admin_feedback_queue_page_v3(integer,integer,boolean) to authenticated,service_role;

commit;
