-- Transactional publication workflows for Admin Control Center v1.
begin;

create or replace function private.admin_actor_role_v1(target_entity text,target_scope_type text,target_scope_id text)
returns text language sql stable security definer set search_path=''
as $$
  select role from public.admin_memberships
  where user_id=(select auth.uid()) and active
    and private.admin_has_scope_v1(target_entity,target_scope_type,target_scope_id,'READ')
  order by case role when 'SUPER_ADMIN' then 0 else 1 end,created_at
  limit 1;
$$;
revoke all on function private.admin_actor_role_v1(text,text,text) from public,anon;
grant execute on function private.admin_actor_role_v1(text,text,text) to authenticated,service_role;

create or replace function private.admin_audit_v1(
  audit_action text,
  audit_entity_type text,
  audit_entity_id text,
  old_state jsonb,
  new_state jsonb,
  audit_reason text default null,
  audit_request_id uuid default null,
  audit_scope_type text default 'GLOBAL',
  audit_scope_id text default null
) returns void language plpgsql security definer set search_path=''
as $$
begin
  if (select auth.uid()) is null or not private.admin_has_scope_v1(audit_entity_type,audit_scope_type,audit_scope_id,'READ') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  insert into public.admin_audit_log(actor_id,actor_role,action,entity_type,entity_id,before_state,after_state,reason,request_id)
  values((select auth.uid()),private.admin_actor_role_v1(audit_entity_type,audit_scope_type,audit_scope_id),audit_action,audit_entity_type,audit_entity_id,old_state,new_state,audit_reason,audit_request_id);
end;
$$;
revoke all on function private.admin_audit_v1(text,text,text,jsonb,jsonb,text,uuid,text,text) from public,anon;
grant execute on function private.admin_audit_v1(text,text,text,jsonb,jsonb,text,uuid,text,text) to authenticated,service_role;

create or replace function private.guard_admin_revision_v1()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare allowed boolean := false;
begin
  if old.status is distinct from new.status then
    allowed := case old.status
      when 'DRAFT' then new.status in ('REVIEWED','ARCHIVED')
      when 'REVIEWED' then new.status in ('DRAFT','VERIFIED','ARCHIVED')
      when 'VERIFIED' then new.status in ('DRAFT','PUBLISHED','ARCHIVED')
      when 'PUBLISHED' then new.status in ('SUPERSEDED','ARCHIVED')
      when 'SUPERSEDED' then new.status='ARCHIVED'
      else false end;
    if not allowed then raise exception 'INVALID_PUBLICATION_TRANSITION' using errcode='23514'; end if;
    if new.status='PUBLISHED' and coalesce(current_setting('backyard.admin_publish',true),'')<>'on' then
      raise exception 'PUBLISH_RPC_REQUIRED' using errcode='42501';
    end if;
    if new.status='REVIEWED' then new.reviewed_by:=(select auth.uid()); end if;
    if new.status='VERIFIED' then
      if new.provenance_status<>'VERIFIED' or new.source_type is null or new.source_name is null or new.verified_at is null then
        raise exception 'VERIFIED_EVIDENCE_REQUIRED' using errcode='23514';
      end if;
      new.verified_by:=(select auth.uid());
    end if;
    if new.status='PUBLISHED' then
      new.published_by:=(select auth.uid()); new.published_at:=now();
    end if;
  end if;
  if old.status not in ('DRAFT','REVIEWED','VERIFIED') and old.payload is distinct from new.payload then
    raise exception 'PUBLISHED_REVISION_IMMUTABLE' using errcode='23514';
  end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.guard_admin_revision_v1() from public,anon,authenticated;

drop trigger if exists admin_catalog_revision_guard on public.admin_catalog_revisions;
create trigger admin_catalog_revision_guard before update on public.admin_catalog_revisions
for each row execute function private.guard_admin_revision_v1();

create or replace function public.admin_create_revision_v1(
  target_entity_type text,target_entity_id text,target_scope_type text,target_scope_id text,
  target_payload jsonb,target_source_type text,target_source_name text,target_source_url text,
  target_provenance_status text,target_verified_at timestamptz,target_confidence text,target_notes text
) returns public.admin_catalog_revisions
language plpgsql security invoker set search_path=''
as $$
declare next_version integer; created public.admin_catalog_revisions;
begin
  if not private.admin_has_scope_v1(target_entity_type,target_scope_type,target_scope_id,'CREATE_DRAFT') then raise exception 'ADMIN_SCOPE_REQUIRED' using errcode='42501'; end if;
  if target_payload is null or jsonb_typeof(target_payload)<>'object' or pg_column_size(target_payload)>1000000 then raise exception 'INVALID_PAYLOAD'; end if;
  if target_entity_type not in ('COURSE','COURSE_CONFIGURATION','LOCAL_RULE_SET','CLUB_EQUIPMENT','BALL','SHAFT','EQUIPMENT_IMAGE','COMPETITION','COMPETITION_RULE_SET','REQUEST','IMPORT') then raise exception 'INVALID_ENTITY_TYPE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_entity_type||':'||target_entity_id,0));
  select coalesce(max(version),0)+1 into next_version from public.admin_catalog_revisions where entity_type=target_entity_type and entity_id=target_entity_id;
  insert into public.admin_catalog_revisions(entity_type,entity_id,scope_type,scope_id,version,payload,source_type,source_name,source_url,provenance_status,verified_at,confidence,internal_notes,created_by)
  values(target_entity_type,target_entity_id,target_scope_type,target_scope_id,next_version,target_payload,target_source_type,target_source_name,target_source_url,target_provenance_status,target_verified_at,target_confidence,target_notes,(select auth.uid()))
  returning * into created;
  return created;
end;
$$;
revoke all on function public.admin_create_revision_v1(text,text,text,text,jsonb,text,text,text,text,timestamptz,text,text) from public,anon;
grant execute on function public.admin_create_revision_v1(text,text,text,text,jsonb,text,text,text,text,timestamptz,text,text) to authenticated,service_role;

create or replace function public.admin_prepare_revision_v1(revision_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare revision public.admin_catalog_revisions; computed_hash text;
begin
  select * into revision from public.admin_catalog_revisions where id=revision_id for update;
  if not found then raise exception 'REVISION_NOT_FOUND' using errcode='P0002'; end if;
  if revision.status not in ('DRAFT','REVIEWED','VERIFIED') then raise exception 'REVISION_NOT_PREVIEWABLE'; end if;
  computed_hash:=encode(extensions.digest(convert_to(revision.payload::text,'UTF8'),'sha256'),'hex');
  update public.admin_catalog_revisions set preview_hash=computed_hash where id=revision.id;
  perform private.admin_audit_v1('PREVIEW',revision.entity_type,revision.entity_id,null,jsonb_build_object('previewHash',computed_hash),null,null,revision.scope_type,revision.scope_id);
  return jsonb_build_object('id',revision.id,'entityType',revision.entity_type,'entityId',revision.entity_id,'version',revision.version,'previewHash',computed_hash,'payload',revision.payload);
end;
$$;
revoke all on function public.admin_prepare_revision_v1(uuid) from public,anon;
grant execute on function public.admin_prepare_revision_v1(uuid) to authenticated,service_role;

create or replace function public.admin_transition_revision_v1(revision_id uuid,next_status text,transition_reason text,request_id uuid)
returns public.admin_catalog_revisions language plpgsql security invoker set search_path=''
as $$
declare prior public.admin_catalog_revisions; changed public.admin_catalog_revisions;
begin
  select * into prior from public.admin_catalog_revisions where id=revision_id for update;
  if not found then raise exception 'REVISION_NOT_FOUND' using errcode='P0002'; end if;
  if next_status not in ('DRAFT','REVIEWED','VERIFIED','ARCHIVED') then raise exception 'INVALID_TRANSITION_TARGET'; end if;
  if length(trim(coalesce(transition_reason,'')))<3 then raise exception 'REASON_REQUIRED'; end if;
  update public.admin_catalog_revisions set status=next_status where id=revision_id returning * into changed;
  perform private.admin_audit_v1('TRANSITION_'||next_status,prior.entity_type,prior.entity_id,to_jsonb(prior),to_jsonb(changed),transition_reason,request_id,prior.scope_type,prior.scope_id);
  return changed;
end;
$$;
revoke all on function public.admin_transition_revision_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.admin_transition_revision_v1(uuid,text,text,uuid) to authenticated,service_role;

-- Only the private projector may update canonical competition rows. Catalog
-- entities remain in the versioned revision layer consumed by server providers.
create or replace function private.admin_project_published_revision_v1(revision public.admin_catalog_revisions)
returns void language plpgsql security definer set search_path=''
as $$
declare payload jsonb:=revision.payload; competition_uuid uuid; projected_rule_set_id uuid; rule_data jsonb; ordinal integer:=0;
begin
  if revision.entity_type<>'COMPETITION' then return; end if;
  competition_uuid:=revision.entity_id::uuid;
  if payload->>'id' is distinct from revision.entity_id then raise exception 'COMPETITION_ID_MISMATCH'; end if;
  if payload->>'type' not in ('POLLA','TOURNAMENT','LEAGUE','EVENT') then raise exception 'INVALID_COMPETITION_TYPE'; end if;
  insert into public.competition_definitions(id,name,type,course_id,starts_at,ends_at,status,organizer,visibility,description,settings,created_by,published_by,created_at,updated_at)
  values(competition_uuid,payload->>'name',payload->>'type',nullif(payload->>'courseId',''),nullif(payload->>'startsAt','')::timestamptz,
    nullif(payload->>'endsAt','')::timestamptz,'PUBLISHED',nullif(payload->>'organizer',''),coalesce(nullif(payload->>'visibility',''),'PRIVATE'),
    nullif(payload->>'description',''),jsonb_strip_nulls(jsonb_build_object('format',payload->'format','handicapMaximum',payload->'handicapMaximum',
      'handicapPercentage',payload->'handicapPercentage','prizes',payload->'prizes','tieBreak',payload->'tieBreak')),
    revision.created_by,(select auth.uid()),revision.created_at,now())
  on conflict(id) do update set name=excluded.name,type=excluded.type,course_id=excluded.course_id,starts_at=excluded.starts_at,
    ends_at=excluded.ends_at,status='PUBLISHED',organizer=excluded.organizer,visibility=excluded.visibility,description=excluded.description,
    settings=excluded.settings,published_by=excluded.published_by,updated_at=now();

  insert into public.competition_rule_sets(competition_id,title,version,status,created_by,published_by)
  values(competition_uuid,coalesce(nullif(payload->>'rulesTitle',''),'Reglamento'),revision.version,'PUBLISHED',revision.created_by,(select auth.uid()))
  on conflict(competition_id,version) do update set title=excluded.title,status='PUBLISHED',published_by=excluded.published_by,updated_at=now()
  returning id into projected_rule_set_id;
  delete from public.competition_rules where rule_set_id=projected_rule_set_id;
  for rule_data in select value from jsonb_array_elements(coalesce(payload->'rules','[]'::jsonb)) loop
    ordinal:=ordinal+1;
    if rule_data->>'category' not in ('FORMAT','HANDICAP','SCORING','TIE_BREAK','PRIZE','CLOSEST_TO_PIN','PACE','LOCAL_EVENT_RULE','BETTING','CONDUCT','OTHER') then
      raise exception 'INVALID_COMPETITION_RULE_CATEGORY';
    end if;
    insert into public.competition_rules(rule_set_id,category,title,body,engine_contract,display_order,active)
    values(projected_rule_set_id,rule_data->>'category',rule_data->>'title',rule_data->>'body',rule_data->'engineContract',ordinal,coalesce((rule_data->>'active')::boolean,true));
  end loop;
end;
$$;
revoke all on function private.admin_project_published_revision_v1(public.admin_catalog_revisions) from public,anon;
grant execute on function private.admin_project_published_revision_v1(public.admin_catalog_revisions) to authenticated,service_role;

create or replace function public.admin_publish_revision_v1(revision_id uuid,expected_preview_hash text,publish_reason text,request_id uuid)
returns public.admin_catalog_revisions language plpgsql security invoker set search_path=''
as $$
declare prior public.admin_catalog_revisions; changed public.admin_catalog_revisions; computed_hash text;
begin
  select * into prior from public.admin_catalog_revisions where id=revision_id for update;
  if not found then raise exception 'REVISION_NOT_FOUND' using errcode='P0002'; end if;
  if prior.status<>'VERIFIED' or prior.provenance_status<>'VERIFIED' then raise exception 'VERIFICATION_REQUIRED'; end if;
  if not private.admin_has_scope_v1(prior.entity_type,prior.scope_type,prior.scope_id,'PUBLISH') then raise exception 'PUBLISH_FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(publish_reason,'')))<3 then raise exception 'REASON_REQUIRED'; end if;
  computed_hash:=encode(extensions.digest(convert_to(prior.payload::text,'UTF8'),'sha256'),'hex');
  if expected_preview_hash is null or prior.preview_hash is distinct from expected_preview_hash or computed_hash<>expected_preview_hash then
    raise exception 'STALE_PREVIEW';
  end if;
  perform set_config('backyard.admin_publish','on',true);
  update public.admin_catalog_revisions set status='SUPERSEDED'
    where entity_type=prior.entity_type and entity_id=prior.entity_id and status='PUBLISHED' and id<>prior.id;
  update public.admin_catalog_revisions set status='PUBLISHED',revision_hash=computed_hash where id=prior.id returning * into changed;
  perform private.admin_project_published_revision_v1(changed);
  perform private.admin_audit_v1('PUBLISH',prior.entity_type,prior.entity_id,to_jsonb(prior),to_jsonb(changed),publish_reason,request_id,prior.scope_type,prior.scope_id);
  return changed;
end;
$$;
revoke all on function public.admin_publish_revision_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.admin_publish_revision_v1(uuid,text,text,uuid) to authenticated,service_role;

create or replace function public.admin_create_course_configuration_v1(configuration_payload jsonb)
returns public.course_configurations
language plpgsql security invoker set search_path=''
as $$
declare created public.course_configurations; next_version integer; hole_data jsonb; yardage_data jsonb; rating_data jsonb;
  target_scope text:=configuration_payload->>'scopeType'; target_course text:=configuration_payload->>'courseId';
  target_competition uuid:=nullif(configuration_payload->>'competitionId','')::uuid;
  scope_key text; computed_hash text;
begin
  if jsonb_typeof(configuration_payload)<>'object' or jsonb_typeof(configuration_payload->'holes')<>'array' then raise exception 'INVALID_CONFIGURATION_PAYLOAD'; end if;
  if target_scope not in ('COURSE','COMPETITION') then raise exception 'INVALID_CONFIGURATION_SCOPE'; end if;
  scope_key:=case when target_scope='COURSE' then target_course else target_competition::text end;
  if not private.admin_has_scope_v1('COURSE_CONFIGURATION',target_scope,scope_key,'CREATE_DRAFT') then raise exception 'ADMIN_SCOPE_REQUIRED' using errcode='42501'; end if;
  computed_hash:=encode(extensions.digest(convert_to(configuration_payload::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_course||':'||target_scope||':'||coalesce(target_competition::text,''),0));
  select coalesce(max(version),0)+1 into next_version from public.course_configurations
    where course_id=target_course and scope_type=target_scope and competition_id is not distinct from target_competition;
  insert into public.course_configurations(course_id,name,description,scope_type,competition_id,status,effective_from,effective_until,reason,source_description,created_by,version,revision_hash)
  values(target_course,configuration_payload->>'name',nullif(configuration_payload->>'description',''),target_scope,target_competition,'DRAFT',
    nullif(configuration_payload->>'effectiveFrom','')::timestamptz,nullif(configuration_payload->>'effectiveUntil','')::timestamptz,
    nullif(configuration_payload->>'reason',''),nullif(configuration_payload->>'sourceDescription',''),(select auth.uid()),next_version,computed_hash)
  returning * into created;
  for hole_data in select value from jsonb_array_elements(configuration_payload->'holes') loop
    insert into public.course_configuration_holes(configuration_id,client_key,sequence,runtime_hole_number,display_label,source_base_hole_id,source_base_hole_number,kind,playable,par_override,stroke_index_override,notes,temporary_green,temporary_tee,drop_zone_note,operational_note)
    values(created.id,hole_data->>'clientKey',(hole_data->>'sequence')::smallint,(hole_data->>'runtimeHoleNumber')::smallint,hole_data->>'displayLabel',
      nullif(hole_data->>'sourceBaseHoleId',''),nullif(hole_data->>'sourceBaseHoleNumber','')::smallint,hole_data->>'kind',coalesce((hole_data->>'playable')::boolean,true),
      nullif(hole_data->>'parOverride','')::smallint,nullif(hole_data->>'strokeIndexOverride','')::smallint,nullif(hole_data->>'notes',''),
      coalesce((hole_data->>'temporaryGreen')::boolean,false),coalesce((hole_data->>'temporaryTee')::boolean,false),
      nullif(hole_data->>'dropZoneNote',''),nullif(hole_data->>'operationalNote',''));
  end loop;
  for yardage_data in select value from jsonb_array_elements(coalesce(configuration_payload->'teeHoles','[]'::jsonb)) loop
    insert into public.course_configuration_tee_holes(configuration_hole_id,tee_id,yards_override,source,verified_at)
    select hole.id,yardage_data->>'teeId',nullif(yardage_data->>'yardsOverride','')::integer,nullif(yardage_data->>'source',''),nullif(yardage_data->>'verifiedAt','')::timestamptz
    from public.course_configuration_holes hole where hole.configuration_id=created.id and hole.client_key=yardage_data->>'configurationHoleKey';
    if not found then raise exception 'CONFIGURATION_HOLE_KEY_NOT_FOUND'; end if;
  end loop;
  for rating_data in select value from jsonb_array_elements(coalesce(configuration_payload->'ratings','[]'::jsonb)) loop
    insert into public.course_configuration_ratings(configuration_id,tee_id,rating,slope,category,source,verified_at,notes)
    values(created.id,rating_data->>'teeId',(rating_data->>'rating')::numeric,(rating_data->>'slope')::smallint,nullif(rating_data->>'category',''),rating_data->>'source',(rating_data->>'verifiedAt')::timestamptz,nullif(rating_data->>'notes',''));
  end loop;
  return created;
end;
$$;
revoke all on function public.admin_create_course_configuration_v1(jsonb) from public,anon;
grant execute on function public.admin_create_course_configuration_v1(jsonb) to authenticated,service_role;

-- Course configuration publication is serialized per Course/scope. It never
-- updates an active round; callers persist the resolved snapshot at round start.
create or replace function public.admin_publish_course_configuration_v1(
  configuration_id uuid,
  overlap_resolution text,
  publish_reason text,
  request_id uuid
) returns public.course_configurations
language plpgsql security invoker set search_path=''
as $$
declare candidate public.course_configurations; conflict_row public.course_configurations; published public.course_configurations; hole_count integer;
begin
  select * into candidate from public.course_configurations where id=configuration_id for update;
  if not found then raise exception 'CONFIGURATION_NOT_FOUND' using errcode='P0002'; end if;
  if candidate.status not in ('DRAFT','SCHEDULED') then raise exception 'CONFIGURATION_NOT_PUBLISHABLE'; end if;
  if not private.admin_has_scope_v1('COURSE_CONFIGURATION',candidate.scope_type,case when candidate.scope_type='COURSE' then candidate.course_id else candidate.competition_id::text end,'PUBLISH') then raise exception 'PUBLISH_FORBIDDEN' using errcode='42501'; end if;
  if candidate.effective_from is null then raise exception 'EFFECTIVE_FROM_REQUIRED'; end if;
  select count(*) into hole_count from public.course_configuration_holes where configuration_id=candidate.id and playable;
  if hole_count not in (9,18) then raise exception 'PLAYABLE_HOLE_COUNT_REQUIRED'; end if;
  if exists(select 1 from public.course_configuration_holes where configuration_id=candidate.id and kind='TEMPORARY' and (par_override is null or stroke_index_override is null)) then
    raise exception 'TEMPORARY_HOLE_FACTS_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(candidate.course_id||':'||candidate.scope_type||':'||coalesce(candidate.competition_id::text,''),0));
  select * into conflict_row from public.course_configurations existing
    where existing.id<>candidate.id and existing.course_id=candidate.course_id and existing.scope_type=candidate.scope_type
      and existing.competition_id is not distinct from candidate.competition_id and existing.status in ('SCHEDULED','PUBLISHED')
      and tstzrange(existing.effective_from,existing.effective_until,'[)') && tstzrange(candidate.effective_from,candidate.effective_until,'[)')
    order by existing.version desc limit 1 for update;
  if found then
    if overlap_resolution='CANCEL' then raise exception 'CONFIGURATION_OVERLAP';
    elsif overlap_resolution='FINALIZE_PREVIOUS' then
      if conflict_row.effective_from>=candidate.effective_from then raise exception 'INVALID_FINALIZATION'; end if;
      update public.course_configurations set effective_until=candidate.effective_from,status='SUPERSEDED',updated_at=now() where id=conflict_row.id;
    elsif overlap_resolution='SUPERSEDE_PREVIOUS' then
      update public.course_configurations set status='SUPERSEDED',updated_at=now() where id=conflict_row.id;
    else raise exception 'OVERLAP_RESOLUTION_REQUIRED'; end if;
  end if;
  update public.course_configurations set status=case when effective_from>now() then 'SCHEDULED' else 'PUBLISHED' end,
    published_by=(select auth.uid()),published_at=now(),updated_at=now() where id=candidate.id returning * into published;
  perform private.admin_audit_v1('PUBLISH_CONFIGURATION','COURSE_CONFIGURATION',candidate.id::text,to_jsonb(candidate),to_jsonb(published),publish_reason,request_id,candidate.scope_type,case when candidate.scope_type='COURSE' then candidate.course_id else candidate.competition_id::text end);
  return published;
end;
$$;
revoke all on function public.admin_publish_course_configuration_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.admin_publish_course_configuration_v1(uuid,text,text,uuid) to authenticated,service_role;

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

create or replace function public.admin_create_draft_from_request_v1(
  feedback_id uuid,
  draft_entity_type text,
  request_id uuid
) returns public.admin_request_drafts
language sql security invoker set search_path=''
as $$ select private.admin_create_draft_from_request_impl_v1(feedback_id,draft_entity_type,request_id) $$;
revoke all on function public.admin_create_draft_from_request_v1(uuid,text,uuid) from public,anon;
grant execute on function public.admin_create_draft_from_request_v1(uuid,text,uuid) to authenticated,service_role;

create or replace function private.admin_feedback_queue_impl_v1(queue_limit integer default 50)
returns table(id uuid,category text,request_status text,title text,description text,source_screen text,attachment_status text,created_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select request.id,request.category,request.request_status,request.title,request.description,request.source_screen,request.attachment_status,request.created_at
  from public.feedback_requests request
  where private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ')
  order by request.created_at desc limit greatest(1,least(queue_limit,100));
$$;
revoke all on function private.admin_feedback_queue_impl_v1(integer) from public,anon;
grant execute on function private.admin_feedback_queue_impl_v1(integer) to authenticated,service_role;

create or replace function public.admin_feedback_queue_v1(queue_limit integer default 50)
returns table(id uuid,category text,request_status text,title text,description text,source_screen text,attachment_status text,created_at timestamptz)
language sql stable security invoker set search_path=''
as $$ select * from private.admin_feedback_queue_impl_v1(queue_limit) $$;
revoke all on function public.admin_feedback_queue_v1(integer) from public,anon;
grant execute on function public.admin_feedback_queue_v1(integer) to authenticated,service_role;

-- Audit inserts from the workflow functions only. Direct client mutation of
-- this table remains impossible because authenticated has SELECT alone.
create or replace function public.admin_export_entity_v1(export_type text,export_id text)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare result jsonb;
begin
  if export_type='COURSE' then
    select payload into result from public.admin_catalog_revisions where entity_type='COURSE' and entity_id=export_id and status='PUBLISHED' order by version desc limit 1;
  elsif export_type in ('CLUB_EQUIPMENT','BALL','SHAFT') then
    select payload into result from public.admin_catalog_revisions where entity_type=export_type and entity_id=export_id and status='PUBLISHED' order by version desc limit 1;
  elsif export_type='COURSE_CONFIGURATION' then
    select jsonb_build_object('configuration',to_jsonb(c),'holes',coalesce((select jsonb_agg(to_jsonb(h) order by h.sequence) from public.course_configuration_holes h where h.configuration_id=c.id),'[]'::jsonb))
    into result from public.course_configurations c where c.id=export_id::uuid;
  elsif export_type='COMPETITION' then
    select to_jsonb(c) into result from public.competition_definitions c where c.id=export_id::uuid;
  else raise exception 'UNSUPPORTED_EXPORT'; end if;
  if result is null then raise exception 'EXPORT_NOT_FOUND' using errcode='P0002'; end if;
  return result - 'created_by' - 'published_by';
end;
$$;
revoke all on function public.admin_export_entity_v1(text,text) from public,anon;
grant execute on function public.admin_export_entity_v1(text,text) to authenticated,service_role;

create or replace function private.audit_admin_revision_row_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare row_value public.admin_catalog_revisions := case when tg_op='INSERT' then new else new end;
begin
  perform private.admin_audit_v1(
    case when tg_op='INSERT' then 'CREATE_DRAFT' when old.status is distinct from new.status then 'STATUS_'||new.status else 'EDIT_DRAFT' end,
    row_value.entity_type,row_value.entity_id,
    case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new),null,null,row_value.scope_type,row_value.scope_id
  );
  return new;
end;
$$;
revoke all on function private.audit_admin_revision_row_v1() from public,anon,authenticated;
drop trigger if exists admin_catalog_revision_audit on public.admin_catalog_revisions;
create trigger admin_catalog_revision_audit after insert or update on public.admin_catalog_revisions
for each row execute function private.audit_admin_revision_row_v1();

create or replace function private.audit_admin_scoped_row_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb:=case when tg_op='INSERT' then null else to_jsonb(old) end;
  entity_type text:=tg_argv[0]; scope_type_value text:=tg_argv[1]; scope_field text:=tg_argv[2];
  scope_id_value text; entity_id_value text:=row_data->>'id';
begin
  if left(scope_type_value,1)='@' then scope_type_value:=row_data->>substring(scope_type_value from 2); end if;
  scope_id_value:=case when scope_field='' then null else row_data->>scope_field end;
  if entity_type='COURSE_CONFIGURATION' and scope_type_value='COMPETITION' then scope_id_value:=row_data->>'competition_id'; end if;
  perform private.admin_audit_v1(case when tg_op='INSERT' then 'CREATE_DRAFT' else 'UPDATE' end,
    entity_type,entity_id_value,old_data,row_data,null,null,scope_type_value,scope_id_value);
  return new;
end;
$$;
revoke all on function private.audit_admin_scoped_row_v1() from public,anon,authenticated;

drop trigger if exists course_configuration_audit on public.course_configurations;
create trigger course_configuration_audit after insert or update on public.course_configurations
for each row execute function private.audit_admin_scoped_row_v1('COURSE_CONFIGURATION','@scope_type','course_id');
drop trigger if exists local_rule_set_audit on public.course_local_rule_sets;
create trigger local_rule_set_audit after insert or update on public.course_local_rule_sets
for each row execute function private.audit_admin_scoped_row_v1('LOCAL_RULE_SET','COURSE','course_id');
drop trigger if exists competition_definition_audit on public.competition_definitions;
create trigger competition_definition_audit after insert or update on public.competition_definitions
for each row execute function private.audit_admin_scoped_row_v1('COMPETITION','COMPETITION','id');
drop trigger if exists competition_rule_set_audit on public.competition_rule_sets;
create trigger competition_rule_set_audit after insert or update on public.competition_rule_sets
for each row execute function private.audit_admin_scoped_row_v1('COMPETITION_RULE_SET','COMPETITION','competition_id');
drop trigger if exists import_job_audit on public.admin_import_jobs;
create trigger import_job_audit after insert or update on public.admin_import_jobs
for each row execute function private.audit_admin_scoped_row_v1('IMPORT','@scope_type','scope_id');
drop trigger if exists request_draft_audit on public.admin_request_drafts;
create trigger request_draft_audit after insert or update on public.admin_request_drafts
for each row execute function private.audit_admin_scoped_row_v1('REQUEST','GLOBAL','');

commit;
