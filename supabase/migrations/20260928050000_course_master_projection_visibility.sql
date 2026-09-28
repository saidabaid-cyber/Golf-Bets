-- The underlying reviewed/provider course rows are intentionally PRIVATE to
-- prevent direct table reads. Player visibility is provided by the narrow,
-- authenticated Course Master projection. Do not reinterpret table visibility
-- as publication state or the catalog collapses to the single public seed.
begin;

create or replace function public.read_backyard_course_master_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not private.account_subject_active(auth.uid()) then
    raise exception 'account unavailable' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'clubs', coalesce((
      select jsonb_agg(to_jsonb(club_row) order by club_row.id)
      from (
        select
          club.id, club.name, club.country, club.state_region, club.city,
          club.address, club.latitude, club.longitude, club.timezone,
          club.source_url, club.verified_at,
          club.catalog_metadata || jsonb_build_object(
            'provider', club.provider,
            'provider_external_id', club.provider_external_id,
            'origin', club.origin,
            'provider_status', club.provider_status,
            'last_synced_at', club.last_synced_at
          ) as catalog_metadata
        from public.golf_clubs club
        where club.active = true
          and exists (
            select 1
            from public.golf_courses course
            left join public.golf_course_data_sources source on source.provider = course.provider
            where course.club_id = club.id
              and course.active = true
              and (
                course.provider = 'OWNER_CATALOG_REVIEW'
                or course.origin in ('GHIN','BACKYARD_PROVISIONAL')
                or source.authorized_for_display = true
              )
          )
      ) club_row
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(to_jsonb(course_row) order by course_row.id)
      from (
        select
          course.id, course.club_id, course.name, course.holes,
          course.source_url, course.verified_at,
          course.catalog_metadata || jsonb_build_object(
            'provider', course.provider,
            'course_id', course.provider_external_id,
            'origin', course.origin,
            'is_provisional', course.is_provisional,
            'layout_type', course.layout_type,
            'operational_status', course.provider_status,
            'total_par', course.total_par,
            'last_synced_at', course.last_synced_at,
            'rating_reuse_status', case
              when source.rating_reuse_authorized then 'AUTHORIZED'
              else coalesce(course.catalog_metadata->>'rating_reuse_status', 'LEGAL_REVIEW_REQUIRED')
            end
          ) as catalog_metadata
        from public.golf_courses course
        left join public.golf_course_data_sources source on source.provider = course.provider
        where course.active = true
          and (
            course.provider = 'OWNER_CATALOG_REVIEW'
            or course.origin in ('GHIN','BACKYARD_PROVISIONAL')
            or source.authorized_for_display = true
          )
      ) course_row
    ), '[]'::jsonb),
    'tees', coalesce((
      select jsonb_agg(to_jsonb(tee_row) order by tee_row.id)
      from (
        select
          tee.id, tee.course_id,
          tee.catalog_metadata || jsonb_build_object(
            'provider', tee.provider,
            'provider_tee_set_rating_id', tee.provider_external_id,
            'provider_status', tee.provider_status,
            'displayName', coalesce(tee.display_name, tee.name),
            'name', tee.name,
            'gender', tee.gender,
            'course_rating', tee.rating,
            'slope_rating', tee.slope,
            'bogey_rating', tee.bogey_rating,
            'yards', tee.total_yards,
            'meters', tee.total_meters,
            'par', tee.par,
            'front_course_rating', tee.front_nine_rating,
            'front_slope_rating', tee.front_nine_slope,
            'back_course_rating', tee.back_nine_rating,
            'back_slope_rating', tee.back_nine_slope,
            'last_synced_at', tee.last_synced_at
          ) as catalog_metadata
        from public.golf_course_tees tee
        join public.golf_courses course on course.id = tee.course_id
        left join public.golf_course_data_sources source on source.provider = course.provider
        where tee.active = true
          and course.active = true
          and (
            course.provider = 'OWNER_CATALOG_REVIEW'
            or course.origin in ('GHIN','BACKYARD_PROVISIONAL')
            or source.authorized_for_display = true
          )
      ) tee_row
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_backyard_course_master_v1() from public, anon;
grant execute on function public.read_backyard_course_master_v1() to authenticated, service_role;

comment on function public.read_backyard_course_master_v1() is
  'Authenticated, read-only Course Master projection. PRIVATE source tables remain private; provider authorization controls projection membership.';

commit;
