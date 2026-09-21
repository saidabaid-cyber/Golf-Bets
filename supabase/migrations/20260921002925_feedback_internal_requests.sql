-- Applied only to isolated QA. Ledger version matches the controlled MCP apply.
-- Additive v2: old mail delivery status remains for old clients.
begin;
alter table public.feedback_requests
  alter column user_id drop not null,
  add column request_status text not null default 'NEW' check(request_status in ('NEW','IN_REVIEW','RESOLVED','REJECTED')),
  add column title text not null default '',
  add column description text not null default '',
  add column reply_email text not null default '',
  add column source_screen text not null default '',
  add column identity_snapshot jsonb not null default '{}',
  add column app_build text,
  add column contextual_category text,
  add column topic_key text,
  add column submission_hash text,
  add column submitter_key text,
  add column rate_key text,
  add column attachment_path text,
  add column attachment_status text not null default 'NONE' check(attachment_status in ('NONE','PENDING','READY','FAILED')),
  add column notification_status text not null default 'NOT_REQUESTED' check(notification_status in ('NOT_REQUESTED','PENDING','SENDING','ACCEPTED_BY_PROVIDER','FAILED','UNAVAILABLE')),
  add column resolved_at timestamptz,
  add column admin_notes text;
create index feedback_requests_workflow_idx on public.feedback_requests(request_status,created_at desc);
create index feedback_requests_topic_idx on public.feedback_requests(category,topic_key,created_at desc);
create index feedback_requests_rate_idx on public.feedback_requests(rate_key,created_at);
-- Owner read-only access excludes administrative notes and anti-abuse keys.
revoke select on public.feedback_requests from authenticated;
grant select(id,user_id,category,payload,status,request_status,title,description,reply_email,source_screen,app_build,contextual_category,attachment_path,attachment_status,created_at,updated_at,resolved_at) on public.feedback_requests to authenticated;

create function public.submit_feedback_v2(request_id uuid,actor_id uuid,actor_key text,limiter_key text,request_hash text,request_payload jsonb,request_context jsonb,object_path text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.feedback_requests;
begin
  if current_user not in ('service_role','postgres') then raise exception 'NOT_AUTHORIZED'; end if;
  if coalesce(actor_key,'') !~ '^[0-9a-f]{64}$' or coalesce(limiter_key,'') !~ '^[0-9a-f]{64}$' or coalesce(request_hash,'') !~ '^[0-9a-f]{64}$'
    or coalesce(request_payload->>'category','') not in ('COURSE','CLUB','BALL','SHAFT','BET','BUG','GENERAL')
    or length(coalesce(request_payload->>'description','')) not between 10 and 2000
    or pg_column_size(request_payload)>20000 or pg_column_size(request_context)>4000 then raise exception 'INVALID_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(limiter_key,0));
  select * into r from public.feedback_requests where id=request_id for update;
  if found then
    if r.user_id is distinct from actor_id or r.submitter_key is distinct from actor_key or r.submission_hash is distinct from request_hash then raise exception 'REQUEST_CONFLICT'; end if;
    return jsonb_build_object('id',r.id,'created',false,'status',r.request_status,'attachmentStatus',r.attachment_status);
  end if;
  if (select count(*) from public.feedback_requests where rate_key=limiter_key and created_at>now()-interval '1 day')>=10 then raise exception 'RATE_LIMIT'; end if;
  insert into public.feedback_requests(id,user_id,category,payload,status,request_status,title,description,reply_email,source_screen,identity_snapshot,app_build,contextual_category,topic_key,submission_hash,submitter_key,rate_key,attachment_path,attachment_status,notification_status)
  values(request_id,actor_id,request_payload->>'category',request_payload,'NOT_SENT','NEW',left(coalesce(nullif(request_payload->>'name',''),request_payload->>'occurred',request_payload->>'description'),200),request_payload->>'description',request_payload->>'replyEmail',left(request_context->>'screen',160),coalesce(request_context->'identity','{}'),left(request_context->>'build',100),left(request_context->>'category',20),left(request_context->>'topic',600),request_hash,actor_key,limiter_key,object_path,case when object_path is null then 'NONE' else 'PENDING' end,'PENDING');
  return jsonb_build_object('id',request_id,'created',true,'status','NEW','attachmentStatus',case when object_path is null then 'NONE' else 'PENDING' end);
end $$;
revoke all on function public.submit_feedback_v2(uuid,uuid,text,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_feedback_v2(uuid,uuid,text,text,text,jsonb,jsonb,text) to service_role;

-- Private bucket. Uploads are exclusively validated server-side; no public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('feedback-private','feedback-private',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy feedback_attachment_owner_read on storage.objects for select to authenticated
using(bucket_id='feedback-private' and exists(select 1 from public.feedback_requests r where r.attachment_path=name and r.user_id=(select auth.uid())));
comment on column public.feedback_requests.request_status is 'Support workflow, independent of legacy delivery status. Only service-role administration may modify.';
comment on column public.feedback_requests.topic_key is 'Normalized category/title/location for grouping demand; admin may reconcile synonyms. Not a unique constraint.';
commit;
