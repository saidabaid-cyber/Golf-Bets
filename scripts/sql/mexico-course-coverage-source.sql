-- Read-only QA export for docs/course-data/MEXICO_COURSE_COVERAGE.csv.
-- Run only against Supabase QA bymeopxkxapfizeeqeyb. This query intentionally
-- redacts Rating/Slope from OWNER_CATALOG_REVIEW while rights remain unresolved.
with hole_counts as (
  select course_id, count(*) filter (where active = true)::int as hole_count
  from public.golf_holes
  group by course_id
), yardage_counts as (
  select tee_id, count(*) filter (where yards is not null or meters is not null)::int as yardage_count
  from public.golf_tee_hole_yardages
  group by tee_id
)
select
  club.id as facility_id,
  club.name as facility,
  course.name as course,
  club.city,
  club.state_region as state,
  coalesce(nullif(course.catalog_metadata->>'layout_name', ''), course.name) as layout,
  tee.name as tee,
  tee.gender,
  coalesce(tee.par, course.total_par) as par,
  case when source.rating_reuse_authorized
      or (course.provider = 'GHIN' and course.origin = 'GHIN' and lower(coalesce(course.provider_status, '')) = 'active')
      or (course.provider = 'BACKYARD_INTERNAL' and course.origin = 'BACKYARD_PROVISIONAL')
    then tee.rating end as rating,
  case when source.rating_reuse_authorized
      or (course.provider = 'GHIN' and course.origin = 'GHIN' and lower(coalesce(course.provider_status, '')) = 'active')
      or (course.provider = 'BACKYARD_INTERNAL' and course.origin = 'BACKYARD_PROVISIONAL')
    then tee.slope end as slope,
  case when tee.total_yards is not null then tee.total_yards::text || ' yd'
       when tee.total_meters is not null then tee.total_meters::text || ' m'
       else null end as length,
  coalesce(holes.hole_count, 0) = course.holes
    and coalesce(yardages.yardage_count, 0) = course.holes as hole_by_hole_available,
  club.latitude is not null and club.longitude is not null as coordinates_available,
  course.provider as source,
  course.origin,
  club.provider_external_id as source_facility_id,
  course.provider_external_id as source_course_id,
  tee.provider_external_id as source_tee_id,
  case when source.rating_reuse_authorized then 'AUTHORIZED_FIRST_PARTY'
       when course.provider = 'GHIN' and course.origin = 'GHIN' and lower(coalesce(course.provider_status, '')) = 'active' then 'QA_CONFIRMED_GHIN'
       when course.provider = 'BACKYARD_INTERNAL' and course.origin = 'BACKYARD_PROVISIONAL' then 'AUTHORIZED_FIRST_PARTY_PROVISIONAL'
       else coalesce(source.authorization_status, 'UNREGISTERED') end as rating_rights,
  coalesce(tee.source_url, course.source_url, club.source_url) as source_url,
  coalesce(tee.verified_at, course.verified_at, club.verified_at)::text as verified_at,
  not (
    source.rating_reuse_authorized
    or (course.provider = 'GHIN' and course.origin = 'GHIN' and lower(coalesce(course.provider_status, '')) = 'active')
    or (course.provider = 'BACKYARD_INTERNAL' and course.origin = 'BACKYARD_PROVISIONAL')
  ) as needs_verification
from public.golf_clubs club
join public.golf_courses course on course.club_id = club.id and course.active = true
left join public.golf_course_tees tee on tee.course_id = course.id and tee.active = true
left join public.golf_course_data_sources source on source.provider = course.provider
left join hole_counts holes on holes.course_id = course.id
left join yardage_counts yardages on yardages.tee_id = tee.id
where club.active = true
  and club.id <> 'qa-club-admin-3ed5723'
  and (
    upper(trim(coalesce(club.country, ''))) in ('MX', 'MEXICO', 'MÉXICO')
    or club.id = 'club-la-vista'
  )
order by club.name, course.name, tee.name, tee.id;
