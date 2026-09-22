-- Publication scheduling without Cron. Published revisions are selected by
-- their [effective_from,effective_until) window at request time. A future
-- revision closes the current window at the handoff instant but does not make
-- the current revision disappear early.

create or replace function public.admin_publish_revision_v1(revision_id uuid,expected_preview_hash text,publish_reason text,request_id uuid)
returns public.admin_catalog_revisions language plpgsql security invoker set search_path=''
as $$
declare prior public.admin_catalog_revisions; changed public.admin_catalog_revisions; computed_hash text; publish_from timestamptz;
begin
  select * into prior from public.admin_catalog_revisions where id=revision_id for update;
  if not found then raise exception 'REVISION_NOT_FOUND' using errcode='P0002'; end if;
  if prior.status<>'VERIFIED' or prior.provenance_status<>'VERIFIED' then raise exception 'VERIFICATION_REQUIRED'; end if;
  if not private.admin_has_scope_v1(prior.entity_type,prior.scope_type,prior.scope_id,'PUBLISH') then raise exception 'PUBLISH_FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(publish_reason,'')))<3 then raise exception 'REASON_REQUIRED'; end if;
  computed_hash:=encode(extensions.digest(convert_to(prior.payload::text,'UTF8'),'sha256'),'hex');
  if expected_preview_hash is null or prior.preview_hash is distinct from expected_preview_hash or computed_hash<>expected_preview_hash then raise exception 'STALE_PREVIEW'; end if;
  publish_from:=coalesce(prior.effective_from,now());
  if prior.effective_until is not null and prior.effective_until<=publish_from then raise exception 'INVALID_EFFECTIVE_WINDOW'; end if;

  perform pg_advisory_xact_lock(hashtextextended(prior.entity_type||':'||prior.entity_id,0));
  if exists(
    select 1 from public.admin_catalog_revisions existing
    where existing.id<>prior.id and existing.entity_type=prior.entity_type and existing.entity_id=prior.entity_id
      and existing.status='PUBLISHED' and existing.effective_from>=publish_from
      and tstzrange(existing.effective_from,existing.effective_until,'[)') && tstzrange(publish_from,prior.effective_until,'[)')
  ) then raise exception 'PUBLICATION_OVERLAP'; end if;

  perform set_config('backyard.admin_publish','on',true);
  if publish_from>now() then
    update public.admin_catalog_revisions
      set effective_until=publish_from
      where id<>prior.id and entity_type=prior.entity_type and entity_id=prior.entity_id and status='PUBLISHED'
        and (effective_from is null or effective_from<publish_from)
        and (effective_until is null or effective_until>publish_from);
  else
    if exists(select 1 from public.admin_catalog_revisions existing where existing.id<>prior.id and existing.entity_type=prior.entity_type and existing.entity_id=prior.entity_id and existing.status='PUBLISHED' and existing.effective_from>now()) then raise exception 'FUTURE_PUBLICATION_EXISTS'; end if;
    update public.admin_catalog_revisions set status='SUPERSEDED'
      where entity_type=prior.entity_type and entity_id=prior.entity_id and status='PUBLISHED' and id<>prior.id;
  end if;
  update public.admin_catalog_revisions set status='PUBLISHED',effective_from=publish_from,revision_hash=computed_hash where id=prior.id returning * into changed;
  perform private.admin_project_published_revision_v1(changed);
  perform private.admin_audit_v1('PUBLISH',prior.entity_type,prior.entity_id,to_jsonb(prior),to_jsonb(changed),publish_reason,request_id,prior.scope_type,prior.scope_id);
  return changed;
end;
$$;
revoke all on function public.admin_publish_revision_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.admin_publish_revision_v1(uuid,text,text,uuid) to authenticated,service_role;

create or replace function private.admin_archive_projected_revision_v1(revision public.admin_catalog_revisions)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if revision.entity_type='COMPETITION' then
    update public.competition_definitions set status='ARCHIVED',updated_at=now() where id=revision.entity_id::uuid;
  end if;
end;
$$;
revoke all on function private.admin_archive_projected_revision_v1(public.admin_catalog_revisions) from public,anon;
grant execute on function private.admin_archive_projected_revision_v1(public.admin_catalog_revisions) to authenticated,service_role;

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
  if next_status='ARCHIVED' then perform private.admin_archive_projected_revision_v1(changed); end if;
  perform private.admin_audit_v1('TRANSITION_'||next_status,prior.entity_type,prior.entity_id,to_jsonb(prior),to_jsonb(changed),transition_reason,request_id,prior.scope_type,prior.scope_id);
  return changed;
end;
$$;
revoke all on function public.admin_transition_revision_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.admin_transition_revision_v1(uuid,text,text,uuid) to authenticated,service_role;

-- Internal publication code may close the effective window of an immutable
-- published revision. Client-driven changes remain rejected.
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
    if new.status='PUBLISHED' then new.published_by:=(select auth.uid()); new.published_at:=now(); end if;
  end if;
  if old.status not in ('DRAFT','REVIEWED','VERIFIED') and not internal_publish and (
    old.entity_type is distinct from new.entity_type or old.entity_id is distinct from new.entity_id
    or old.scope_type is distinct from new.scope_type or old.scope_id is distinct from new.scope_id
    or old.version is distinct from new.version or old.payload is distinct from new.payload
    or old.source_type is distinct from new.source_type or old.source_name is distinct from new.source_name
    or old.source_url is distinct from new.source_url or old.provenance_status is distinct from new.provenance_status
    or old.verified_at is distinct from new.verified_at or old.confidence is distinct from new.confidence
    or old.internal_notes is distinct from new.internal_notes or old.effective_from is distinct from new.effective_from
    or old.effective_until is distinct from new.effective_until or old.supersedes_revision_id is distinct from new.supersedes_revision_id
    or old.preview_hash is distinct from new.preview_hash or old.revision_hash is distinct from new.revision_hash
    or old.created_by is distinct from new.created_by or old.created_at is distinct from new.created_at
  ) then raise exception 'PUBLISHED_REVISION_IMMUTABLE' using errcode='23514'; end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.guard_admin_revision_v1() from public,anon,authenticated;

create or replace function private.admin_configuration_payload_v1(target_configuration_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$
  select jsonb_build_object(
    'configuration',to_jsonb(configuration)-'updated_at'-'revision_hash',
    'holes',coalesce((select jsonb_agg(to_jsonb(hole)-'created_at' order by hole.sequence) from public.course_configuration_holes hole where hole.configuration_id=configuration.id),'[]'::jsonb),
    'teeHoles',coalesce((select jsonb_agg(to_jsonb(yardage) order by yardage.configuration_hole_id,yardage.tee_id) from public.course_configuration_tee_holes yardage join public.course_configuration_holes hole on hole.id=yardage.configuration_hole_id where hole.configuration_id=configuration.id),'[]'::jsonb),
    'ratings',coalesce((select jsonb_agg(to_jsonb(rating) order by rating.tee_id) from public.course_configuration_ratings rating where rating.configuration_id=configuration.id),'[]'::jsonb)
  )
  from public.course_configurations configuration where configuration.id=target_configuration_id
$$;
revoke all on function private.admin_configuration_payload_v1(uuid) from public,anon;
grant execute on function private.admin_configuration_payload_v1(uuid) to authenticated,service_role;

create or replace function public.admin_prepare_course_configuration_v1(configuration_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare candidate public.course_configurations; preview jsonb; computed_hash text;
begin
  select * into candidate from public.course_configurations where id=configuration_id for update;
  if not found then raise exception 'CONFIGURATION_NOT_FOUND' using errcode='P0002'; end if;
  if candidate.status not in ('DRAFT','SCHEDULED') then raise exception 'CONFIGURATION_NOT_PREVIEWABLE'; end if;
  if not private.admin_has_scope_v1('COURSE_CONFIGURATION',candidate.scope_type,case when candidate.scope_type='COURSE' then candidate.course_id else candidate.competition_id::text end,'READ') then raise exception 'ADMIN_SCOPE_REQUIRED' using errcode='42501'; end if;
  preview:=private.admin_configuration_payload_v1(candidate.id);
  computed_hash:=encode(extensions.digest(convert_to(preview::text,'UTF8'),'sha256'),'hex');
  update public.course_configurations set revision_hash=computed_hash where id=candidate.id;
  perform private.admin_audit_v1('PREVIEW_CONFIGURATION','COURSE_CONFIGURATION',candidate.id::text,null,jsonb_build_object('previewHash',computed_hash),null,null,candidate.scope_type,case when candidate.scope_type='COURSE' then candidate.course_id else candidate.competition_id::text end);
  return jsonb_build_object('id',candidate.id,'previewHash',computed_hash,'preview',preview);
end;
$$;
revoke all on function public.admin_prepare_course_configuration_v1(uuid) from public,anon;
grant execute on function public.admin_prepare_course_configuration_v1(uuid) to authenticated,service_role;

create or replace function public.admin_publish_course_configuration_v2(
  configuration_id uuid,
  expected_preview_hash text,
  overlap_resolution text,
  publish_reason text,
  request_id uuid
) returns public.course_configurations
language plpgsql security invoker set search_path=''
as $$
declare candidate public.course_configurations; conflict_row public.course_configurations; published public.course_configurations;
  hole_count integer; preview jsonb; computed_hash text;
begin
  select * into candidate from public.course_configurations where id=configuration_id for update;
  if not found then raise exception 'CONFIGURATION_NOT_FOUND' using errcode='P0002'; end if;
  if candidate.status<>'DRAFT' and not (candidate.status='SCHEDULED' and candidate.published_by is null) then raise exception 'CONFIGURATION_NOT_PUBLISHABLE'; end if;
  if not private.admin_has_scope_v1('COURSE_CONFIGURATION',candidate.scope_type,case when candidate.scope_type='COURSE' then candidate.course_id else candidate.competition_id::text end,'PUBLISH') then raise exception 'PUBLISH_FORBIDDEN' using errcode='42501'; end if;
  if candidate.effective_from is null then raise exception 'EFFECTIVE_FROM_REQUIRED'; end if;
  if length(trim(coalesce(publish_reason,'')))<3 then raise exception 'REASON_REQUIRED'; end if;
  preview:=private.admin_configuration_payload_v1(candidate.id);
  computed_hash:=encode(extensions.digest(convert_to(preview::text,'UTF8'),'sha256'),'hex');
  if expected_preview_hash is null or candidate.revision_hash is distinct from expected_preview_hash or computed_hash<>expected_preview_hash then raise exception 'STALE_PREVIEW'; end if;
  select count(*) into hole_count from public.course_configuration_holes where configuration_id=candidate.id and playable;
  if hole_count not in (9,18) then raise exception 'PLAYABLE_HOLE_COUNT_REQUIRED'; end if;
  if exists(select 1 from public.course_configuration_holes where configuration_id=candidate.id and playable and runtime_hole_number is null) then raise exception 'PLAYABLE_RUNTIME_REQUIRED'; end if;
  if exists(select 1 from public.course_configuration_holes where configuration_id=candidate.id and kind='TEMPORARY' and playable and (par_override is null or stroke_index_override is null)) then raise exception 'TEMPORARY_HOLE_FACTS_REQUIRED'; end if;
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
      update public.course_configurations set status='SUPERSEDED',supersedes_configuration_id=candidate.id,updated_at=now() where id=conflict_row.id;
    else raise exception 'OVERLAP_RESOLUTION_REQUIRED'; end if;
  end if;
  update public.course_configurations set status=case when effective_from>now() then 'SCHEDULED' else 'PUBLISHED' end,
    published_by=(select auth.uid()),published_at=now(),revision_hash=computed_hash,updated_at=now()
    where id=candidate.id returning * into published;
  perform private.admin_audit_v1('PUBLISH_CONFIGURATION','COURSE_CONFIGURATION',candidate.id::text,to_jsonb(candidate),to_jsonb(published),publish_reason,request_id,candidate.scope_type,case when candidate.scope_type='COURSE' then candidate.course_id else candidate.competition_id::text end);
  return published;
end;
$$;
revoke all on function public.admin_publish_course_configuration_v2(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.admin_publish_course_configuration_v2(uuid,text,text,text,uuid) to authenticated,service_role;

-- The v1 publisher did not require a fresh Preview hash and is no longer a
-- client entry point. Existing migrations remain replayable; new clients use v2.
revoke all on function public.admin_publish_course_configuration_v1(uuid,text,text,uuid) from authenticated;

-- Canonical competition projections cannot represent two scheduled versions
-- at once. They remain Admin-internal; the player API resolves the effective
-- immutable revision and matching ruleset version server-side.
drop policy if exists competition_read on public.competition_definitions;
create policy competition_read on public.competition_definitions for select to authenticated
using(private.admin_has_scope_v1('COMPETITION','COMPETITION',id::text,'READ'));

drop policy if exists competition_rule_set_read on public.competition_rule_sets;
create policy competition_rule_set_read on public.competition_rule_sets for select to authenticated
using(private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',competition_id::text,'READ'));

drop policy if exists competition_rule_read on public.competition_rules;
create policy competition_rule_read on public.competition_rules for select to authenticated
using(exists(
  select 1 from public.competition_rule_sets rule_set
  where rule_set.id=rule_set_id and private.admin_has_scope_v1('COMPETITION_RULE_SET','COMPETITION',rule_set.competition_id::text,'READ')
));
