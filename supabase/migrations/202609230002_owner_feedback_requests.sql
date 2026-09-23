-- Additive owner-scoped support queue. User submissions remain REPORTED and
-- never become published catalog data without a separate Admin review.
create table if not exists public.feedback_requests (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  category text not null,
  payload jsonb not null default '{}',
  status text not null default 'NOT_SENT',
  request_status text not null default 'NEW',
  title text not null default '',
  description text not null default '',
  reply_email text not null default '',
  source_screen text not null default '',
  provenance_status text not null default 'REPORTED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.feedback_requests add column if not exists request_status text not null default 'NEW';
alter table public.feedback_requests add column if not exists title text not null default '';
alter table public.feedback_requests add column if not exists description text not null default '';
alter table public.feedback_requests add column if not exists reply_email text not null default '';
alter table public.feedback_requests add column if not exists source_screen text not null default '';
alter table public.feedback_requests add column if not exists provenance_status text not null default 'REPORTED';
create index if not exists feedback_requests_owner_created_idx on public.feedback_requests(user_id,created_at desc);
alter table public.feedback_requests enable row level security;
drop policy if exists feedback_owner_read on public.feedback_requests;
create policy feedback_owner_read on public.feedback_requests for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists feedback_owner_insert on public.feedback_requests;
create policy feedback_owner_insert on public.feedback_requests for insert to authenticated with check(user_id=(select auth.uid()) and provenance_status='REPORTED');

create or replace function public.submit_feedback_owner_v1(request_id uuid,request_payload jsonb,source_screen text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid := (select auth.uid()); existing public.feedback_requests;
begin
  if actor is null then raise insufficient_privilege; end if;
  if coalesce(request_payload->>'category','')<>'COURSE'
    or coalesce(request_payload->>'requestedType','')<>'TEE'
    or length(coalesce(request_payload->>'description','')) not between 10 and 2200
    or pg_column_size(request_payload)>10000 then raise exception 'INVALID_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into existing from public.feedback_requests where id=request_id;
  if found then
    if existing.user_id<>actor or existing.payload<>request_payload then raise exception 'REQUEST_CONFLICT'; end if;
    return jsonb_build_object('id',existing.id,'created',false,'status',existing.request_status);
  end if;
  if (select count(*) from public.feedback_requests where user_id=actor and created_at>now()-interval '1 day')>=10 then raise exception 'RATE_LIMIT'; end if;
  insert into public.feedback_requests(id,user_id,category,payload,status,request_status,title,description,reply_email,source_screen,provenance_status)
  values(request_id,actor,'COURSE',request_payload,'NOT_SENT','NEW',left(request_payload->>'title',200),request_payload->>'description',left(coalesce(request_payload->>'replyEmail',''),200),left(coalesce(source_screen,''),160),'REPORTED');
  return jsonb_build_object('id',request_id,'created',true,'status','NEW');
end $$;
revoke all on function public.submit_feedback_owner_v1(uuid,jsonb,text) from public,anon;
grant execute on function public.submit_feedback_owner_v1(uuid,jsonb,text) to authenticated;
