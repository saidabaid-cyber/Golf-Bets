-- Publication is a database security boundary, not only an HTTP convention.
-- Validate the minimum canonical contract again inside the publish transition.
create or replace function private.admin_validate_revision_payload_v1(revision public.admin_catalog_revisions)
returns void language plpgsql security invoker set search_path=''
as $$
declare payload jsonb:=revision.payload; expected_holes integer; rule_data jsonb;
begin
  if jsonb_typeof(payload)<>'object' then raise exception 'INVALID_PUBLICATION_PAYLOAD'; end if;
  if revision.entity_type='COURSE' then
    if jsonb_typeof(payload->'club')<>'object' or jsonb_typeof(payload->'course')<>'object'
      or coalesce(payload->'club'->>'id','')='' or coalesce(payload->'club'->>'name','')=''
      or payload->'course'->>'id' is distinct from revision.entity_id
      or coalesce(payload->'course'->>'clubId','')<>payload->'club'->>'id'
      or coalesce(payload->'course'->>'name','')='' then raise exception 'INVALID_COURSE_PAYLOAD'; end if;
    begin expected_holes:=(payload->'course'->>'holes')::integer; exception when others then raise exception 'INVALID_COURSE_HOLES'; end;
    if expected_holes not in (9,18) or jsonb_typeof(payload->'tees')<>'array' or jsonb_typeof(payload->'holes')<>'array'
      or jsonb_typeof(payload->'teeHoleYardages')<>'array' then raise exception 'INVALID_COURSE_PAYLOAD'; end if;
    if jsonb_array_length(payload->'holes') not in (0,expected_holes) then raise exception 'INCOMPLETE_COURSE_SCORECARD'; end if;
    if exists(select 1 from jsonb_array_elements(payload->'holes') hole
      where (hole->>'holeNumber')::integer not between 1 and expected_holes
        or (hole->>'par')::integer not between 3 and 6
        or (hole->>'strokeIndex')::integer not between 1 and expected_holes) then raise exception 'INVALID_COURSE_HOLE'; end if;
  elsif revision.entity_type='CLUB_EQUIPMENT' then
    if payload->>'id' is distinct from revision.entity_id or coalesce(payload->>'brand','')='' or coalesce(payload->>'model','')=''
      or coalesce(payload->>'category','') not in ('DRIVER','FAIRWAY_WOOD','HYBRID','IRON_SET','WEDGE','PUTTER')
      or jsonb_typeof(payload->'active')<>'boolean' or jsonb_typeof(payload->'handedness')<>'array'
      or jsonb_typeof(payload->'lofts')<>'array' or jsonb_typeof(payload->'variants')<>'array' then raise exception 'INVALID_CLUB_PAYLOAD'; end if;
  elsif revision.entity_type='SHAFT' then
    if payload->>'id' is distinct from revision.entity_id or coalesce(payload->>'brand','')='' or coalesce(payload->>'model','')=''
      or coalesce(payload->>'usage','') not in ('WOOD','FAIRWAY','HYBRID','UTILITY','IRON','WEDGE','PUTTER')
      or jsonb_typeof(payload->'active')<>'boolean' or jsonb_typeof(payload->'weightOptions')<>'array'
      or jsonb_typeof(payload->'flexOptions')<>'array' or jsonb_typeof(payload->'torqueRange')<>'array' then raise exception 'INVALID_SHAFT_PAYLOAD'; end if;
  elsif revision.entity_type='BALL' then
    if payload->>'id' is distinct from revision.entity_id or coalesce(payload->>'brand','')='' or coalesce(payload->>'model','')=''
      or jsonb_typeof(payload->'active')<>'boolean' or jsonb_typeof(payload->'colors')<>'array'
      or jsonb_typeof(payload->'targetProfile')<>'array' then raise exception 'INVALID_BALL_PAYLOAD'; end if;
  elsif revision.entity_type='LOCAL_RULE_SET' then
    if coalesce(payload->>'courseId','')='' or coalesce(payload->>'title','')='' or jsonb_typeof(payload->'rules')<>'array'
      or jsonb_array_length(payload->'rules')=0 then raise exception 'INVALID_LOCAL_RULE_SET'; end if;
    for rule_data in select value from jsonb_array_elements(payload->'rules') loop
      if coalesce(rule_data->>'category','') not in ('GENERAL','DROP_ZONE','PENALTY_AREA','GROUND_UNDER_REPAIR','PREFERRED_LIES','CART_PATH','TEMPORARY_GREEN','TEMPORARY_TEE','PACE_OF_PLAY','OTHER')
        or coalesce(rule_data->>'title','')='' or coalesce(rule_data->>'body','')='' then raise exception 'INVALID_LOCAL_RULE'; end if;
    end loop;
  elsif revision.entity_type='COMPETITION' then
    if payload->>'id' is distinct from revision.entity_id or coalesce(payload->>'name','')=''
      or coalesce(payload->>'type','') not in ('POLLA','TOURNAMENT','LEAGUE','EVENT')
      or coalesce(payload->>'visibility','') not in ('PUBLIC','PRIVATE') or coalesce(payload->>'courseId','')=''
      or jsonb_typeof(payload->'rules')<>'array' or jsonb_array_length(payload->'rules')=0 then raise exception 'INVALID_COMPETITION_PAYLOAD'; end if;
  end if;
end;
$$;
revoke all on function private.admin_validate_revision_payload_v1(public.admin_catalog_revisions) from public,anon;
grant execute on function private.admin_validate_revision_payload_v1(public.admin_catalog_revisions) to authenticated,service_role;

-- Project only compatibility rows needed by existing foreign keys and by the
-- normalized rule tables. The versioned revision remains canonical.
create or replace function private.admin_project_published_revision_v1(revision public.admin_catalog_revisions)
returns void language plpgsql security definer set search_path=''
as $$
declare payload jsonb:=revision.payload; competition_uuid uuid; projected_rule_set_id uuid; projected_local_rule_set_id uuid; rule_data jsonb; ordinal integer:=0;
begin
  if revision.entity_type='COURSE' then
    insert into public.golf_clubs(id,name,country,state_region,city,address,latitude,longitude,timezone,website,provider,source_url,active,visibility,verified_at,catalog_metadata)
    values(payload->'club'->>'id',payload->'club'->>'name',nullif(payload->'club'->>'country',''),nullif(payload->'club'->>'stateRegion',''),nullif(payload->'club'->>'city',''),nullif(payload->'club'->>'address',''),
      nullif(payload->'club'->>'latitude','')::double precision,nullif(payload->'club'->>'longitude','')::double precision,nullif(payload->'club'->>'timezone',''),nullif(payload->'club'->>'website',''),
      'BACKYARD_INTERNAL',revision.source_url,coalesce((payload->'club'->>'active')::boolean,true),'PUBLIC',revision.verified_at,jsonb_build_object('adminRevisionId',revision.id,'adminVersion',revision.version))
    on conflict(id) do nothing;
    insert into public.golf_courses(id,club_id,name,holes,provider,source_url,active,visibility,verified_at,catalog_metadata)
    values(revision.entity_id,payload->'course'->>'clubId',payload->'course'->>'name',(payload->'course'->>'holes')::smallint,'BACKYARD_INTERNAL',revision.source_url,
      coalesce((payload->'course'->>'active')::boolean,true),'PUBLIC',revision.verified_at,jsonb_build_object('adminRevisionId',revision.id,'adminVersion',revision.version))
    on conflict(id) do nothing;
    return;
  elsif revision.entity_type='LOCAL_RULE_SET' then
    insert into public.course_local_rule_sets(course_id,title,version,status,effective_from,effective_until,source,created_by,published_by,created_at,updated_at)
    values(payload->>'courseId',payload->>'title',revision.version,'PUBLISHED',revision.effective_from,revision.effective_until,coalesce(revision.source_url,revision.source_name),revision.created_by,(select auth.uid()),revision.created_at,now())
    on conflict(course_id,version) do update set title=excluded.title,status='PUBLISHED',effective_from=excluded.effective_from,effective_until=excluded.effective_until,source=excluded.source,published_by=excluded.published_by,updated_at=now()
    returning id into projected_local_rule_set_id;
    delete from public.course_local_rules where rule_set_id=projected_local_rule_set_id;
    for rule_data in select value from jsonb_array_elements(payload->'rules') loop
      ordinal:=ordinal+1;
      insert into public.course_local_rules(rule_set_id,title,body,short_summary,category,hole_refs,display_order,source_reference,active)
      values(projected_local_rule_set_id,rule_data->>'title',rule_data->>'body',nullif(rule_data->>'shortSummary',''),rule_data->>'category',
        coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(rule_data->'holeRefs','[]'::jsonb))),array[]::smallint[]),ordinal,nullif(rule_data->>'sourceReference',''),coalesce((rule_data->>'active')::boolean,true));
    end loop;
    return;
  elsif revision.entity_type<>'COMPETITION' then return; end if;

  competition_uuid:=revision.entity_id::uuid;
  insert into public.competition_definitions(id,name,type,course_id,starts_at,ends_at,status,organizer,visibility,description,settings,created_by,published_by,created_at,updated_at)
  values(competition_uuid,payload->>'name',payload->>'type',payload->>'courseId',nullif(payload->>'startsAt','')::timestamptz,nullif(payload->>'endsAt','')::timestamptz,'PUBLISHED',nullif(payload->>'organizer',''),payload->>'visibility',
    nullif(payload->>'description',''),jsonb_strip_nulls(jsonb_build_object('format',payload->'format','handicapMaximum',payload->'handicapMaximum','handicapPercentage',payload->'handicapPercentage','tees',payload->'tees','prizes',payload->'prizes','closestToPin',payload->'closestToPin','tieBreak',payload->'tieBreak','specialRules',payload->'specialRules')),
    revision.created_by,(select auth.uid()),revision.created_at,now())
  on conflict(id) do update set name=excluded.name,type=excluded.type,course_id=excluded.course_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status='PUBLISHED',organizer=excluded.organizer,visibility=excluded.visibility,description=excluded.description,settings=excluded.settings,published_by=excluded.published_by,updated_at=now();
  insert into public.competition_rule_sets(competition_id,title,version,status,created_by,published_by)
  values(competition_uuid,coalesce(nullif(payload->>'rulesTitle',''),'Reglamento'),revision.version,'PUBLISHED',revision.created_by,(select auth.uid()))
  on conflict(competition_id,version) do update set title=excluded.title,status='PUBLISHED',published_by=excluded.published_by,updated_at=now()
  returning id into projected_rule_set_id;
  delete from public.competition_rules where rule_set_id=projected_rule_set_id;
  for rule_data in select value from jsonb_array_elements(payload->'rules') loop
    ordinal:=ordinal+1;
    insert into public.competition_rules(rule_set_id,category,title,body,engine_contract,display_order,active)
    values(projected_rule_set_id,rule_data->>'category',rule_data->>'title',rule_data->>'body',rule_data->'engineContract',ordinal,coalesce((rule_data->>'active')::boolean,true));
  end loop;
end;
$$;
revoke all on function private.admin_project_published_revision_v1(public.admin_catalog_revisions) from public,anon;
grant execute on function private.admin_project_published_revision_v1(public.admin_catalog_revisions) to authenticated,service_role;

create or replace function private.admin_archive_projected_revision_v1(revision public.admin_catalog_revisions)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if revision.entity_type='COMPETITION' then
    update public.competition_definitions set status='ARCHIVED',updated_at=now() where id=revision.entity_id::uuid;
    update public.competition_rule_sets set status='ARCHIVED',updated_at=now() where competition_id=revision.entity_id::uuid and version=revision.version;
  elsif revision.entity_type='LOCAL_RULE_SET' then
    update public.course_local_rule_sets set status='ARCHIVED',updated_at=now() where course_id=revision.payload->>'courseId' and version=revision.version;
  end if;
end;
$$;
revoke all on function private.admin_archive_projected_revision_v1(public.admin_catalog_revisions) from public,anon;
grant execute on function private.admin_archive_projected_revision_v1(public.admin_catalog_revisions) to authenticated,service_role;

create or replace function private.guard_admin_revision_v1()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare allowed boolean := false; internal_publish boolean:=coalesce(current_setting('backyard.admin_publish',true),'')='on';
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
    if new.status='PUBLISHED' and not internal_publish then raise exception 'PUBLISH_RPC_REQUIRED' using errcode='42501'; end if;
    if new.status='REVIEWED' then new.reviewed_by:=(select auth.uid()); end if;
    if new.status='VERIFIED' then
      if new.provenance_status<>'VERIFIED' or new.source_type is null or new.source_name is null or new.verified_at is null then raise exception 'VERIFIED_EVIDENCE_REQUIRED' using errcode='23514'; end if;
      new.verified_by:=(select auth.uid());
    end if;
    if new.status='PUBLISHED' then perform private.admin_validate_revision_payload_v1(new); new.published_by:=(select auth.uid()); new.published_at:=now(); end if;
  end if;
  if old.status not in ('DRAFT','REVIEWED','VERIFIED') and not internal_publish and (
    old.entity_type is distinct from new.entity_type or old.entity_id is distinct from new.entity_id or old.scope_type is distinct from new.scope_type or old.scope_id is distinct from new.scope_id
    or old.version is distinct from new.version or old.payload is distinct from new.payload or old.source_type is distinct from new.source_type or old.source_name is distinct from new.source_name
    or old.source_url is distinct from new.source_url or old.provenance_status is distinct from new.provenance_status or old.verified_at is distinct from new.verified_at or old.confidence is distinct from new.confidence
    or old.internal_notes is distinct from new.internal_notes or old.effective_from is distinct from new.effective_from or old.effective_until is distinct from new.effective_until
    or old.supersedes_revision_id is distinct from new.supersedes_revision_id or old.preview_hash is distinct from new.preview_hash or old.revision_hash is distinct from new.revision_hash
    or old.created_by is distinct from new.created_by or old.created_at is distinct from new.created_at
  ) then raise exception 'PUBLISHED_REVISION_IMMUTABLE' using errcode='23514'; end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.guard_admin_revision_v1() from public,anon,authenticated;
