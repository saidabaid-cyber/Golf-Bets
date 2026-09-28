-- Distinguish licensed/verified provider data from legacy research evidence.
begin;

alter table public.course_scorecard_profiles
  drop constraint course_scorecard_profiles_provenance_check,
  add constraint course_scorecard_profiles_provenance_check check (provenance in (
    'GHIN_OFFICIAL','USGA_OFFICIAL','CLUB_SCORECARD_VERIFIED','CLUB_OPERATIONAL',
    'CLUB_TEMPORARY','TOURNAMENT','ADMIN_VERIFIED','PROVIDER_REVIEWED','PROVIDER_VERIFIED'
  ));

update public.course_scorecard_profiles profile
set provenance = 'PROVIDER_REVIEWED'
from public.golf_courses course
where profile.course_id = course.id
  and profile.id = 'scorecard-' || md5(course.id || ':' || course.provider || ':baseline')
  and course.provider not in ('GHIN','USGA_NCRDB','CLUB_OFFICIAL','CLUB_SCORECARD','BACKYARD_INTERNAL')
  and not course.is_provisional
  and course.layout_type <> 'TEMPORARY'
  and profile.provenance = 'PROVIDER_VERIFIED';

commit;
