-- Behavioral Admin Control Center RLS test. All fixtures roll back.
begin;

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
('30000000-0000-4000-8000-000000000001','authenticated','authenticated','admin-super@backyard.invalid','',now(),'{}','{}',now(),now()),
('30000000-0000-4000-8000-000000000002','authenticated','authenticated','admin-course@backyard.invalid','',now(),'{}','{}',now(),now()),
('30000000-0000-4000-8000-000000000003','authenticated','authenticated','admin-catalog@backyard.invalid','',now(),'{}','{}',now(),now()),
('30000000-0000-4000-8000-000000000004','authenticated','authenticated','admin-competition@backyard.invalid','',now(),'{}','{}',now(),now()),
('30000000-0000-4000-8000-000000000005','authenticated','authenticated','admin-normal@backyard.invalid','',now(),'{}','{}',now(),now());

insert into public.admin_memberships(user_id,role,scope_type,scope_id,created_by) values
('30000000-0000-4000-8000-000000000001','SUPER_ADMIN','GLOBAL',null,'30000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000002','COURSE_ADMIN','COURSE','synthetic-course-a','30000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000003','CATALOG_ADMIN','CATALOG','equipment','30000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000004','COMPETITION_ADMIN','COMPETITION','30000000-0000-4000-8000-000000000104','30000000-0000-4000-8000-000000000001');

insert into public.golf_ball_brands(id,name) values('synthetic-rls-brand','Synthetic RLS Brand');

set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}',true);

select public.admin_create_revision_v1(
  'COURSE','synthetic-course-a','COURSE','synthetic-course-a',
  '{"sourceName":"Synthetic QA","sourceUrl":"https://example.invalid/admin-course","verifiedAt":"2026-09-22T00:00:00Z","club":{"id":"synthetic-club-a","name":"Synthetic Club A","aliases":[],"active":true},"course":{"id":"synthetic-course-a","clubId":"synthetic-club-a","name":"Synthetic Course A","aliases":[],"holes":18,"active":true},"tees":[],"holes":[],"teeHoleYardages":[]}'::jsonb,
  'ADMIN_RESEARCH','Synthetic QA','https://example.invalid/admin-course','VERIFIED',now(),'HIGH',null
);

do $$
declare denied boolean:=false; revision_id uuid; preview_hash text;
begin
  begin
    perform public.admin_create_revision_v1('COURSE','synthetic-course-b','COURSE','synthetic-course-b','{}','ADMIN_RESEARCH','Synthetic QA',null,'VERIFIED',now(),'HIGH',null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Course Admin wrote outside scope'; end if;
  denied:=false;
  begin
    perform public.admin_create_revision_v1('BALL','synthetic-ball-denied','CATALOG','equipment','{}','ADMIN_RESEARCH','Synthetic QA',null,'VERIFIED',now(),'HIGH',null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Course Admin wrote equipment'; end if;

  select id into revision_id from public.admin_catalog_revisions where entity_type='COURSE' and entity_id='synthetic-course-a';
  perform public.admin_transition_revision_v1(revision_id,'REVIEWED','Course reviewed',gen_random_uuid());
  perform public.admin_transition_revision_v1(revision_id,'VERIFIED','Course verified',gen_random_uuid());
  perform public.admin_prepare_revision_v1(revision_id);
  select r.preview_hash into preview_hash from public.admin_catalog_revisions r where r.id=revision_id;
  perform public.admin_publish_revision_v1(revision_id,preview_hash,'Course publication confirmed',gen_random_uuid());
  denied:=false;
  begin update public.admin_catalog_revisions set payload='{"tampered":true}' where id=revision_id;
  exception when check_violation then denied:=true; end;
  if not denied then raise exception 'Published revision was mutable'; end if;
end;
$$;

do $$
declare holes jsonb; cfg_id uuid; preview jsonb; published_status text;
begin
  select jsonb_agg(jsonb_build_object(
    'clientKey','row-'||ordinal,'sequence',ordinal,
    'runtimeHoleNumber',case when ordinal=3 then null when ordinal<3 then ordinal else ordinal-1 end,
    'displayLabel',case when ordinal=4 then '4A' when ordinal=5 then '4B' else greatest(ordinal-1,1)::text end,
    'sourceBaseHoleId',case when ordinal=4 then null else 'synthetic-base-h'||case when ordinal<=3 then ordinal else ordinal-1 end end,
    'sourceBaseHoleNumber',case when ordinal=4 then null when ordinal<=3 then ordinal else ordinal-1 end,
    'kind',case when ordinal=4 then 'TEMPORARY' else 'BASE' end,
    'playable',ordinal<>3,'parOverride',case when ordinal=4 then 3 else 4 end,
    'strokeIndexOverride',case when ordinal=4 then 3 when ordinal<=3 then ordinal else ordinal-1 end,
    'temporaryGreen',false,'temporaryTee',ordinal=4,'dropZoneNote',case when ordinal=4 then 'Synthetic drop zone' else null end,
    'operationalNote',case when ordinal=3 then 'Synthetic closure' else null end
  ) order by ordinal) into holes from generate_series(1,19) ordinal;
  select (public.admin_create_course_configuration_v1(jsonb_build_object(
    'courseId','synthetic-course-a','name','Synthetic 19-row operation','scopeType','COURSE',
    'effectiveFrom',(now()-interval '1 minute')::text,'reason','Synthetic QA','sourceDescription','Synthetic verified fixture',
    'holes',holes,'teeHoles','[]'::jsonb,'ratings','[]'::jsonb
  ))).id into cfg_id;
  preview:=public.admin_prepare_course_configuration_v1(cfg_id);
  select status into published_status from public.admin_publish_course_configuration_v2(cfg_id,preview->>'previewHash','CANCEL','Synthetic config publication',gen_random_uuid());
  if published_status<>'PUBLISHED' then raise exception 'Temporary configuration did not publish'; end if;
  if (select count(*) from public.course_configuration_holes where configuration_id=cfg_id and playable)<>18 then raise exception 'Temporary runtime did not retain 18 playable holes'; end if;
  if (select runtime_hole_number from public.course_configuration_holes where configuration_id=cfg_id and not playable limit 1) is not null then raise exception 'Closed hole consumed a runtime number'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.admin_create_revision_v1('BALL','synthetic-test-ball','CATALOG','equipment','{"id":"synthetic-test-ball","brand":"Synthetic","model":"Test Ball"}','ADMIN_RESEARCH','Synthetic QA',null,'REVIEWED',null,'MEDIUM',null);
do $$ declare import_id uuid; result jsonb; draft_count integer; imported_revision uuid; preview_hash text; denied boolean:=false; begin
  insert into public.admin_import_jobs(kind,scope_type,scope_id,status,source_format,summary,created_by)
    values('SHAFT','CATALOG','equipment','PREVIEWED','JSON','{"total":1,"new":1}','30000000-0000-4000-8000-000000000003') returning id into import_id;
  insert into public.admin_import_rows(import_id,row_number,status,normalized_payload,issues)
    values(import_id,1,'NEW',jsonb_build_object('id','synthetic-import-shaft','brand','Synthetic','model','Test Shaft','sourceName','Synthetic QA','verifiedAt',now()::text,'weightOptions',jsonb_build_array(50,60),'flexOptions',jsonb_build_array('R','S')),'[]');
  result:=public.admin_confirm_import_v1(import_id,'Synthetic import approved',gen_random_uuid());
  if (result->>'status')<>'CONFIRMED' or (result->>'draftsCreated')::integer<>1 then raise exception 'Import confirmation failed'; end if;
  select count(*) into draft_count from public.admin_catalog_revisions where entity_type='SHAFT' and entity_id='synthetic-import-shaft' and status='DRAFT';
  if draft_count<>1 then raise exception 'Import did not create exactly one Draft'; end if;
  if exists(select 1 from public.admin_catalog_revisions where entity_id='synthetic-import-shaft' and status='PUBLISHED') then raise exception 'Import auto-published a row'; end if;
  select id into imported_revision from public.admin_catalog_revisions where entity_type='SHAFT' and entity_id='synthetic-import-shaft';
  perform public.admin_transition_revision_v1(imported_revision,'REVIEWED','Import reviewed',gen_random_uuid());
  perform public.admin_transition_revision_v1(imported_revision,'VERIFIED','Import verified',gen_random_uuid());
  perform public.admin_prepare_revision_v1(imported_revision);
  select r.preview_hash into preview_hash from public.admin_catalog_revisions r where r.id=imported_revision;
  begin perform public.admin_publish_revision_v1(imported_revision,preview_hash,'Invalid import must fail closed',gen_random_uuid());
  exception when others then denied:=sqlerrm like '%INVALID_SHAFT_PAYLOAD%'; end;
  if not denied then raise exception 'Invalid imported payload published'; end if;
end $$;
do $$ declare denied boolean:=false; canonical_brand_id text; canonical_brand text; begin
  begin
    perform public.admin_create_revision_v1('COURSE','catalog-course-denied','COURSE','catalog-course-denied','{}','ADMIN_RESEARCH','Synthetic QA',null,'REVIEWED',null,'MEDIUM',null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Catalog Admin wrote Course'; end if;
  denied:=false;
  select id,name into canonical_brand_id,canonical_brand from public.golf_ball_brands order by id limit 1;
  begin insert into public.golf_ball_catalog(id,brand_id,brand,model,source_name) values('canonical-bypass',canonical_brand_id,canonical_brand,'Bypass','No');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Catalog Admin bypassed revision workflow'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select public.admin_create_revision_v1('COMPETITION','30000000-0000-4000-8000-000000000104','COMPETITION','30000000-0000-4000-8000-000000000104','{"id":"30000000-0000-4000-8000-000000000104","name":"Synthetic Polla","type":"POLLA","courseId":"synthetic-course-a","visibility":"PRIVATE","rules":[{"category":"OTHER","title":"Reglamento","body":"Fixture sintético","active":true}]}','ADMIN_RESEARCH','Synthetic QA','https://example.invalid/synthetic-polla','VERIFIED',now(),'HIGH',null);
do $$ declare denied boolean:=false; revision_id uuid; preview_hash text; projected integer; begin
  begin
    perform public.admin_create_revision_v1('COMPETITION','30000000-0000-4000-8000-000000000105','COMPETITION','30000000-0000-4000-8000-000000000105','{}','ADMIN_RESEARCH','Synthetic QA',null,'REVIEWED',null,'MEDIUM',null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Competition Admin wrote another event'; end if;
  select id into revision_id from public.admin_catalog_revisions where entity_type='COMPETITION' and entity_id='30000000-0000-4000-8000-000000000104';
  perform public.admin_transition_revision_v1(revision_id,'REVIEWED','Competition reviewed',gen_random_uuid());
  perform public.admin_transition_revision_v1(revision_id,'VERIFIED','Competition verified',gen_random_uuid());
  perform public.admin_prepare_revision_v1(revision_id);
  select r.preview_hash into preview_hash from public.admin_catalog_revisions r where r.id=revision_id;
  perform public.admin_publish_revision_v1(revision_id,preview_hash,'Competition publication confirmed',gen_random_uuid());
  select count(*) into projected from public.competition_definitions where id='30000000-0000-4000-8000-000000000104' and status='PUBLISHED';
  if projected<>1 then raise exception 'Competition projection missing'; end if;
  select count(*) into projected from public.competition_rules rule join public.competition_rule_sets rule_set on rule_set.id=rule.rule_set_id where rule_set.competition_id='30000000-0000-4000-8000-000000000104';
  if projected<>1 then raise exception 'Competition rules projection missing'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
do $$ declare row_count integer; denied boolean:=false; begin
  select count(*) into row_count from public.admin_catalog_revisions where entity_id='synthetic-course-a' and status='PUBLISHED';
  if row_count<>0 then raise exception 'Normal user can read the private revision ledger'; end if;
  select count(*) into row_count from public.admin_catalog_revisions where entity_id='synthetic-test-ball' and status='DRAFT';
  if row_count<>0 then raise exception 'Normal user can read draft'; end if;
  begin
    perform public.admin_create_revision_v1('COURSE','normal-denied','COURSE','normal-denied','{}','ADMIN_RESEARCH','Synthetic QA',null,'REVIEWED',null,'MEDIUM',null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Normal user created a Course'; end if;
  denied:=false;
  begin insert into public.admin_audit_log(actor_id,action,entity_type,entity_id) values('30000000-0000-4000-8000-000000000005','FAKE','COURSE','x');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Normal user appended audit'; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare audit_rows integer; begin
  select count(*) into audit_rows from public.admin_audit_log where entity_id='synthetic-course-a';
  if audit_rows<4 then raise exception 'Expected append-only workflow audit entries'; end if;
end $$;

reset role;
rollback;
