-- Safe Admin exports contain catalog/operations data only: no auth tokens,
-- secrets or reporter PII. Invoker RLS remains the authorization boundary.
create or replace function public.admin_export_entity_v1(export_type text,export_id text)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare result jsonb;
begin
  if export_type in ('COURSE','CLUB_EQUIPMENT','BALL','SHAFT','LOCAL_RULE_SET','COMPETITION','COMPETITION_RULE_SET') then
    select jsonb_build_object(
      'entityType',revision.entity_type,
      'entityId',revision.entity_id,
      'version',revision.version,
      'status',revision.status,
      'effectiveFrom',revision.effective_from,
      'effectiveUntil',revision.effective_until,
      'revisionHash',revision.revision_hash,
      'sourceType',revision.source_type,
      'sourceName',revision.source_name,
      'sourceUrl',revision.source_url,
      'verifiedAt',revision.verified_at,
      'payload',revision.payload
    ) into result
    from public.admin_catalog_revisions revision
    where revision.entity_type=export_type and revision.entity_id=export_id
    order by revision.version desc limit 1;
  elsif export_type='COURSE_CONFIGURATION' then
    select jsonb_build_object(
      'configuration',to_jsonb(configuration)-'created_by'-'published_by',
      'holes',coalesce((select jsonb_agg(to_jsonb(hole) order by hole.sequence) from public.course_configuration_holes hole where hole.configuration_id=configuration.id),'[]'::jsonb),
      'teeHoles',coalesce((select jsonb_agg(to_jsonb(tee_hole)) from public.course_configuration_tee_holes tee_hole join public.course_configuration_holes hole on hole.id=tee_hole.configuration_hole_id where hole.configuration_id=configuration.id),'[]'::jsonb),
      'ratings',coalesce((select jsonb_agg(to_jsonb(rating)) from public.course_configuration_ratings rating where rating.configuration_id=configuration.id),'[]'::jsonb)
    ) into result from public.course_configurations configuration where configuration.id=export_id::uuid;
  else raise exception 'UNSUPPORTED_EXPORT'; end if;
  if result is null then raise exception 'EXPORT_NOT_FOUND' using errcode='P0002'; end if;
  return result;
end;
$$;
revoke all on function public.admin_export_entity_v1(text,text) from public,anon;
grant execute on function public.admin_export_entity_v1(text,text) to authenticated,service_role;
