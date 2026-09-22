-- Qualify child-table references; the RPC parameter is intentionally named
-- configuration_id for a stable PostgREST contract.
create or replace function public.admin_publish_course_configuration_v2(
  configuration_id uuid, expected_preview_hash text, overlap_resolution text,
  publish_reason text, request_id uuid
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
  select count(*) into hole_count from public.course_configuration_holes hole where hole.configuration_id=candidate.id and hole.playable;
  if hole_count not in (9,18) then raise exception 'PLAYABLE_HOLE_COUNT_REQUIRED'; end if;
  if exists(select 1 from public.course_configuration_holes hole where hole.configuration_id=candidate.id and hole.playable and hole.runtime_hole_number is null) then raise exception 'PLAYABLE_RUNTIME_REQUIRED'; end if;
  if exists(select 1 from public.course_configuration_holes hole where hole.configuration_id=candidate.id and hole.kind='TEMPORARY' and hole.playable and (hole.par_override is null or hole.stroke_index_override is null)) then raise exception 'TEMPORARY_HOLE_FACTS_REQUIRED'; end if;
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
