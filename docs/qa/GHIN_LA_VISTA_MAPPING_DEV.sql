-- DML audit artifact. Apply ONLY through project bymeopxkxapfizeeqeyb (DEV).
-- Adds physical alias evidence; never updates rounds, scores or frozen ratings.
-- Existing canonical provider links and their uniqueness constraints stay intact.
begin;
do $$
declare
  source_geometry jsonb;
  provider_geometry jsonb;
  course_alias jsonb := '{"status":"CONFIRMED","provider":"GHIN","club_id":"club-la-vista","canonical_course_id":"course-la-vista","course_provider_link_id":"f7c3aa26-866c-46ef-a227-29f2f734764b","provider_course_id":"23233","provider_facility_id":"19886","verified_at":"2026-10-06T23:04:47.343Z","evidence":"OWNED_SESSION_LIVE_COURSE_AND_GOLD_18_HOLE_GEOMETRY","source_data_version":"la-vista-club-current-2026-09-28"}';
  tee_alias jsonb := '{"status":"CONFIRMED","provider":"GHIN","canonical_course_id":"course-la-vista","canonical_tee_id":"tee-la-vista-doradas","course_provider_link_id":"f7c3aa26-866c-46ef-a227-29f2f734764b","tee_provider_link_id":"687a55b5-ea9f-4cb9-8caa-7c4b39bd6475","provider_tee_set_id":"106088","verified_at":"2026-10-06T23:05:38.489Z","snapshot_attributes":{"holes":18,"par":72,"rating":68.4,"slope":121,"yards":6038,"rating_gender":"MEN"},"evidence":{"course_id":"23233","tee_id":"106088","local_geometry_hash":"8cab876b3ccc00303808c798eca5c37129dfbf5bfcbc9193684d2ac7b1584646","provider_geometry_hash":"8cab876b3ccc00303808c798eca5c37129dfbf5bfcbc9193684d2ac7b1584646","stroke_allocation_differs":true,"score_posting_tee_observed":true,"posting_entitlement_observed_at":"2026-10-06T23:04:47.443Z"}}';
begin
  perform 1 from public.golf_courses where id in ('course-la-vista','course-la-vista-club-current') order by id for update;
  perform 1 from public.golf_course_tees where id in ('tee-la-vista-doradas','tee-la-vista-club-current-gold') order by id for update;
  if not exists (select 1 from public.golf_courses where id='course-la-vista-club-current' and club_id='club-la-vista' and origin='BACKYARD_ADMIN' and not is_provisional and holes=18 and total_par=72 and catalog_metadata->>'dataVersion'='la-vista-club-current-2026-09-28')
     or not exists (select 1 from public.golf_courses where id='course-la-vista' and club_id='club-la-vista' and provider_external_id='23233' and holes=18 and total_par=72)
     or not exists (select 1 from public.golf_course_provider_links where id='f7c3aa26-866c-46ef-a227-29f2f734764b' and course_id='course-la-vista' and provider='GHIN' and external_course_id='23233' and external_facility_id='19886' and sync_status='CONFIRMED')
     or not exists (select 1 from public.golf_tee_provider_links where id='687a55b5-ea9f-4cb9-8caa-7c4b39bd6475' and tee_id='tee-la-vista-doradas' and course_id='course-la-vista' and external_tee_set_id='106088' and sync_status='CONFIRMED')
     or not exists (select 1 from public.golf_course_tees where id='tee-la-vista-doradas' and course_id='course-la-vista' and gender='MEN' and par=72 and rating=68.4 and slope=121 and total_yards=6038)
  then raise exception 'GHIN_ALIAS_BASELINE_MISMATCH'; end if;
  select jsonb_agg(jsonb_build_array((h->>'hole_number')::int,(h->>'par')::int,(h->>'yards')::int) order by (h->>'hole_number')::int)
    into source_geometry from public.golf_course_tees t cross join lateral jsonb_array_elements(t.catalog_metadata->'holes') h where t.id='tee-la-vista-club-current-gold' and t.course_id='course-la-vista-club-current';
  select jsonb_agg(jsonb_build_array((h->>'hole_number')::int,(h->>'par')::int,(h->>'yards')::int) order by (h->>'hole_number')::int)
    into provider_geometry from public.golf_course_tees t cross join lateral jsonb_array_elements(t.catalog_metadata->'holes') h where t.id='tee-la-vista-doradas';
  if source_geometry is null or jsonb_array_length(source_geometry)<>18 or source_geometry is distinct from provider_geometry
    then raise exception 'GHIN_ALIAS_GEOMETRY_MISMATCH'; end if;
  if exists (select 1 from public.golf_courses where id='course-la-vista-club-current' and catalog_metadata ? 'ghin_provider_alias_v1' and catalog_metadata->'ghin_provider_alias_v1' is distinct from course_alias)
    or exists (select 1 from public.golf_course_tees where id='tee-la-vista-club-current-gold' and catalog_metadata ? 'ghin_provider_alias_v1' and catalog_metadata->'ghin_provider_alias_v1' is distinct from tee_alias)
    then raise exception 'GHIN_ALIAS_EXISTING_EVIDENCE_CONFLICT'; end if;
  update public.golf_courses set catalog_metadata=jsonb_set(catalog_metadata,'{ghin_provider_alias_v1}',course_alias)
    where id='course-la-vista-club-current' and catalog_metadata->'ghin_provider_alias_v1' is distinct from course_alias;
  update public.golf_course_tees set catalog_metadata=jsonb_set(catalog_metadata,'{ghin_provider_alias_v1}',tee_alias)
    where id='tee-la-vista-club-current-gold' and course_id='course-la-vista-club-current' and catalog_metadata->'ghin_provider_alias_v1' is distinct from tee_alias;
end $$;
commit;
select 'course' as kind,id,catalog_metadata->'ghin_provider_alias_v1' as alias from public.golf_courses where id='course-la-vista-club-current'
union all
select 'tee',id,catalog_metadata->'ghin_provider_alias_v1' from public.golf_course_tees where id='tee-la-vista-club-current-gold';
