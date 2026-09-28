-- Correct legacy origin metadata without deleting any scorecard data.
-- `origin = GHIN` was historically used during research and is not proof that
-- the canonical provider/mapping is GHIN. Only provider = GHIN is official.
begin;

update public.course_scorecard_profiles profile
set
  name = case
    when course.provider = 'GHIN' then 'GHIN / Oficial'
    when course.is_provisional or course.layout_type = 'TEMPORARY' then 'Temporal / Reparación'
    when course.provider in ('CLUB_OFFICIAL','CLUB_SCORECARD') then 'Tarjeta del club — Actual'
    else 'Tarjeta disponible'
  end,
  provenance = case
    when course.provider = 'GHIN' then 'GHIN_OFFICIAL'
    when course.provider = 'USGA_NCRDB' then 'USGA_OFFICIAL'
    when course.is_provisional or course.layout_type = 'TEMPORARY' then 'CLUB_TEMPORARY'
    when course.provider in ('CLUB_OFFICIAL','CLUB_SCORECARD') then 'CLUB_SCORECARD_VERIFIED'
    when course.provider = 'BACKYARD_INTERNAL' then 'ADMIN_VERIFIED'
    else 'PROVIDER_REVIEWED'
  end,
  source_external_id = case
    when course.provider = 'GHIN' then coalesce(course.provider_external_id, course.id)
    else coalesce(course.provider_external_id, course.id) || ':baseline'
  end
from public.golf_courses course
where profile.course_id = course.id
  and profile.id = 'scorecard-' || md5(course.id || ':' || course.provider || ':baseline')
  and (
    profile.name is distinct from case
      when course.provider = 'GHIN' then 'GHIN / Oficial'
      when course.is_provisional or course.layout_type = 'TEMPORARY' then 'Temporal / Reparación'
      when course.provider in ('CLUB_OFFICIAL','CLUB_SCORECARD') then 'Tarjeta del club — Actual'
      else 'Tarjeta disponible'
    end
    or profile.provenance is distinct from case
      when course.provider = 'GHIN' then 'GHIN_OFFICIAL'
      when course.provider = 'USGA_NCRDB' then 'USGA_OFFICIAL'
      when course.is_provisional or course.layout_type = 'TEMPORARY' then 'CLUB_TEMPORARY'
      when course.provider in ('CLUB_OFFICIAL','CLUB_SCORECARD') then 'CLUB_SCORECARD_VERIFIED'
      when course.provider = 'BACKYARD_INTERNAL' then 'ADMIN_VERIFIED'
      else 'PROVIDER_REVIEWED'
    end
    or profile.source_external_id is distinct from case
      when course.provider = 'GHIN' then coalesce(course.provider_external_id, course.id)
      else coalesce(course.provider_external_id, course.id) || ':baseline'
    end
  );

drop policy if exists course_scorecard_profiles_read on public.course_scorecard_profiles;
create policy course_scorecard_profiles_read on public.course_scorecard_profiles for select to authenticated using (
  (active and not historical and status = 'PUBLISHED' and (effective_from is null or effective_from <= now()) and (effective_to is null or effective_to > now())
    and exists (
      select 1 from public.golf_courses course
      left join public.golf_course_data_sources source on source.provider = course.provider
      where course.id = course_scorecard_profiles.course_id and course.active and (
        course_scorecard_profiles.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
        or (course_scorecard_profiles.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
        or source.rating_reuse_authorized = true
      )
    ))
  or private.admin_has_scope_v1('COURSE_CONFIGURATION','COURSE',course_id,'READ')
);

create or replace function public.read_backyard_scorecard_profiles_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.account_subject_active(auth.uid()) then raise exception 'authentication required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'profiles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', profile.id, 'course_id', profile.course_id, 'name', profile.name,
        'provenance', profile.provenance, 'source_provider', profile.source_provider,
        'source_external_id', profile.source_external_id, 'verified_at', profile.verified_at,
        'effective_from', profile.effective_from, 'effective_to', profile.effective_to,
        'active', profile.active, 'historical', profile.historical,
        'default_for_play', profile.default_for_play, 'status', profile.status
      ) order by profile.course_id, profile.default_for_play desc, profile.name, profile.id)
      from public.course_scorecard_profiles profile join public.golf_courses course on course.id = profile.course_id
      left join public.golf_course_data_sources source on source.provider = course.provider
      where course.active and profile.active and not profile.historical and profile.status = 'PUBLISHED'
        and (profile.effective_from is null or profile.effective_from <= now()) and (profile.effective_to is null or profile.effective_to > now())
        and (profile.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
          or (profile.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
          or source.rating_reuse_authorized = true)), '[]'::jsonb),
    'tees', coalesce((select jsonb_agg(jsonb_build_object(
        'profile_id', profile_tee.profile_id, 'tee_id', profile_tee.tee_id,
        'rating_gender', profile_tee.rating_gender, 'par', profile_tee.par,
        'course_rating', profile_tee.course_rating, 'bogey_rating', profile_tee.bogey_rating,
        'slope_rating', profile_tee.slope_rating, 'front_nine_rating', profile_tee.front_nine_rating,
        'front_nine_slope', profile_tee.front_nine_slope, 'back_nine_rating', profile_tee.back_nine_rating,
        'back_nine_slope', profile_tee.back_nine_slope, 'total_yards', profile_tee.total_yards,
        'total_meters', profile_tee.total_meters, 'source_external_id', profile_tee.source_external_id,
        'provider_status', profile_tee.provider_status, 'active', profile_tee.active
      ) order by profile_tee.profile_id, profile_tee.tee_id, profile_tee.rating_gender)
      from public.course_scorecard_profile_tees profile_tee join public.course_scorecard_profiles profile on profile.id = profile_tee.profile_id
      join public.golf_courses course on course.id = profile.course_id
      left join public.golf_course_data_sources source on source.provider = course.provider
      where profile.active and not profile.historical and profile.status = 'PUBLISHED' and profile_tee.active
        and course.active and (profile.effective_from is null or profile.effective_from <= now()) and (profile.effective_to is null or profile.effective_to > now())
        and (profile.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
          or (profile.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
          or source.rating_reuse_authorized = true)), '[]'::jsonb),
    'holes', coalesce((select jsonb_agg(jsonb_build_object(
        'profile_id', profile_hole.profile_id, 'hole_id', profile_hole.hole_id,
        'rating_gender', profile_hole.rating_gender, 'hole_number', profile_hole.hole_number,
        'stroke_index', profile_hole.stroke_index
      ) order by profile_hole.profile_id, profile_hole.rating_gender, profile_hole.hole_number)
      from public.course_scorecard_profile_holes profile_hole join public.course_scorecard_profiles profile on profile.id = profile_hole.profile_id
      join public.golf_courses course on course.id = profile.course_id
      left join public.golf_course_data_sources source on source.provider = course.provider
      where profile.active and not profile.historical and profile.status = 'PUBLISHED'
        and course.active and (profile.effective_from is null or profile.effective_from <= now()) and (profile.effective_to is null or profile.effective_to > now())
        and (profile.provenance in ('CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL','CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED')
          or (profile.provenance = 'GHIN_OFFICIAL' and course.provider = 'GHIN')
          or source.rating_reuse_authorized = true)), '[]'::jsonb)
  );
end;
$$;

commit;
