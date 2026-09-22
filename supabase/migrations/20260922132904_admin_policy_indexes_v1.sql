-- Advisor follow-up for Admin Control Center v1. Additive indexes and
-- operation-specific policies avoid broad FOR ALL policies on write surfaces.
begin;

create index if not exists admin_memberships_created_by_idx on public.admin_memberships(created_by) where created_by is not null;
create index if not exists admin_catalog_revisions_created_by_idx on public.admin_catalog_revisions(created_by);
create index if not exists admin_catalog_revisions_reviewed_by_idx on public.admin_catalog_revisions(reviewed_by) where reviewed_by is not null;
create index if not exists admin_catalog_revisions_verified_by_idx on public.admin_catalog_revisions(verified_by) where verified_by is not null;
create index if not exists admin_catalog_revisions_published_by_idx on public.admin_catalog_revisions(published_by) where published_by is not null;
create index if not exists admin_catalog_revisions_supersedes_idx on public.admin_catalog_revisions(supersedes_revision_id) where supersedes_revision_id is not null;
create index if not exists course_configurations_created_by_idx on public.course_configurations(created_by);
create index if not exists course_configurations_published_by_idx on public.course_configurations(published_by) where published_by is not null;
create index if not exists course_configurations_source_document_idx on public.course_configurations(source_document_id) where source_document_id is not null;
create index if not exists course_configurations_supersedes_idx on public.course_configurations(supersedes_configuration_id) where supersedes_configuration_id is not null;
create index if not exists course_local_rules_rule_set_idx on public.course_local_rules(rule_set_id);
create index if not exists admin_documents_created_by_idx on public.admin_documents(created_by);
create index if not exists equipment_catalog_images_document_idx on public.equipment_catalog_images(document_id);
create index if not exists competition_definitions_legacy_idx on public.competition_definitions(legacy_tournament_id) where legacy_tournament_id is not null;
create index if not exists competition_definitions_created_by_idx on public.competition_definitions(created_by);
create index if not exists competition_definitions_published_by_idx on public.competition_definitions(published_by) where published_by is not null;
create index if not exists competition_rule_sets_created_by_idx on public.competition_rule_sets(created_by);
create index if not exists competition_rule_sets_published_by_idx on public.competition_rule_sets(published_by) where published_by is not null;
create index if not exists competition_rules_rule_set_idx on public.competition_rules(rule_set_id);
create index if not exists admin_import_jobs_source_document_idx on public.admin_import_jobs(source_document_id) where source_document_id is not null;
create index if not exists admin_import_jobs_created_by_idx on public.admin_import_jobs(created_by);
create index if not exists admin_import_jobs_confirmed_by_idx on public.admin_import_jobs(confirmed_by) where confirmed_by is not null;
create index if not exists admin_request_drafts_revision_idx on public.admin_request_drafts(revision_id) where revision_id is not null;
create index if not exists admin_request_drafts_created_by_idx on public.admin_request_drafts(created_by);
create index if not exists round_course_snapshots_competition_idx on public.round_course_snapshots(competition_id) where competition_id is not null;
create index if not exists round_course_snapshots_rule_set_idx on public.round_course_snapshots(competition_rule_set_id) where competition_rule_set_id is not null;

drop policy if exists course_configuration_holes_admin_write on public.course_configuration_holes;
create policy course_configuration_holes_admin_insert on public.course_configuration_holes for insert to authenticated
with check(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));
create policy course_configuration_holes_admin_update on public.course_configuration_holes for update to authenticated
using(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'READ')))
with check(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));

drop policy if exists course_configuration_tee_holes_admin_write on public.course_configuration_tee_holes;
create policy course_configuration_tee_holes_admin_insert on public.course_configuration_tee_holes for insert to authenticated
with check(exists(select 1 from public.course_configuration_holes h join public.course_configurations c on c.id=h.configuration_id where h.id=configuration_hole_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));
create policy course_configuration_tee_holes_admin_update on public.course_configuration_tee_holes for update to authenticated
using(exists(select 1 from public.course_configuration_holes h join public.course_configurations c on c.id=h.configuration_id where h.id=configuration_hole_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'READ')))
with check(exists(select 1 from public.course_configuration_holes h join public.course_configurations c on c.id=h.configuration_id where h.id=configuration_hole_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));

drop policy if exists course_configuration_ratings_admin_write on public.course_configuration_ratings;
create policy course_configuration_ratings_admin_insert on public.course_configuration_ratings for insert to authenticated
with check(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));
create policy course_configuration_ratings_admin_update on public.course_configuration_ratings for update to authenticated
using(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'READ')))
with check(exists(select 1 from public.course_configurations c where c.id=configuration_id and private.admin_has_scope_v1('COURSE_CONFIGURATION',c.scope_type,case when c.scope_type='COURSE' then c.course_id else c.competition_id::text end,'CREATE_DRAFT')));

drop policy if exists admin_documents_write on public.admin_documents;
create policy admin_documents_insert on public.admin_documents for insert to authenticated
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1(owner_entity_type,scope_type,scope_id,'CREATE_DRAFT'));
create policy admin_documents_update on public.admin_documents for update to authenticated
using(private.admin_has_scope_v1(owner_entity_type,scope_type,scope_id,'READ'))
with check(private.admin_has_scope_v1(owner_entity_type,scope_type,scope_id,'CREATE_DRAFT'));

drop policy if exists equipment_images_write on public.equipment_catalog_images;
create policy equipment_images_insert on public.equipment_catalog_images for insert to authenticated
with check(private.admin_has_scope_v1('EQUIPMENT_IMAGE','CATALOG','equipment','CREATE_DRAFT'));
create policy equipment_images_update on public.equipment_catalog_images for update to authenticated
using(private.admin_has_scope_v1('EQUIPMENT_IMAGE','CATALOG','equipment','READ'))
with check(private.admin_has_scope_v1('EQUIPMENT_IMAGE','CATALOG','equipment','CREATE_DRAFT'));

drop policy if exists import_jobs_scope on public.admin_import_jobs;
create policy import_jobs_read on public.admin_import_jobs for select to authenticated
using(private.admin_has_scope_v1('IMPORT',scope_type,scope_id,'READ'));
create policy import_jobs_insert on public.admin_import_jobs for insert to authenticated
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1('IMPORT',scope_type,scope_id,'CREATE_DRAFT'));
create policy import_jobs_update on public.admin_import_jobs for update to authenticated
using(private.admin_has_scope_v1('IMPORT',scope_type,scope_id,'READ'))
with check(private.admin_has_scope_v1('IMPORT',scope_type,scope_id,'CREATE_DRAFT'));

drop policy if exists import_rows_scope on public.admin_import_rows;
create policy import_rows_read on public.admin_import_rows for select to authenticated
using(exists(select 1 from public.admin_import_jobs j where j.id=import_id and private.admin_has_scope_v1('IMPORT',j.scope_type,j.scope_id,'READ')));
create policy import_rows_insert on public.admin_import_rows for insert to authenticated
with check(exists(select 1 from public.admin_import_jobs j where j.id=import_id and private.admin_has_scope_v1('IMPORT',j.scope_type,j.scope_id,'CREATE_DRAFT')));
create policy import_rows_update on public.admin_import_rows for update to authenticated
using(exists(select 1 from public.admin_import_jobs j where j.id=import_id and private.admin_has_scope_v1('IMPORT',j.scope_type,j.scope_id,'READ')))
with check(exists(select 1 from public.admin_import_jobs j where j.id=import_id and private.admin_has_scope_v1('IMPORT',j.scope_type,j.scope_id,'CREATE_DRAFT')));

drop policy if exists request_drafts_scope on public.admin_request_drafts;
create policy request_drafts_read on public.admin_request_drafts for select to authenticated
using(private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ'));
create policy request_drafts_insert on public.admin_request_drafts for insert to authenticated
with check(created_by=(select auth.uid()) and private.admin_has_scope_v1('REQUEST','GLOBAL',null,'CREATE_DRAFT'));
create policy request_drafts_update on public.admin_request_drafts for update to authenticated
using(private.admin_has_scope_v1('REQUEST','GLOBAL',null,'READ'))
with check(private.admin_has_scope_v1('REQUEST','GLOBAL',null,'CREATE_DRAFT'));

-- These rows are projections of published revision records, so authenticated
-- users get read access only; the private projector owns all writes.
drop policy if exists local_rule_set_write on public.course_local_rule_sets;
drop policy if exists local_rule_write on public.course_local_rules;
drop policy if exists competition_write on public.competition_definitions;
drop policy if exists competition_rule_set_write on public.competition_rule_sets;
drop policy if exists competition_rule_write on public.competition_rules;

commit;
