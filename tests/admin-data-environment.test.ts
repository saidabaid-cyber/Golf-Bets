import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  adminDataPage,
  adminEnvironmentCounts,
  adminPublicationDecision,
  analyzeAdminDataSeparation,
  canViewQaAdminData,
  classifyAdminData,
  isOperationalAdminData,
  visibleAdminData,
  withAdminDataEnvironment,
} from "../lib/admin-data-environment";
import { isPublicEquipmentCatalogItem } from "../lib/equipment-catalog-visibility";
import { golfBallCatalog } from "../lib/golf-equipment-catalog";
import { INTERNAL_GOLF_COURSE_CATALOG } from "../lib/golf-course-directory";
import { mergePublishedCatalog, resolveCatalogItem } from "../lib/layered-catalog";

const component = readFileSync(join(process.cwd(), "app/components/admin-control-center.tsx"), "utf8");
const route = readFileSync(join(process.cwd(), "app/api/admin/control-center/route.ts"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260924010936_admin_data_environment_separation.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase/migrations/20260922132057_admin_control_center_v1.sql"), "utf8");

const operationalRequest = { id: "request-owner", title: "Falta un tee", description: "El tee blanco no aparece.", data_environment: "PRODUCTION" };
const qaRequest = { id: "request-qa", title: "QA RECONCILIATION", description: "Solicitud sintética", data_environment: "QA" };

test("dashboard operational counts exclude QA records", () => {
  const rows = [operationalRequest, qaRequest, { id: "fixture-1", name: "Test fixture" }];
  assert.equal(rows.filter(isOperationalAdminData).length, 1);
  assert.deepEqual(adminEnvironmentCounts(rows), { PRODUCTION: 1, QA: 1, TEST: 1, SYNTHETIC: 0 });
  assert.match(route, /rows\.filter\(isOperationalAdminData\)\.length/);
});

test("explicit classification is consistent across list, detail, dashboard and publication", () => {
  const normalNamedQa = { id: "ordinary-name", name: "Club del Valle", data_environment: "QA" };
  const ambiguousProduction = { id: "real-review", name: "QA review completed for real source", data_environment: "PRODUCTION" };
  const values = [normalNamedQa, ambiguousProduction];

  assert.deepEqual(adminDataPage(values, false, 20).items.map((row) => row.id), ["real-review"]);
  assert.equal(withAdminDataEnvironment(normalNamedQa).data_environment, "QA");
  assert.deepEqual(adminEnvironmentCounts(values), { PRODUCTION: 1, QA: 1, TEST: 0, SYNTHETIC: 0 });
  assert.deepEqual(adminPublicationDecision(normalNamedQa), { allowed: false, environment: "QA", code: "QA_PUBLICATION_BLOCKED" });
  assert.deepEqual(adminPublicationDecision(ambiguousProduction), { allowed: true, environment: "PRODUCTION", code: null });
});

test("operational filtering happens before pagination and totals describe the filtered set", () => {
  const rows = [
    { id: "qa-first", data_environment: "QA" },
    { id: "real-1", data_environment: "PRODUCTION" },
    { id: "real-2", data_environment: "PRODUCTION" },
  ];
  const page = adminDataPage(rows, false, 1);
  assert.deepEqual(page.items.map((row) => row.id), ["real-1"]);
  assert.equal(page.total, 2);
});

test("quality checks distinguish isolated fixtures, operational exposure and unverified references", () => {
  const fixture = { id: "qa-ball", brand: "Normal looking brand", data_environment: "QA" };
  const production = { id: "real-ball", brand: "QA review completed", data_environment: "PRODUCTION" };
  const isolated = analyzeAdminDataSeparation({
    internalRows: [fixture],
    operationalProjectionRows: [production],
    historicalReferencesChecked: false,
  });
  assert.equal(isolated.isolatedInternalFixtures.value, 1);
  assert.equal(isolated.syntheticVisibleInOperational.value, 0);
  assert.equal(isolated.productionIdsPointingToFixtures.value, null);
  assert.equal(isolated.productionIdsPointingToFixtures.status, "NOT_VERIFIED");

  const exposed = analyzeAdminDataSeparation({
    internalRows: [fixture],
    operationalProjectionRows: [production, fixture],
    historicalReferencesChecked: true,
    historicalProductionRows: [{ id: "bag-1", equipmentId: "qa-ball", data_environment: "PRODUCTION" }],
  });
  assert.equal(exposed.syntheticVisibleInOperational.value, 1);
  assert.equal(exposed.productionIdsPointingToFixtures.value, 1);
  assert.equal(exposed.productionIdsPointingToFixtures.status, "VERIFIED");
  assert.match(component, /No verificado/);
});

test("data quality includes legacy Admin records instead of reporting a catalog-only zero", () => {
  assert.match(route, /adminRows = \[/);
  assert.match(route, /admin_catalog_revisions/);
  assert.match(route, /admin_import_jobs/);
  assert.match(route, /admin_feedback_queue_v1/);
  assert.match(route, /\.\.\.allShaftRows, \.\.\.adminRows/);
});

test("requests hide QA by default and expose it only when explicitly included", () => {
  assert.deepEqual(visibleAdminData([operationalRequest, qaRequest], false).map((row) => row.id), ["request-owner"]);
  assert.deepEqual(visibleAdminData([operationalRequest, qaRequest], true).map((row) => row.id), ["request-owner", "request-qa"]);
  assert.match(component, /Mostrar QA\/Test/);
});

test("legacy Spanish QA requests are classified from accented copy and reserved metadata", () => {
  const liveFixtures = [
    {
      id: "legacy-request-1",
      title: "Apuesta sintética QA — no implementar",
      description: "Solicitud sintética desde browser QA.",
    },
    {
      id: "legacy-request-2",
      title: "",
      description: "",
      payload: { replyEmail: "catalog-qa@example.invalid", description: "Registro QA de feedback sin enviar correo." },
    },
    {
      id: "legacy-request-3",
      title: "Solicitud controlada",
      source_screen: "qa-feedback-live",
    },
  ];
  assert.deepEqual(liveFixtures.map((row) => classifyAdminData(row).environment), ["SYNTHETIC", "QA", "QA"]);
  assert.deepEqual(visibleAdminData(liveFixtures, false), []);
});

test("known pre-v2 blank QA requests are isolated only by immutable fixture IDs", () => {
  const knownQa = { id: "5589dffb-416d-44cd-9d06-90b173bd1271", title: "", description: "" };
  const unknownBlank = { id: "request-user-blank", title: "", description: "" };
  assert.equal(classifyAdminData(knownQa).environment, "QA");
  assert.equal(classifyAdminData(unknownBlank).environment, "PRODUCTION");
  assert.match(migration, /reply_email,payload->>'description'/);
  assert.match(migration, /@example\\\.invalid/);
});

test("only active global SUPER_ADMIN memberships can show QA", () => {
  assert.equal(canViewQaAdminData([{ role: "SUPER_ADMIN", scope_type: "GLOBAL", active: true }]), true);
  assert.equal(canViewQaAdminData([{ role: "SUPER_ADMIN", scope_type: "COURSE", active: true }]), false);
  assert.equal(canViewQaAdminData([{ role: "COURSE_ADMIN", scope_type: "GLOBAL", active: true }]), false);
  assert.equal(canViewQaAdminData([{ role: "SUPER_ADMIN", scope_type: "GLOBAL", active: false }]), false);
  assert.match(route, /QA_DATA_FORBIDDEN/);
});

test("normal Admin roles cannot turn on the QA query flag", () => {
  assert.equal(canViewQaAdminData([{ role: "CATALOG_ADMIN", scope_type: "CATALOG", active: true }]), false);
  assert.match(route, /requested && !access\.canShowQa/);
  assert.match(route, /status[\s\S]*403|QA_DATA_FORBIDDEN/);
});

test("legacy course fixtures are excluded without classifying ordinary courses", () => {
  assert.deepEqual(classifyAdminData({ id: "qa-course-admin-3ed5723", name: "Synthetic QA Course" }), { environment: "SYNTHETIC", source: "LEGACY" });
  const laVista = INTERNAL_GOLF_COURSE_CATALOG.courses.find((course) => /vista/i.test(course.name));
  assert.ok(laVista);
  assert.equal(isOperationalAdminData(laVista), true);
});

test("Synthetic QA equipment is excluded from catalog, search, facets and selectors", () => {
  const real = golfBallCatalog[0];
  assert.ok(real);
  assert.equal(isPublicEquipmentCatalogItem(real), true);
  assert.equal(isPublicEquipmentCatalogItem({ ...real, id: "qa-test-ball", brand: "Synthetic QA", model: "Test Ball", dataEnvironment: "SYNTHETIC" }), false);
  assert.match(route, /includeQa \|\| isOperationalAdminData\(row\.item\)/);
  assert.match(route, /includeQa \|\| isOperationalAdminData\(\{ \.\.\.course, club \}\)/);
});

test("operational search and filter helpers omit QA records", () => {
  const values = [
    { id: "ball-real", brand: "Real", model: "One", dataEnvironment: "PRODUCTION" },
    { id: "ball-qa", brand: "Synthetic QA", model: "Fixture", dataEnvironment: "QA" },
  ];
  const visible = visibleAdminData(values, false);
  assert.deepEqual(visible.map((value) => value.id), ["ball-real"]);
  assert.equal(visible.filter((value) => `${value.brand} ${value.model}`.toLowerCase().includes("synthetic")).length, 0);
});

test("new Course and import forms never preload synthetic fixtures", () => {
  assert.doesNotMatch(component, /placeholder="synthetic-(?:club|course)"/);
  assert.match(component, /placeholder="club-estable"/);
  assert.match(component, /controlledImportTemplate\("COURSE", "CSV"\)/);
  assert.doesNotMatch(component, /synthetic-test,Synthetic,Test Model/);
});

test("import preview rejects fixture payloads before confirm", () => {
  assert.equal(classifyAdminData({ id: "import-real-id", admin_import_rows: [{ normalized_payload: { id: "synthetic-test", brand: "Synthetic" } }] }).environment, "SYNTHETIC");
  assert.match(route, /diff = diff\.map\(\(row\) => row\.value && !isOperationalAdminData\(row\.value\)/);
  assert.match(route, /Los registros QA\/Test no pueden entrar al catálogo operativo/);
  assert.match(route, /data_environment: importEnvironment/);
});

test("QA imports and publication are fail-closed in API and database", () => {
  assert.match(route, /QA_IMPORT_BLOCKED/);
  assert.match(route, /QA_PUBLICATION_BLOCKED/);
  assert.match(route, /Los registros QA\/Test no pueden entrar al catálogo operativo/);
  assert.match(migration, /admin_block_non_operational_publish_v1/);
  assert.match(migration, /revision\.data_environment='PRODUCTION'/);
});

test("QA requests remain evidence and cannot become operational drafts", () => {
  assert.match(route, /QA_REQUEST_DRAFT_BLOCKED/);
  assert.match(migration, /request_row\.data_environment<>'PRODUCTION'/);
});

test("legacy feedback queue is operational-only and v2 owns the SUPER_ADMIN QA switch", () => {
  const legacyQueue = migration.match(
    /create function private\.admin_feedback_queue_impl_v1[\s\S]*?revoke all on function private\.admin_feedback_queue_impl_v1/,
  )?.[0];
  const versionedQueue = migration.match(
    /create or replace function public\.admin_feedback_queue_page_v2[\s\S]*?revoke all on function public\.admin_feedback_queue_page_v2/,
  )?.[0];

  assert.ok(legacyQueue);
  assert.match(legacyQueue, /request\.data_environment='PRODUCTION'/);
  assert.doesNotMatch(legacyQueue, /include_non_operational/);

  assert.ok(versionedQueue);
  assert.match(versionedQueue, /include_non_operational/);
  assert.match(versionedQueue, /membership\.role='SUPER_ADMIN'/);
  assert.match(versionedQueue, /membership\.scope_type='GLOBAL'/);
  assert.match(versionedQueue, /membership\.active/);
});

test("classification migration is additive and keeps RLS/audit controls", () => {
  for (const table of ["admin_catalog_revisions", "admin_import_jobs", "course_configurations", "competition_definitions", "feedback_requests"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} add column if not exists data_environment`));
  }
  assert.doesNotMatch(migration, /drop table|truncate|delete from/i);
  assert.match(schema, /grant select on public\.admin_audit_log to authenticated/);
  assert.match(schema, /admin_audit_log/);
});

test("migration keeps Admin audit triggers active with a transaction-local scoped actor", () => {
  assert.match(migration, /membership\.role='SUPER_ADMIN'/);
  assert.match(migration, /membership\.scope_type='GLOBAL'/);
  assert.match(migration, /if migration_actor is not null then/);
  assert.match(migration, /set_config\('request\.jwt\.claim\.sub',migration_actor::text,true\)/);
  assert.doesNotMatch(migration, /disable trigger|session_replication_role/i);
});

test("migration preserves immutable published JSON and classifies through columns", () => {
  assert.doesNotMatch(migration, /set payload=jsonb_set|set settings=jsonb_set|set summary=jsonb_set/i);
  assert.match(migration, /new\.data_environment<>'PRODUCTION'/);
  assert.match(migration, /revision\.data_environment='PRODUCTION'/);
});

test("classification and blocked legacy publications remain auditable", () => {
  assert.match(migration, /QA_CLASSIFICATION_CHANGED/);
  assert.match(migration, /SYSTEM_MIGRATION/);
  assert.match(migration, /set status='ARCHIVED'[\s\S]*data_environment<>'PRODUCTION'/);
  assert.doesNotMatch(migration, /grant all/i);
});

test("player database projections and RLS require PRODUCTION", () => {
  assert.match(migration, /revision\.data_environment='PRODUCTION'/);
  assert.match(migration, /data_environment='PRODUCTION'[\s\S]*status in \('SCHEDULED','PUBLISHED'\)/);
  assert.match(migration, /or private\.admin_has_scope_v1/);
});

test("explicit environment metadata takes precedence over ambiguous legacy text", () => {
  assert.deepEqual(classifyAdminData({ id: "real-item", description: "Prueba QA controlada", dataEnvironment: "PRODUCTION" }), { environment: "PRODUCTION", source: "EXPLICIT" });
  assert.deepEqual(classifyAdminData({ id: "qa-record", data_environment: "TEST" }), { environment: "TEST", source: "EXPLICIT" });
});

test("explicit classification preserves production IDs and wins over legacy text", () => {
  const real = golfBallCatalog[0];
  const classified = withAdminDataEnvironment({ ...real, dataEnvironment: "PRODUCTION", sourceName: "QA review completed" });
  assert.equal(classified.id, real.id);
  assert.equal(classified.data_environment, "PRODUCTION");
  assert.equal(classifyAdminData(classified).source, "EXPLICIT");
});

test("historical bags continue resolving stable archived equipment IDs", () => {
  const seed = [{ id: "driver-stable", active: true, model: "Driver" }];
  const published = [{ id: "driver-stable", active: false, model: "Driver corregido" }];
  const merged = mergePublishedCatalog(seed, published);
  assert.equal(merged.length, 1);
  assert.equal(resolveCatalogItem("driver-stable", seed, published)?.model, "Driver corregido");
});

test("published Course identities remain operational and resolvable", () => {
  const course = INTERNAL_GOLF_COURSE_CATALOG.courses.find((candidate) => candidate.active);
  assert.ok(course);
  const originalId = course.id;
  assert.equal(isOperationalAdminData(course), true);
  assert.equal(course.id, originalId);
  assert.ok(INTERNAL_GOLF_COURSE_CATALOG.clubs.some((club) => club.id === course.clubId));
});
