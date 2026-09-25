-- Feedback request, RPC and private attachment authorization contract.
-- Every synthetic row and FORCE RLS change is contained in this transaction.
begin;

do $$
declare
  actual_columns text[];
  unexpected_policies text[];
  rpc regprocedure := to_regprocedure('public.submit_feedback_v2(uuid,uuid,text,text,text,jsonb,jsonb,text)');
begin
  if to_regclass('public.feedback_requests') is null then
    raise exception 'missing public.feedback_requests';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.feedback_requests'::regclass) then
    raise exception 'RLS is not enabled on public.feedback_requests';
  end if;
  if has_table_privilege('anon', 'public.feedback_requests', 'SELECT')
    or has_any_column_privilege('anon', 'public.feedback_requests', 'SELECT')
    or has_table_privilege('anon', 'public.feedback_requests', 'INSERT')
    or has_table_privilege('anon', 'public.feedback_requests', 'UPDATE')
    or has_table_privilege('anon', 'public.feedback_requests', 'DELETE') then
    raise exception 'anon unexpectedly has feedback request privileges';
  end if;
  if not has_any_column_privilege('authenticated', 'public.feedback_requests', 'SELECT')
    or has_table_privilege('authenticated', 'public.feedback_requests', 'INSERT')
    or has_table_privilege('authenticated', 'public.feedback_requests', 'UPDATE')
    or has_table_privilege('authenticated', 'public.feedback_requests', 'DELETE') then
    raise exception 'authenticated feedback request grants are not read-only';
  end if;

  select array_agg(column_name::text order by column_name) into actual_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'feedback_requests'
    and has_column_privilege('authenticated', 'public.feedback_requests', column_name, 'SELECT');
  if actual_columns is distinct from array[
    'app_build','attachment_path','attachment_status','category','contextual_category',
    'created_at','description','id','payload','reply_email','request_status','resolved_at',
    'source_screen','status','title','updated_at','user_id'
  ]::text[] then
    raise exception 'authenticated feedback projection changed: %', actual_columns;
  end if;
  if not has_table_privilege('service_role', 'public.feedback_requests', 'SELECT')
    or not has_table_privilege('service_role', 'public.feedback_requests', 'INSERT')
    or not has_table_privilege('service_role', 'public.feedback_requests', 'UPDATE')
    or not has_table_privilege('service_role', 'public.feedback_requests', 'DELETE') then
    raise exception 'service_role lacks the controlled feedback workflow privileges';
  end if;

  select array_agg(policyname::text order by policyname) into unexpected_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'feedback_requests'
    and policyname not in ('feedback_owner_read', 'account_active_access');
  if unexpected_policies is not null then
    raise exception 'feedback requests expose unexpected policies: %', unexpected_policies;
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback_requests'
      and policyname = 'feedback_owner_read'
      and permissive = 'PERMISSIVE'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%user_id%auth.uid()%'
      and with_check is null
  ) then raise exception 'missing exact authenticated owner-read feedback policy'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback_requests'
      and policyname = 'account_active_access'
      and permissive = 'RESTRICTIVE'
      and cmd = 'ALL'
      and roles = array['authenticated']::name[]
      and qual like '%private.account_data_access_allowed()%'
      and with_check like '%private.account_data_access_allowed()%'
  ) then raise exception 'missing restrictive account lifecycle policy on feedback requests'; end if;

  if rpc is null then raise exception 'missing public.submit_feedback_v2'; end if;
  if has_function_privilege('anon', rpc, 'EXECUTE')
    or has_function_privilege('authenticated', rpc, 'EXECUTE')
    or not has_function_privilege('service_role', rpc, 'EXECUTE') then
    raise exception 'submit_feedback_v2 execution grants are unsafe';
  end if;
  if exists (
    select 1 from pg_proc
    where oid = rpc
      and (prosecdef or not (coalesce(proconfig, array[]::text[]) @> array['search_path=""']))
  ) then raise exception 'submit_feedback_v2 must remain SECURITY INVOKER with an empty search_path'; end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'feedback-private' and name = 'feedback-private' and public is false
      and file_size_limit = 2097152
      and allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[]
  ) then raise exception 'feedback-private bucket contract changed'; end if;
  if (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'feedback_attachment_owner_read') <> 1 then
    raise exception 'feedback attachment owner-read policy missing or duplicated';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'feedback_attachment_owner_read'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%feedback-private%'
      and qual like '%feedback_requests%'
      and qual like '%attachment_path%name%'
      and qual like '%user_id%auth.uid()%'
  ) then raise exception 'feedback attachment policy no longer binds bucket, request path and owner'; end if;
end $$;

do $$
begin
  if exists (
    select 1 from auth.users
    where id in (
      '46000000-0000-4000-8000-000000000001',
      '46000000-0000-4000-8000-000000000002'
    )
  ) or exists (
    select 1 from public.feedback_requests
    where id in (
      '46100000-0000-4000-8000-000000000001',
      '46100000-0000-4000-8000-000000000002',
      '46100000-0000-4000-8000-000000000003'
    )
  ) then raise exception 'feedback RLS synthetic fixture collision'; end if;
end $$;

insert into auth.users (id) values
  ('46000000-0000-4000-8000-000000000001'),
  ('46000000-0000-4000-8000-000000000002');

insert into public.feedback_requests (
  id,user_id,category,payload,status,request_status,title,description,
  attachment_path,attachment_status
) values
  (
    '46100000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000001',
    'BUG','{"category":"BUG","description":"Synthetic feedback RLS owner A"}',
    'NOT_SENT','NEW','Synthetic owner A','Synthetic feedback RLS owner A',
    '46000000-0000-4000-8000-000000000001/46100000-0000-4000-8000-000000000001/feedback-rls.png','READY'
  ),
  (
    '46100000-0000-4000-8000-000000000002',
    '46000000-0000-4000-8000-000000000002',
    'GENERAL','{"category":"GENERAL","description":"Synthetic feedback RLS owner B"}',
    'NOT_SENT','NEW','Synthetic owner B','Synthetic feedback RLS owner B',
    '46000000-0000-4000-8000-000000000002/46100000-0000-4000-8000-000000000002/feedback-rls.png','READY'
  );

insert into storage.objects (id,bucket_id,name,owner,owner_id) values
  (
    '46200000-0000-4000-8000-000000000001','feedback-private',
    '46000000-0000-4000-8000-000000000001/46100000-0000-4000-8000-000000000001/feedback-rls.png',
    '46000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001'
  ),
  (
    '46200000-0000-4000-8000-000000000002','feedback-private',
    '46000000-0000-4000-8000-000000000002/46100000-0000-4000-8000-000000000002/feedback-rls.png',
    '46000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000002'
  );

alter table public.feedback_requests force row level security;
-- storage.objects is owned by Supabase's managed storage role. The
-- authenticated/anon role switches below are already subject to its enabled
-- RLS; forcing it would require altering a provider-owned table.

set local role service_role;
do $$
declare
  first_result jsonb;
  replay_result jsonb;
begin
  select public.submit_feedback_v2(
    '46100000-0000-4000-8000-000000000003',
    '46000000-0000-4000-8000-000000000001',
    repeat('a',64),repeat('b',64),repeat('c',64),
    '{"category":"BUG","name":"Synthetic RPC","description":"Synthetic service-only feedback RPC","replyEmail":"feedback-rls@example.invalid"}'::jsonb,
    '{"screen":"feedback-rls","identity":{},"build":"synthetic"}'::jsonb,
    null
  ) into first_result;
  select public.submit_feedback_v2(
    '46100000-0000-4000-8000-000000000003',
    '46000000-0000-4000-8000-000000000001',
    repeat('a',64),repeat('b',64),repeat('c',64),
    '{"category":"BUG","name":"Synthetic RPC","description":"Synthetic service-only feedback RPC","replyEmail":"feedback-rls@example.invalid"}'::jsonb,
    '{"screen":"feedback-rls","identity":{},"build":"synthetic"}'::jsonb,
    null
  ) into replay_result;
  if first_result->>'created' <> 'true' or replay_result->>'created' <> 'false' then
    raise exception 'submit_feedback_v2 did not preserve create/replay idempotency';
  end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','46000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

do $$
declare
  visible_count integer;
  denied boolean;
begin
  select count(*) into visible_count from public.feedback_requests
  where id in (
    '46100000-0000-4000-8000-000000000001',
    '46100000-0000-4000-8000-000000000002',
    '46100000-0000-4000-8000-000000000003'
  );
  if visible_count <> 2 then raise exception 'owner A feedback visibility was % instead of 2', visible_count; end if;
  perform id,category,description,attachment_path from public.feedback_requests
    where id = '46100000-0000-4000-8000-000000000001';

  denied := false;
  begin perform admin_notes from public.feedback_requests limit 1;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated owner read hidden feedback administration columns'; end if;

  denied := false;
  begin
    insert into public.feedback_requests(id,user_id,category,payload,status)
    values('46100000-0000-4000-8000-000000000004','46000000-0000-4000-8000-000000000001','BUG','{}','NOT_SENT');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated owner inserted a feedback row directly'; end if;

  denied := false;
  begin update public.feedback_requests set request_status='RESOLVED'
    where id='46100000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated owner updated feedback workflow state'; end if;

  denied := false;
  begin delete from public.feedback_requests where id='46100000-0000-4000-8000-000000000001';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated owner deleted feedback evidence'; end if;

  denied := false;
  begin perform public.submit_feedback_v2(
    '46100000-0000-4000-8000-000000000004',
    '46000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),repeat('c',64),
    '{"category":"BUG","description":"Unauthorized feedback RPC attempt"}'::jsonb,'{}'::jsonb,null
  ); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated client executed service-only feedback RPC'; end if;

  select count(*) into visible_count from storage.objects
  where id in (
    '46200000-0000-4000-8000-000000000001',
    '46200000-0000-4000-8000-000000000002'
  );
  if visible_count <> 1 then raise exception 'owner A feedback attachment visibility was % instead of 1', visible_count; end if;

  denied := false;
  begin
    insert into storage.objects(id,bucket_id,name,owner,owner_id) values(
      '46200000-0000-4000-8000-000000000003','feedback-private',
      '46000000-0000-4000-8000-000000000001/unauthorized.png',
      '46000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001'
    );
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated client uploaded directly to feedback-private'; end if;
end $$;

-- The attachment policy resolves ownership through feedback_requests. Prove
-- that closing the account hides both the row and its private object even from
-- a still-valid owner JWT.
reset role;
insert into private.account_lifecycle_state (user_id, account_status)
values ('46000000-0000-4000-8000-000000000001', 'archived')
on conflict (user_id) do update set account_status = excluded.account_status;
set local role authenticated;
select set_config('request.jwt.claim.sub','46000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare visible_count integer;
begin
  select count(*) into visible_count from public.feedback_requests
  where id in (
    '46100000-0000-4000-8000-000000000001',
    '46100000-0000-4000-8000-000000000002',
    '46100000-0000-4000-8000-000000000003'
  );
  if visible_count <> 0 then raise exception 'archived owner retained feedback visibility'; end if;
  select count(*) into visible_count from storage.objects
  where id in (
    '46200000-0000-4000-8000-000000000001',
    '46200000-0000-4000-8000-000000000002'
  );
  if visible_count <> 0 then raise exception 'archived owner retained feedback attachment visibility'; end if;
end $$;

select set_config('request.jwt.claim.sub','46000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare visible_count integer;
begin
  select count(*) into visible_count from public.feedback_requests
  where id in (
    '46100000-0000-4000-8000-000000000001',
    '46100000-0000-4000-8000-000000000002',
    '46100000-0000-4000-8000-000000000003'
  );
  if visible_count <> 1 then raise exception 'owner B feedback visibility was % instead of 1', visible_count; end if;
  select count(*) into visible_count from storage.objects
  where id in (
    '46200000-0000-4000-8000-000000000001',
    '46200000-0000-4000-8000-000000000002'
  );
  if visible_count <> 1 then raise exception 'owner B feedback attachment visibility was % instead of 1', visible_count; end if;
end $$;

reset role;
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform id from public.feedback_requests limit 1;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon read feedback requests'; end if;
end $$;

reset role;
rollback;
