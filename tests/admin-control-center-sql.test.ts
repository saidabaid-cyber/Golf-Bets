import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "supabase/migrations/20260922132057_admin_control_center_v1.sql"), "utf8");
const workflows = readFileSync(join(process.cwd(), "supabase/migrations/20260922132140_admin_publication_workflows_v1.sql"), "utf8");
const runtime = readFileSync(join(process.cwd(), "supabase/migrations/20260922140635_admin_temporary_hole_runtime.sql"), "utf8");
const scheduling = readFileSync(join(process.cwd(), "supabase/migrations/20260922143348_admin_scheduled_publications.sql"), "utf8");
const privacy = readFileSync(join(process.cwd(), "supabase/migrations/20260922143611_admin_revision_privacy.sql"), "utf8");
const publishGuard = readFileSync(join(process.cwd(), "supabase/migrations/20260922143732_admin_publish_guard_reset.sql"), "utf8");
const configurationQualification = readFileSync(join(process.cwd(), "supabase/migrations/20260922143905_admin_configuration_publish_qualification.sql"), "utf8");
const advisorFollowup = readFileSync(join(process.cwd(), "supabase/migrations/20260922145015_admin_advisor_followup.sql"), "utf8");
const exportMigration = readFileSync(join(process.cwd(), "supabase/migrations/20260922150533_admin_export_expansion.sql"), "utf8");
const publicationValidation = readFileSync(join(process.cwd(), "supabase/migrations/20260922151308_admin_publish_payload_validation.sql"), "utf8");
const playerProjections = readFileSync(join(process.cwd(), "supabase/migrations/20260922163818_admin_player_safe_projections.sql"), "utf8");
const supabaseServer = readFileSync(join(process.cwd(), "lib/supabase/server.ts"), "utf8");

test("admin roles come from memberships and every admin table enables RLS", () => {
  assert.match(schema, /create table public\.admin_memberships/);
  assert.match(schema, /references auth\.users\(id\)/);
  assert.doesNotMatch(schema, /user_metadata|raw_user_meta_data/);
  for (const table of ["admin_catalog_revisions", "course_configurations", "course_local_rule_sets", "competition_definitions", "admin_import_jobs", "admin_audit_log"]) {
    assert.match(schema, new RegExp(`'${table}'`));
  }
  assert.match(schema, /alter table public\.%I enable row level security/);
});

test("canonical seed catalogs have no new authenticated write grant", () => {
  assert.doesNotMatch(schema, /grant insert,update on public\.golf_/);
  assert.doesNotMatch(schema, /create policy golf_.*admin_write/);
  assert.match(schema, /layered providers/);
});

test("publication requires verified evidence and a fresh preview hash", () => {
  assert.match(workflows, /prior\.status<>'VERIFIED'/);
  assert.match(workflows, /prior\.preview_hash is distinct from expected_preview_hash/);
  assert.match(workflows, /PUBLISH_RPC_REQUIRED/);
  assert.match(workflows, /PUBLISHED_REVISION_IMMUTABLE/);
});

test("privileged implementations stay in private schema behind invoker wrappers", () => {
  assert.match(workflows, /private\.admin_create_draft_from_request_impl_v1/);
  assert.match(workflows, /public\.admin_create_draft_from_request_v1[\s\S]*security invoker/);
  assert.match(workflows, /private\.admin_feedback_queue_impl_v1/);
  assert.match(workflows, /public\.admin_feedback_queue_v1[\s\S]*security invoker/);
  assert.doesNotMatch(workflows, /function public\.admin_(?:create_draft_from_request|feedback_queue)_v1[\s\S]{0,250}security definer/);
});

test("documents are private and executable formats are not accepted", () => {
  assert.match(schema, /admin-documents-private','admin-documents-private',false/);
  assert.match(schema, /application\/pdf/);
  assert.match(schema, /image\/webp/);
  assert.doesNotMatch(schema, /image\/svg\+xml|text\/html/);
});

test("audit remains append-only for authenticated clients", () => {
  assert.match(schema, /grant select on public\.admin_audit_log to authenticated/);
  assert.doesNotMatch(schema, /grant (?:insert|update|delete)[^;]*admin_audit_log[^;]*authenticated/);
});

test("closed holes do not consume engine numbers and import confirmation creates Drafts only", () => {
  assert.match(runtime, /runtime_hole_number drop not null/);
  assert.match(runtime, /not playable or runtime_hole_number is not null/);
  assert.match(runtime, /status='CONFIRMED'/);
  assert.match(runtime, /status in \('NEW','UPDATE'\)/);
  assert.doesNotMatch(runtime, /admin_publish_revision_v1\(/);
});

test("temporary and catalog publication require fresh previews and reject overlap", () => {
  assert.match(scheduling, /admin_prepare_course_configuration_v1/);
  assert.match(scheduling, /admin_publish_course_configuration_v2/);
  assert.match(scheduling, /candidate\.revision_hash is distinct from expected_preview_hash/);
  assert.match(scheduling, /PUBLICATION_OVERLAP/);
  assert.match(scheduling, /revoke all on function public\.admin_publish_course_configuration_v1/);
});

test("canonical competition projections stay admin-only", () => {
  assert.match(scheduling, /Canonical competition projections cannot represent two scheduled versions/);
  assert.match(scheduling, /create policy competition_read[\s\S]*admin_has_scope_v1/);
  assert.doesNotMatch(scheduling, /competition\.visibility='PUBLIC'/);
});

test("draft revision ledger is admin-only and player APIs must filter publications", () => {
  assert.match(privacy, /using\(private\.admin_has_scope_v1/);
  assert.doesNotMatch(privacy, /status='PUBLISHED' or/);
  assert.match(privacy, /Player APIs expose only effective published projections/);
});

test("publication marker is reset on success and exception", () => {
  assert.match(publishGuard, /set_config\('backyard\.admin_publish','off',true\)/);
  assert.match(publishGuard, /exception when others then[\s\S]*set_config\('backyard\.admin_publish','off',true\)/);
});

test("configuration publisher qualifies child foreign keys", () => {
  assert.match(configurationQualification, /hole\.configuration_id=candidate\.id/);
  assert.doesNotMatch(configurationQualification, /where configuration_id=configuration_id/);
});

test("advisor follow-up keeps a single combined configuration read policy", () => {
  assert.match(advisorFollowup, /drop policy if exists course_configuration_admin_read/);
  assert.match(advisorFollowup, /drop policy if exists course_configuration_player_read/);
  assert.match(advisorFollowup, /create policy course_configuration_read/);
  assert.match(advisorFollowup, /golf_shaft_catalog_publication_revision_idx/);
});

test("exports omit actors and include configuration children", () => {
  assert.match(exportMigration, /'teeHoles'/);
  assert.match(exportMigration, /'ratings'/);
  assert.match(exportMigration, /to_jsonb\(configuration\)-'created_by'-'published_by'/);
});

test("database validates payload again before publication", () => {
  assert.match(publicationValidation, /admin_validate_revision_payload_v1/);
  assert.match(publicationValidation, /new\.status='PUBLISHED' then perform private\.admin_validate_revision_payload_v1\(new\)/);
  assert.match(publicationValidation, /INVALID_SHAFT_PAYLOAD/);
  assert.match(publicationValidation, /LOCAL_RULE_SET/);
});

test("Preview database clients fail closed unless bound to the isolated QA ref", () => {
  assert.match(supabaseServer, /VERCEL_ENV !== "preview" \|\| isolatedPreviewDatabaseEnabled\(\)/);
  assert.match(supabaseServer, /getSupabasePublic/);
});

test("player projections expose only reviewed runtime fields", () => {
  assert.match(playerProjections, /player_published_catalog_v1/);
  assert.match(playerProjections, /revision\.status in \('PUBLISHED','SUPERSEDED','ARCHIVED'\)/);
  assert.match(playerProjections, /requested = any\(array\['COURSE','CLUB_EQUIPMENT','BALL','SHAFT'\]/);
  assert.match(playerProjections, /player_course_operations_v1/);
  assert.match(playerProjections, /document\.rights_status = 'APPROVED'/);
  assert.match(playerProjections, /revision\.payload->>'visibility' = 'PUBLIC'/);
  assert.match(playerProjections, /player_competition_rules_v1/);
  assert.doesNotMatch(playerProjections, /internal_notes|created_by|published_by|admin_audit_log/);
});
