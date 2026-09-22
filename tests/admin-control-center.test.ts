import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canTransitionPublication,
  membershipAllows,
  possibleEquipmentDuplicates,
  publicationIsEffective,
  validatePublicationEvidence,
} from "../lib/admin-control-center";
import { csvObjects, equipmentImportPreview, jsonObjects, parseControlledCsv } from "../lib/admin-imports";
import { validateAdminDocument } from "../lib/admin-documents";
import { mergePublishedCatalog, resolveCatalogItem } from "../lib/layered-catalog";

test("admin permissions are role and scope bounded", () => {
  const courseAdmin = { userId: "a", role: "COURSE_ADMIN", scopeType: "COURSE", scopeId: "course-a", active: true } as const;
  assert.equal(membershipAllows(courseAdmin, { entityType: "COURSE_CONFIGURATION", scopeType: "COURSE", scopeId: "course-a" }, "PUBLISH"), true);
  assert.equal(membershipAllows(courseAdmin, { entityType: "COURSE_CONFIGURATION", scopeType: "COURSE", scopeId: "course-b" }, "PUBLISH"), false);
  assert.equal(membershipAllows(courseAdmin, { entityType: "BALL", scopeType: "CATALOG", scopeId: "equipment" }, "CREATE_DRAFT"), false);
  assert.equal(membershipAllows({ userId: "s", role: "SUPER_ADMIN", scopeType: "GLOBAL", scopeId: null, active: true }, { entityType: "BALL", scopeType: "CATALOG", scopeId: "equipment" }, "PUBLISH"), true);
});

test("publication state machine cannot skip verification", () => {
  assert.equal(canTransitionPublication("DRAFT", "PUBLISHED"), false);
  assert.equal(canTransitionPublication("DRAFT", "REVIEWED"), true);
  assert.equal(canTransitionPublication("REVIEWED", "VERIFIED"), true);
  assert.equal(canTransitionPublication("VERIFIED", "PUBLISHED"), true);
  assert.equal(canTransitionPublication("PUBLISHED", "DRAFT"), false);
});

test("publication evidence refuses reported or unsourced facts", () => {
  assert.deepEqual(validatePublicationEvidence({ sourceType: "USER_SUBMITTED", sourceName: "Usuario", sourceUrl: null, verifiedAt: null, provenanceState: "REPORTED" }), [
    "La procedencia debe estar verificada.",
    "Falta una fecha de verificación válida.",
  ]);
  assert.deepEqual(validatePublicationEvidence({ sourceType: "OEM_OFFICIAL", sourceName: "Test source", sourceUrl: "https://example.invalid/source", verifiedAt: "2026-09-22T10:00:00Z", provenanceState: "VERIFIED" }), []);
});

test("scheduling uses an inclusive start and exclusive end", () => {
  const schedule = { effectiveFrom: "2026-09-22T10:00:00Z", effectiveUntil: "2026-09-23T10:00:00Z" };
  assert.equal(publicationIsEffective(schedule, "2026-09-22T10:00:00Z"), true);
  assert.equal(publicationIsEffective(schedule, "2026-09-23T10:00:00Z"), false);
});

test("equipment duplicate key preserves distinct generations", () => {
  const existing = [
    { brand: "Test", model: "Driver", generation: "2026", year: 2026, categoryOrUsage: "DRIVER" },
    { brand: "Test", model: "Driver", generation: "2025", year: 2025, categoryOrUsage: "DRIVER" },
  ];
  assert.equal(possibleEquipmentDuplicates(existing[0], existing).length, 1);
});

test("controlled CSV parser handles quotes and never publishes rows", () => {
  assert.deepEqual(parseControlledCsv('id,model\nclub-1,"Test, Driver"'), [["id", "model"], ["club-1", "Test, Driver"]]);
  assert.deepEqual(csvObjects("id,model\nclub-1,Test Driver"), [{ rowNumber: 2, value: { id: "club-1", model: "Test Driver" } }]);
});

test("controlled JSON import requires an array of object rows", () => {
  assert.deepEqual(jsonObjects('[{"id":"synthetic-1","sourceName":"QA"}]'), [{ rowNumber: 1, value: { id: "synthetic-1", sourceName: "QA" } }]);
  assert.throws(() => jsonObjects('{"id":"not-an-array"}'), /JSON_ARRAY_REQUIRED/);
  assert.throws(() => jsonObjects('["not-an-object"]'), /INVALID_JSON_ROW_1/);
});

test("equipment import preview reports new, update, duplicate, invalid and no-change", () => {
  const current = [{ id: "driver-2026", brand: "Synthetic", model: "Test Driver", generation: "2026", year: 2026, categoryOrUsage: "DRIVER" }];
  const preview = equipmentImportPreview([
    { rowNumber: 2, value: current[0] },
    { rowNumber: 3, value: { ...current[0], model: "Changed" } },
    { rowNumber: 4, value: { ...current[0], id: "duplicate-id" } },
    { rowNumber: 5, value: { ...current[0], id: "shaft-new", model: "Test Shaft", categoryOrUsage: "WOOD" } },
    { rowNumber: 6, value: null, issues: ["Falta fuente."] },
  ], current);
  assert.deepEqual(preview.map((row) => row.status), ["NO_CHANGE", "UPDATE", "POSSIBLE_DUPLICATE", "NEW", "INVALID"]);
});

test("document guard validates MIME and magic bytes and rejects SVG", () => {
  assert.equal(validateAdminDocument(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf").ok, true);
  assert.equal(validateAdminDocument(new TextEncoder().encode("<svg></svg>"), "image/svg+xml").ok, false);
  assert.equal(validateAdminDocument(new Uint8Array([1, 2, 3]), "application/pdf").ok, false);
});

test("published catalog overlays seeds without losing archived historical IDs", () => {
  const seed = [{ id: "seed", name: "Seed", active: true }, { id: "historical", name: "Old", active: true }];
  const published = [{ id: "seed", name: "Admin corrected", active: true }, { id: "historical", name: "Old", active: false }];
  assert.deepEqual(mergePublishedCatalog(seed, published), published);
  assert.equal(resolveCatalogItem("historical", seed, published)?.active, false);
});

test("temporary Course operations list avoids a nonexistent direct tee-hole relationship", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/control-center/route.ts"), "utf8");
  assert.match(route, /from\("course_configurations"\)\.select\("id,course_id,name,description,scope_type,competition_id,status/);
  assert.doesNotMatch(route, /course_configurations"\)\.select\("\*,course_configuration_holes\(\*\),course_configuration_tee_holes\(\*\)/);
});

test("temporary and Competition configuration editors load immutable base holes", () => {
  const component = readFileSync(join(process.cwd(), "app/components/admin-control-center.tsx"), "utf8");
  assert.match(component, /view=courses&courseId=/);
  assert.match(component, /sourceBaseHoleId: hole\.id/);
  assert.doesNotMatch(component, /api\/courses\/.*\/operations/);
});
