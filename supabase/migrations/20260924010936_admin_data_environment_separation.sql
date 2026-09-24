begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Existing Admin audit triggers require an authenticated scoped actor. Use the
-- active GLOBAL SUPER_ADMIN that created the legacy fixture revisions, and keep
-- the identity transaction-local. This preserves the triggers and their audit
-- records; it does not modify the membership or the Auth user. A fresh empty
-- schema has no fixture actor or rows to audit, so it safely skips this setup.
do $$
declare migration_actor uuid;
begin
  select membership.user_id into migration_actor
  from public.admin_memberships membership
  where membership.role='SUPER_ADMIN'
    and membership.scope_type='GLOBAL'
    and membership.active
    and exists(
      select 1 from public.admin_catalog_revisions revision
      where revision.created_by=membership.user_id
        and lower(concat_ws(' ',revision.entity_id,revision.source_name,revision.payload::text))
          ~ '(synthetic|sint[eé]tic[oa]|(^|[-_: ])qa([-_: ]|$))'
    )
  order by membership.created_at,membership.user_id
  limit 1;

  if migration_actor is not null then
    perform set_config('request.jwt.claim.sub',migration_actor::text,true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub',migration_actor::text,'role','authenticated')::text,
      true
    );
  end if;
end $$;

-- Data remains in place. This additive classification separates operational
-- records from QA evidence without changing stable IDs or foreign keys.
alter table public.admin_catalog_revisions add column if not exists data_environment text not null default 'PRODUCTION';
alter table public.admin_import_jobs add column if not exists data_environment text not null default 'PRODUCTION';
alter table public.course_configurations add column if not exists data_environment text not null default 'PRODUCTION';
alter table public.competition_definitions add column if not exists data_environment text not null default 'PRODUCTION';
alter table public.feedback_requests add column if not exists data_environment text not null default 'PRODUCTION';

do $$
declare table_name text;
begin
  foreach table_name in array array['admin_catalog_revisions','admin_import_jobs','course_configurations','competition_definitions','feedback_requests'] loop
    if not exists(select 1 from pg_constraint where conname=table_name||'_data_environment_check') then
      execute format('alter table public.%I add constraint %I check (data_environment in (''PRODUCTION'',''QA'',''TEST'',''SYNTHETIC''))',table_name,table_name||'_data_environment_check');
    end if;
  end loop;
end $$;

create index if not exists admin_catalog_revisions_environment_idx on public.admin_catalog_revisions(data_environment,status,updated_at desc);
create index if not exists admin_import_jobs_environment_idx on public.admin_import_jobs(data_environment,status,updated_at desc);
create index if not exists course_configurations_environment_idx on public.course_configurations(data_environment,status,updated_at desc);
create index if not exists competition_definitions_environment_idx on public.competition_definitions(data_environment,status,updated_at desc);
create index if not exists feedback_requests_environment_idx on public.feedback_requests(data_environment,request_status,created_at desc);

-- Conservative legacy backfill: only stable fixture IDs and unambiguous QA
-- phrases are classified. Unclear user submissions remain PRODUCTION.
update public.admin_catalog_revisions
set data_environment=case
  when lower(concat_ws(' ',entity_id,source_name,payload->>'id',payload->>'brand',payload->>'name',payload#>>'{club,name}',payload#>>'{course,name}')) ~ '(synthetic|sint[eé]tic[oa])' then 'SYNTHETIC'
  when lower(concat_ws(' ',entity_id,source_name,payload->>'id')) ~ '(^|[-_: ])qa([-_: ]|$)|qa reconciliation|qa fixture|fixture qa|prueba qa' then 'QA'
  when lower(concat_ws(' ',entity_id,source_name,payload->>'id')) ~ 'test fixture|fixture test|automated test|prueba automatizada' then 'TEST'
  else data_environment end
where data_environment='PRODUCTION';

update public.course_configurations
set data_environment=case
  when lower(concat_ws(' ',course_id,name,description,reason,source_description)) ~ '(synthetic|sint[eé]tic[oa])' then 'SYNTHETIC'
  when lower(concat_ws(' ',course_id,name,description,reason,source_description)) ~ '(^|[-_: ])qa([-_: ]|$)|qa fixture|fixture qa|prueba qa' then 'QA'
  when lower(concat_ws(' ',course_id,name,description,reason,source_description)) ~ 'test fixture|fixture test|automated test|prueba automatizada' then 'TEST'
  else data_environment end
where data_environment='PRODUCTION';

update public.competition_definitions
set data_environment=case
  when lower(concat_ws(' ',name,organizer,description,settings::text)) ~ '(synthetic|sint[eé]tic[oa])' then 'SYNTHETIC'
  when lower(concat_ws(' ',name,organizer,description,settings::text)) ~ '(^|[-_: ])qa([-_: ]|$)|qa fixture|fixture qa|prueba qa' then 'QA'
  when lower(concat_ws(' ',name,organizer,description,settings::text)) ~ 'test fixture|fixture test|automated test|prueba automatizada' then 'TEST'
  else data_environment end
where data_environment='PRODUCTION';

update public.feedback_requests
set data_environment=case
  -- These immutable pre-v2 fixture IDs have their QA evidence only in private
  -- columns that the legacy queue RPC does not project. Do not broaden this to
  -- blank requests: a real blank legacy request must remain PRODUCTION.
  when id in (
    '5589dffb-416d-44cd-9d06-90b173bd1271'::uuid,
    '5e3ebfef-cdcd-4953-a802-bf9f369f4d96'::uuid,
    'cfdd2187-8783-4efc-9105-7c151a251904'::uuid
  ) then 'QA'
  when lower(concat_ws(' ',title,description,source_screen,reply_email,payload->>'description')) ~ '(synthetic|sint[eé]tic[oa])' then 'SYNTHETIC'
  when lower(concat_ws(' ',title,description,source_screen,reply_email,payload->>'description')) ~ 'qa reconciliation|qa fixture|fixture qa|prueba qa|qa controlad[oa]|(^|[-_/])qa([-_/]|$)|@example\.invalid' then 'QA'
  when lower(concat_ws(' ',title,description,source_screen,reply_email,payload->>'description')) ~ 'test fixture|fixture test|automated test|prueba automatizada' then 'TEST'
  else data_environment end
where data_environment='PRODUCTION';

update public.admin_import_jobs job
set data_environment=coalesce((
  select case
    when lower(row.normalized_payload::text) ~ '(synthetic|sint[eé]tic[oa])' then 'SYNTHETIC'
    when lower(row.normalized_payload::text) ~ '(^|[-_: \"])qa([-_: \"]|$)|qa fixture|fixture qa|prueba qa' then 'QA'
    when lower(row.normalized_payload::text) ~ 'test fixture|fixture test|automated test|prueba automatizada' then 'TEST'
    else null end
  from public.admin_import_rows row where row.import_id=job.id
  and lower(row.normalized_payload::text) ~ '(synthetic|sint[eé]tic[oa]|qa fixture|fixture qa|prueba qa|test fixture|fixture test|automated test|prueba automatizada|(^|[-_: \"])qa([-_: \"]|$))'
  order by row.row_number limit 1
),job.data_environment)
where job.data_environment='PRODUCTION';

-- The new columns are the canonical classification. Do not rewrite immutable
-- published payload/settings/summary JSON merely to duplicate that marker;
-- stable historical payloads remain byte-for-byte unchanged.

-- Keep a durable, append-only record of the conservative legacy
-- classification. The source rows and stable IDs are not deleted or remapped.
insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason)
select created_by,'SYSTEM_MIGRATION','QA_CLASSIFICATION_CHANGED',entity_type,entity_id,
  jsonb_build_object('dataEnvironment','PRODUCTION'),jsonb_build_object('dataEnvironment',data_environment),
  'Conservative legacy QA/Test classification; record retained.'
from public.admin_catalog_revisions where data_environment<>'PRODUCTION';
insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason)
select created_by,'SYSTEM_MIGRATION','QA_CLASSIFICATION_CHANGED','COURSE_CONFIGURATION',id::text,
  jsonb_build_object('dataEnvironment','PRODUCTION'),jsonb_build_object('dataEnvironment',data_environment),
  'Conservative legacy QA/Test classification; record retained.'
from public.course_configurations where data_environment<>'PRODUCTION';
insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason)
select created_by,'SYSTEM_MIGRATION','QA_CLASSIFICATION_CHANGED','COMPETITION',id::text,
  jsonb_build_object('dataEnvironment','PRODUCTION'),jsonb_build_object('dataEnvironment',data_environment),
  'Conservative legacy QA/Test classification; record retained.'
from public.competition_definitions where data_environment<>'PRODUCTION';
insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason)
select created_by,'SYSTEM_MIGRATION','QA_CLASSIFICATION_CHANGED','IMPORT',id::text,
  jsonb_build_object('dataEnvironment','PRODUCTION'),jsonb_build_object('dataEnvironment',data_environment),
  'Conservative legacy QA/Test classification; record retained.'
from public.admin_import_jobs where data_environment<>'PRODUCTION';
insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason)
select user_id,'SYSTEM_MIGRATION','QA_CLASSIFICATION_CHANGED','REQUEST',id::text,
  jsonb_build_object('dataEnvironment','PRODUCTION'),jsonb_build_object('dataEnvironment',data_environment),
  'Conservative legacy QA/Test classification; record retained.'
from public.feedback_requests where data_environment<>'PRODUCTION';

-- Existing fixture publications are retained as archived evidence. This closes
-- legacy player projections immediately; new non-operational publication is
-- rejected by the guards below.
update public.admin_catalog_revisions set status='ARCHIVED',updated_at=now()
where data_environment<>'PRODUCTION' and status in ('PUBLISHED','SCHEDULED');
update public.course_configurations set status='ARCHIVED',updated_at=now()
where data_environment<>'PRODUCTION' and status in ('PUBLISHED','SCHEDULED');
update public.competition_definitions set status='ARCHIVED',updated_at=now()
where data_environment<>'PRODUCTION' and status='PUBLISHED';

comment on column public.admin_catalog_revisions.data_environment is 'Operational boundary. QA/TEST/SYNTHETIC revisions remain auditable but cannot be player-published.';
comment on column public.feedback_requests.data_environment is 'Explicit operational classification; legacy backfill uses only conservative fixture markers.';

-- New drafts persist the classification carried in their controlled payload.
create or replace function public.admin_create_revision_v1(
  target_entity_type text,target_entity_id text,target_scope_type text,target_scope_id text,
  target_payload jsonb,target_source_type text,target_source_name text,target_source_url text,
  target_provenance_status text,target_verified_at timestamptz,target_confidence text,target_notes text
) returns public.admin_catalog_revisions
language plpgsql security invoker set search_path=''
as $$
declare next_version integer; created public.admin_catalog_revisions;
  target_environment text:=upper(coalesce(nullif(target_payload->>'dataEnvironment',''),'PRODUCTION'));
begin
  if not private.admin_has_scope_v1(target_entity_type,target_scope_type,target_scope_id,'CREATE_DRAFT') then raise exception 'ADMIN_SCOPE_REQUIRED' using errcode='42501'; end if;
  if target_payload is null or jsonb_typeof(target_payload)<>'object' or pg_column_size(target_payload)>1000000 then raise exception 'INVALID_PAYLOAD'; end if;
  if target_environment not in ('PRODUCTION','QA','TEST','SYNTHETIC') then raise exception 'INVALID_DATA_ENVIRONMENT'; end if;
  if target_entity_type not in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','CLUB_EQUIPMENT','BALL','SHAFT','EQUIPMENT_IMAGE','COMPETITION','COMPETITION_RULE_SET','REQUEST','IMPORT') then raise exception 'INVALID_ENTITY_TYPE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_entity_type||':'||target_entity_id,0));
  select coalesce(max(version),0)+1 into next_version from public.admin_catalog_revisions where entity_type=target_entity_type and entity_id=target_entity_id;
  insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,scope_id,version,payload,source_type,source_name,source_url,provenance_status,verified_at,confidence,internal_notes,created_by,data_environment)
  values(target_entity_type,target_entity_id,target_scope_type,target_scope_id,next_version,target_payload,target_source_type,target_source_name,target_source_url,target_provenance_status,target_verified_at,target_confidence,target_notes,(select auth.uid()),target_environment)
  returning * into created;
  return created;
end;
$$;

-- Defense in depth: no direct or RPC status change may expose non-operational
-- records. Existing QA evidence remains intact and queryable to SUPER_ADMIN.
create or replace function private.admin_block_non_operational_publish_v1()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  if new.data_environment<>'PRODUCTION' and new.status in ('PUBLISHED','SCHEDULED') then
    raise exception 'QA_PUBLICATION_BLOCKED' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.admin_block_non_operational_publish_v1() from public,anon,authenticated;

drop trigger if exists admin_revision_environment_publish_guard on public.admin_catalog_revisions;
create trigger admin_revision_environment_publish_guard before insert or update of status,data_environment on public.admin_catalog_revisions
for each row execute function private.admin_block_non_operational_publish_v1();
drop trigger if exists course_configuration_environment_publish_guard on public.course_configurations;
create trigger course_configuration_environment_publish_guard before insert or update of status,data_environment on public.course_configurations
for each row execute function private.admin_block_non_operational_publish_v1();
drop trigger if exists competition_environment_publish_guard on public.competition_definitions;
create trigger competition_environment_publish_guard before insert or update of status,data_environment on public.competition_definitions
for each row execute function private.admin_block_non_operational_publish_v1();

-- The legacy Admin request queue remains API-compatible, but is intentionally
-- operational-only. Non-operational evidence is available exclusively through
-- the v2 endpoint below, whose include switch requires an active GLOBAL
-- SUPER_ADMIN membership in the database.
drop function if exists public.admin_feedback_queue_v1(integer);
drop function if exists private.admin_feedback_queue_impl_v1(integer);
create function private.admin_feedback_queue_impl_v1(queue_limit integer default 50)
returns table(id uuid,category text,request_status text,title text,description text,source_screen text,attachment_status text,created_at timestamptz,data_environment text)
language sql stable security definer set search_path=''
as $$
  select request.id,request.category,request.request_status,request.title,request.description,request.source_screen,request.attachment_status,request.created_at,request.data_environment
  from public.feedback_requests request
  where request.data_environment='PRODUCTION'
    and private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ')
  order by request.created_at desc limit greatest(1,least(queue_limit,100));
$$;
revoke all on function private.admin_feedback_queue_impl_v1(integer) from public,anon;
grant execute on function private.admin_feedback_queue_impl_v1(integer) to authenticated,service_role;
create function public.admin_feedback_queue_v1(queue_limit integer default 50)
returns table(id uuid,category text,request_status text,title text,description text,source_screen text,attachment_status text,created_at timestamptz,data_environment text)
language sql stable security invoker set search_path=''
as $$ select * from private.admin_feedback_queue_impl_v1(queue_limit) $$;
revoke all on function public.admin_feedback_queue_v1(integer) from public,anon;
grant execute on function public.admin_feedback_queue_v1(integer) to authenticated,service_role;

-- Versioned page endpoint filters explicit classification before LIMIT/OFFSET
-- and reports exact totals. The QA switch is defense-in-depth restricted to an
-- active GLOBAL SUPER_ADMIN even if a caller bypasses the Next route.
create or replace function public.admin_feedback_queue_page_v2(
  queue_limit integer default 50,
  queue_offset integer default 0,
  include_non_operational boolean default false
)
returns table(
  id uuid,category text,request_status text,title text,description text,
  source_screen text,attachment_status text,created_at timestamptz,
  data_environment text,total_count bigint,operational_total bigint,qa_total bigint
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
  select request.id,request.category,request.request_status,request.title,
    request.description,request.source_screen,request.attachment_status,
    request.created_at,request.data_environment,totals.total_count,
    totals.operational_total,totals.qa_total
  from visibility request cross join totals
  order by request.created_at desc
  limit greatest(1,least(queue_limit,100))
  offset greatest(0,queue_offset);
$$;
revoke all on function public.admin_feedback_queue_page_v2(integer,integer,boolean) from public,anon;
grant execute on function public.admin_feedback_queue_page_v2(integer,integer,boolean) to authenticated,service_role;

-- Defense in depth for callers that bypass the Next route: a QA request may
-- remain reviewable, but it cannot become an operational draft.
create or replace function private.admin_create_draft_from_request_impl_v1(
  feedback_id uuid,
  draft_entity_type text,
  request_id uuid
) returns public.admin_request_drafts
language plpgsql security definer set search_path=''
as $$
declare request_row public.feedback_requests; created public.admin_request_drafts;
begin
  if not private.admin_has_scope_v1('REQUEST','GLOBAL',null,'CREATE_DRAFT') then raise exception 'SUPPORT_ADMIN_REQUIRED' using errcode='42501'; end if;
  if draft_entity_type not in ('COURSE','CLUB_EQUIPMENT','BALL','SHAFT','LOCAL_RULE_SET','COURSE_CONFIGURATION','REQUEST') then raise exception 'INVALID_DRAFT_TYPE'; end if;
  select * into request_row from public.feedback_requests where id=feedback_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  if request_row.data_environment<>'PRODUCTION' then raise exception 'QA_REQUEST_DRAFT_BLOCKED' using errcode='23514'; end if;
  insert into public.admin_request_drafts(feedback_request_id,entity_type,created_by)
    values(feedback_id,draft_entity_type,(select auth.uid()))
    on conflict(feedback_request_id,entity_type) do update set status=public.admin_request_drafts.status
    returning * into created;
  update public.feedback_requests set request_status='IN_REVIEW',updated_at=now() where id=feedback_id;
  perform private.admin_audit_v1('CREATE_DRAFT_FROM_REQUEST','REQUEST',feedback_id::text,null,to_jsonb(created),'Solicitud de usuario convertida en borrador.',request_id,'GLOBAL',null);
  return created;
end;
$$;
revoke all on function private.admin_create_draft_from_request_impl_v1(uuid,text,uuid) from public,anon;
grant execute on function private.admin_create_draft_from_request_impl_v1(uuid,text,uuid) to authenticated,service_role;

-- Authenticated player reads see only operational configurations; scoped Admin
-- reads continue to include QA evidence for the control center.
drop policy if exists course_configuration_read on public.course_configurations;
create policy course_configuration_read on public.course_configurations for select to authenticated
using(
  (
    data_environment='PRODUCTION'
    and status in ('SCHEDULED','PUBLISHED')
    and (effective_from is null or effective_from<=now())
    and (effective_until is null or effective_until>now())
  )
  or private.admin_has_scope_v1(
    'COURSE_CONFIGURATION',scope_type,
    case when scope_type='COURSE' then course_id else competition_id::text end,
    'READ'
  )
);

-- The public player projection is filtered in the database as well as in the
-- application provider, so a publishable key cannot enumerate QA fixtures.
create or replace function public.player_published_catalog_v1(
  requested_entity_types text[] default array['COURSE','CLUB_EQUIPMENT','BALL','SHAFT']::text[]
)
returns table(entity_type text,entity_id text,version integer,status text,payload jsonb,effective_from timestamptz,effective_until timestamptz)
language sql stable security definer set search_path=''
as $$
  select revision.entity_type,revision.entity_id,revision.version,revision.status,
    case revision.entity_type
      when 'COURSE' then jsonb_strip_nulls(jsonb_build_object(
        'dataEnvironment',revision.data_environment,
        'sourceName',revision.payload->'sourceName','sourceUrl',revision.payload->'sourceUrl','verifiedAt',revision.payload->'verifiedAt',
        'club',jsonb_strip_nulls(jsonb_build_object(
          'id',revision.payload#>'{club,id}','name',revision.payload#>'{club,name}','aliases',coalesce(revision.payload#>'{club,aliases}','[]'::jsonb),
          'country',revision.payload#>'{club,country}','stateRegion',revision.payload#>'{club,stateRegion}','city',revision.payload#>'{club,city}',
          'address',revision.payload#>'{club,address}','latitude',revision.payload#>'{club,latitude}','longitude',revision.payload#>'{club,longitude}',
          'timezone',revision.payload#>'{club,timezone}','website',revision.payload#>'{club,website}','active',revision.payload#>'{club,active}'
        )),
        'course',jsonb_strip_nulls(jsonb_build_object(
          'id',revision.payload#>'{course,id}','clubId',revision.payload#>'{course,clubId}','name',revision.payload#>'{course,name}',
          'aliases',coalesce(revision.payload#>'{course,aliases}','[]'::jsonb),'holes',revision.payload#>'{course,holes}',
          'latitude',revision.payload#>'{course,latitude}','longitude',revision.payload#>'{course,longitude}','active',revision.payload#>'{course,active}'
        )),
        'tees',coalesce(revision.payload->'tees','[]'::jsonb),'holes',coalesce(revision.payload->'holes','[]'::jsonb),
        'teeHoleYardages',coalesce(revision.payload->'teeHoleYardages','[]'::jsonb)
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'dataEnvironment',revision.data_environment,
        'id',revision.payload->'id','aliases',coalesce(revision.payload->'aliases','[]'::jsonb),'brand',revision.payload->'brand',
        'model',revision.payload->'model','generation',revision.payload->'generation','year',revision.payload->'year',
        'active',revision.payload->'active','bagEligible',revision.payload->'bagEligible','fitEligible',revision.payload->'fitEligible',
        'sourceName',revision.payload->'sourceName','sourceUrl',revision.payload->'sourceUrl','sourceType',revision.payload->'sourceType',
        'confidence',revision.payload->'confidence','verifiedAt',revision.payload->'verifiedAt','officialUrl',revision.payload->'officialUrl',
        'category',revision.payload->'category','subCategory',revision.payload->'subCategory','handedness',coalesce(revision.payload->'handedness','[]'::jsonb),
        'lofts',coalesce(revision.payload->'lofts','[]'::jsonb),'variants',coalesce(revision.payload->'variants','[]'::jsonb),
        'standardLength',revision.payload->'standardLength','lie',revision.payload->'lie','headVolume',revision.payload->'headVolume',
        'setMakeup',revision.payload->'setMakeup','stockShafts',coalesce(revision.payload->'stockShafts','[]'::jsonb),
        'stockFlexes',coalesce(revision.payload->'stockFlexes','[]'::jsonb),'usage',revision.payload->'usage',
        'oemStockOrAftermarket',revision.payload->'oemStockOrAftermarket','weightOptions',coalesce(revision.payload->'weightOptions','[]'::jsonb),
        'flexOptions',coalesce(revision.payload->'flexOptions','[]'::jsonb),'weight',revision.payload->'weight',
        'flex',coalesce(revision.payload->'flex','[]'::jsonb),'launch',revision.payload->'launch','spin',revision.payload->'spin',
        'material',revision.payload->'material','torqueRange',coalesce(revision.payload->'torqueRange','[]'::jsonb)
      ) || jsonb_build_object(
        'torque',revision.payload->'torque','tipDiameter',revision.payload->'tipDiameter','buttDiameter',revision.payload->'buttDiameter',
        'coverMaterial',revision.payload->'coverMaterial','construction',revision.payload->'construction',
        'constructionPieces',revision.payload->'constructionPieces','compression',revision.payload->'compression',
        'compressionType',revision.payload->'compressionType','compressionSource',revision.payload->'compressionSource',
        'compressionSourceUrl',revision.payload->'compressionSourceUrl','flight',revision.payload->'flight',
        'driverSpin',revision.payload->'driverSpin','ironSpin',revision.payload->'ironSpin','shortGameSpin',revision.payload->'shortGameSpin',
        'feel',revision.payload->'feel','colors',coalesce(revision.payload->'colors','[]'::jsonb),'priceTier',revision.payload->'priceTier',
        'targetProfile',coalesce(revision.payload->'targetProfile','[]'::jsonb)
      )) end,
    revision.effective_from,revision.effective_until
  from public.admin_catalog_revisions revision
  where revision.entity_type=any(array(
    select requested from unnest(coalesce(requested_entity_types,array[]::text[])) requested
    where requested=any(array['COURSE','CLUB_EQUIPMENT','BALL','SHAFT']::text[])
  ))
    and revision.status in ('PUBLISHED','SUPERSEDED','ARCHIVED')
    and revision.data_environment='PRODUCTION'
  order by revision.entity_type,revision.entity_id,revision.version;
$$;
revoke all on function public.player_published_catalog_v1(text[]) from public;
grant execute on function public.player_published_catalog_v1(text[]) to anon,authenticated,service_role;

commit;
