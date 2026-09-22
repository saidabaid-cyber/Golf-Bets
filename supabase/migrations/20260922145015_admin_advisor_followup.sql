-- Admin Control Center v1 advisor follow-up. Additive only.
-- Keep one SELECT policy on course configurations so player publication reads
-- and scoped Admin reads do not create duplicate permissive-policy evaluation.
begin;

create index if not exists course_local_rule_sets_created_by_idx
  on public.course_local_rule_sets(created_by);
create index if not exists course_local_rule_sets_published_by_idx
  on public.course_local_rule_sets(published_by) where published_by is not null;
create index if not exists golf_ball_catalog_publication_revision_idx
  on public.golf_ball_catalog(publication_revision_id) where publication_revision_id is not null;
create index if not exists golf_club_catalog_publication_revision_idx
  on public.golf_club_catalog(publication_revision_id) where publication_revision_id is not null;
create index if not exists golf_shaft_catalog_publication_revision_idx
  on public.golf_shaft_catalog(publication_revision_id) where publication_revision_id is not null;

drop policy if exists course_configuration_admin_read on public.course_configurations;
drop policy if exists course_configuration_player_read on public.course_configurations;
drop policy if exists course_configuration_read on public.course_configurations;
create policy course_configuration_read on public.course_configurations for select to authenticated
using(
  (
    status in ('SCHEDULED','PUBLISHED')
    and (effective_from is null or effective_from<=now())
    and (effective_until is null or effective_until>now())
  )
  or private.admin_has_scope_v1(
    'COURSE_CONFIGURATION',
    scope_type,
    case when scope_type='COURSE' then course_id else competition_id::text end,
    'READ'
  )
);

commit;
