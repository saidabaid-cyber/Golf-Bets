-- GHIN course-sync evidence and score-post receipt RLS contract.
-- Run only on an isolated/local or canonical QA database. Everything rolls back.
begin;

do $$
declare relation_name text;
begin
  foreach relation_name in array array['golf_provider_sync_runs','ghin_score_post_receipts'] loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'missing GHIN course-sync table: %', relation_name;
    end if;
    if not exists (
      select 1 from pg_class relation
      join pg_namespace schema on schema.oid=relation.relnamespace
      where schema.nspname='public' and relation.relname=relation_name and relation.relrowsecurity
    ) then raise exception 'RLS is not enabled on public.%', relation_name; end if;
    if has_table_privilege('anon', format('public.%I', relation_name), 'SELECT')
      or has_table_privilege('anon', format('public.%I', relation_name), 'INSERT')
      or has_table_privilege('anon', format('public.%I', relation_name), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', relation_name), 'DELETE') then
      raise exception 'anon unexpectedly has privileges on public.%', relation_name;
    end if;
  end loop;
  if has_table_privilege('authenticated','public.golf_provider_sync_runs','SELECT')
    or has_table_privilege('authenticated','public.golf_provider_sync_runs','INSERT') then
    raise exception 'sync evidence must remain service-only';
  end if;
  if not has_table_privilege('authenticated','public.ghin_score_post_receipts','SELECT')
    or has_table_privilege('authenticated','public.ghin_score_post_receipts','INSERT')
    or has_table_privilege('authenticated','public.ghin_score_post_receipts','UPDATE')
    or has_table_privilege('authenticated','public.ghin_score_post_receipts','DELETE') then
    raise exception 'score receipts must be owner-readable and service-write-only';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name in ('golf_provider_sync_runs','ghin_score_post_receipts')
      and column_name ~* '(password|secret|credential|bearer|firebase|authorization|cookie|raw_response)'
  ) then raise exception 'GHIN sync schema persists secret or raw response material'; end if;
end;
$$;

delete from auth.users where id in (
  '41000000-0000-4000-8000-000000000001'::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid
);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('41000000-0000-4000-8000-000000000001','authenticated','authenticated','ghin-receipt-a@backyard.invalid','',now(),'{}','{}',now(),now()),
  ('41000000-0000-4000-8000-000000000002','authenticated','authenticated','ghin-receipt-b@backyard.invalid','',now(),'{}','{}',now(),now());
insert into public.rounds_cloud(owner_id,local_round_id,snapshot)
values ('41000000-0000-4000-8000-000000000001','ghin-receipt-test','{}')
returning id;
insert into public.ghin_score_post_receipts(
  owner_id,round_id,golfer_id,course_id,tee_set_id,played_at,gross_score,fingerprint,status
)
select '41000000-0000-4000-8000-000000000001',id,'synthetic-ghin','synthetic-course','synthetic-tee',
  current_date,72,repeat('a',64),'PREPARED'
from public.rounds_cloud where owner_id='41000000-0000-4000-8000-000000000001' and local_round_id='ghin-receipt-test';

set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"41000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare row_count integer; denied boolean := false;
begin
  select count(*) into row_count from public.ghin_score_post_receipts;
  if row_count <> 1 then raise exception 'receipt owner cannot read its record'; end if;
  begin
    update public.ghin_score_post_receipts set status='POSTING';
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'receipt owner mutated a service-managed record'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"41000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare row_count integer;
begin
  select count(*) into row_count from public.ghin_score_post_receipts;
  if row_count <> 0 then raise exception 'score receipt leaked across owners'; end if;
end;
$$;

reset role;
rollback;
