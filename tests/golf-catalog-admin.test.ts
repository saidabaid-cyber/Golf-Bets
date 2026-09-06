import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GOLF_CATALOG_ADMIN_DEFINITIONS,
  GOLF_CATALOG_ADMIN_RESOURCES,
  hasImmutableAdminRole,
  normalizeGolfAdminSearch,
  normalizeGolfCatalogAdminWrite,
  parseAdminBearerToken,
  parseGolfAdminLimit,
  parseGolfCatalogAdminResource,
  validGolfAdminId,
} from "../lib/golf-catalog-admin-contract";
import { createLatestRequestGate } from "../lib/latest-request-gate";

const route = readFileSync("app/api/admin/golf-catalog/route.ts", "utf8");
const panel = readFileSync("app/components/golf-catalog-admin-panel.tsx", "utf8");
const page = readFileSync("app/admin/page.tsx", "utf8");

test("el contrato administrativo usa una lista cerrada de tablas", () => {
  assert.equal(GOLF_CATALOG_ADMIN_RESOURCES.length, 12);
  assert.equal(parseGolfCatalogAdminResource("balls"), "balls");
  assert.equal(parseGolfCatalogAdminResource("profiles"), null);
  assert.equal(parseGolfCatalogAdminResource("rounds_cloud"), null);
  for (const resource of GOLF_CATALOG_ADMIN_RESOURCES) {
    assert.equal(typeof GOLF_CATALOG_ADMIN_DEFINITIONS[resource].table, "string");
    assert.ok(GOLF_CATALOG_ADMIN_DEFINITIONS[resource].select.includes("id"));
  }
});

test("Bearer y rol admin son estrictos y dependen solo de app_metadata", () => {
  assert.equal(parseAdminBearerToken("Bearer valid.token"), "valid.token");
  assert.equal(parseAdminBearerToken("bearer valid.token"), "valid.token");
  assert.equal(parseAdminBearerToken("Basic valid.token"), null);
  assert.equal(parseAdminBearerToken("Bearer "), null);
  assert.equal(parseAdminBearerToken("Bearer one two"), null);
  assert.equal(hasImmutableAdminRole({ role: "admin" }), true);
  assert.equal(hasImmutableAdminRole({ role: "ADMIN" }), false);
  assert.equal(hasImmutableAdminRole({ role: "member" }), false);
  assert.equal(hasImmutableAdminRole(null), false);
});

test("las escrituras rechazan campos de identidad, auditoría y tablas arbitrarias", () => {
  const forbiddenOwner = normalizeGolfCatalogAdminWrite("courses", { user_id: "attacker" }, "update");
  const forbiddenCreator = normalizeGolfCatalogAdminWrite("course-venues", { created_by: "attacker" }, "update");
  const forbiddenGenerated = normalizeGolfCatalogAdminWrite("balls", { search_text: "forged" }, "update");
  assert.equal(forbiddenOwner.ok, false);
  assert.equal(forbiddenCreator.ok, false);
  assert.equal(forbiddenGenerated.ok, false);
});

test("crear datos externos exige procedencia verificable", () => {
  const incomplete = normalizeGolfCatalogAdminWrite("courses", {
    club_id: "cdf97d61-d3b3-4c93-9c02-068dc3c7655e",
    name: "Course",
    holes: 18,
    provider: "EXTERNAL_VENDOR",
  }, "create");
  assert.deepEqual(incomplete, {
    ok: false,
    error: "Un proveedor externo requiere identificador, fuente y fecha de verificación.",
  });

  const complete = normalizeGolfCatalogAdminWrite("courses", {
    club_id: "cdf97d61-d3b3-4c93-9c02-068dc3c7655e",
    name: "Course",
    holes: 18,
    provider: "EXTERNAL_VENDOR",
    provider_external_id: "course-19",
    source_url: "https://provider.example/courses/19",
    verified_at: "2026-09-06T12:00:00.000Z",
  }, "create");
  assert.equal(complete.ok, true);
});

test("bolas y bastones nuevos exigen y normalizan una marca canónica", () => {
  const missingReference = normalizeGolfCatalogAdminWrite("balls", {
    id: "titleist-pro-v1-2025",
    model: "Pro V1",
    source_name: "Titleist",
    source_url: "https://www.titleist.com/product/pro-v1/005PV1T.html",
    verified_at: "2026-09-06T12:00:00.000Z",
  }, "create");
  assert.equal(missingReference.ok, false);

  const canonicalReference = normalizeGolfCatalogAdminWrite("club-models", {
    id: "titleist-gt3-driver-2024",
    brand_id: "titleist",
    model: "GT3",
    category: "DRIVER",
    source_name: "Titleist",
    source_url: "https://www.titleist.com/golf-clubs/drivers/gt3",
    verified_at: "2026-09-06T12:00:00.000Z",
  }, "create");
  assert.equal(canonicalReference.ok, true);

  const freeTextOnly = normalizeGolfCatalogAdminWrite("balls", { brand: "Titleist" }, "update");
  assert.equal(freeTextOnly.ok, false);
});

test("una cifra de compresión exige procedencia dedicada", () => {
  const unverified = normalizeGolfCatalogAdminWrite("balls", { compression: 88 }, "update");
  assert.equal(unverified.ok, false);
  const unknown = normalizeGolfCatalogAdminWrite("balls", {
    compression: 88,
    compression_type: "UNKNOWN",
    compression_source: "Fuente",
    compression_source_url: "https://example.org/compression",
  }, "update");
  assert.equal(unknown.ok, false);
  const verified = normalizeGolfCatalogAdminWrite("balls", {
    compression: 88,
    compression_type: "INDEPENDENT_MEASURED",
    compression_source: "Laboratorio autorizado",
    compression_source_url: "https://example.org/compression",
  }, "update");
  assert.equal(verified.ok, true);
});

test("el catálogo global no suplanta registros manuales privados", () => {
  for (const resource of ["course-venues", "courses", "course-tees", "course-holes", "tee-yardages", "geo-features"] as const) {
    const write = normalizeGolfCatalogAdminWrite(resource, { provider: "USER_MANUAL" }, "update");
    assert.equal(write.ok, false, resource);
  }
});

test("archivar conserva el registro y una prueba puede omitir año", () => {
  assert.deepEqual(normalizeGolfCatalogAdminWrite("balls", { active: false }, "update"), {
    ok: true,
    data: { active: false },
  });
  const testResult = normalizeGolfCatalogAdminWrite("ball-tests", {
    golf_ball_id: "titleist-pro-v1-2025",
    test_source: "Laboratorio autorizado",
    source_url: "https://example.org/test",
    club_type: "DRIVER",
    peak_height_yards: 34.5,
    verified_at: "2026-09-06T12:00:00.000Z",
  }, "create");
  assert.equal(testResult.ok, true);
  if (testResult.ok) assert.equal(testResult.data.test_year, undefined);
});

test("las métricas de pruebas usan los límites del dominio", () => {
  const required = {
    golf_ball_id: "titleist-pro-v1-2025",
    test_source: "Laboratorio autorizado",
    source_url: "https://example.org/test",
    club_type: "DRIVER",
    verified_at: "2026-09-06T12:00:00.000Z",
  };
  assert.equal(normalizeGolfCatalogAdminWrite("ball-tests", {
    ...required,
    swing_speed_mph: 180,
    ball_speed_mph: 250,
    launch_angle_degrees: -20,
    spin_rate_rpm: 20_000,
    carry_yards: 500,
    total_yards: 600,
    peak_height_yards: 300,
    descent_angle_degrees: 90,
    dispersion_yards: 250,
  }, "create").ok, true);

  for (const [field, value] of Object.entries({
    swing_speed_mph: 181,
    ball_speed_mph: 251,
    launch_angle_degrees: -21,
    spin_rate_rpm: 20_001,
    carry_yards: 501,
    total_yards: 601,
    peak_height_yards: 301,
    descent_angle_degrees: -21,
    dispersion_yards: 251,
  })) {
    assert.equal(normalizeGolfCatalogAdminWrite("ball-tests", { ...required, [field]: value }, "create").ok, false, field);
  }
});

test("la paginación, ids y búsqueda quedan acotados", () => {
  assert.equal(parseGolfAdminLimit(null), 20);
  assert.equal(parseGolfAdminLimit("0"), 1);
  assert.equal(parseGolfAdminLimit("500"), 50);
  assert.equal(parseGolfAdminLimit("no"), 20);
  assert.equal(normalizeGolfAdminSearch(" Pro_V% "), "Pro\\_V\\%");
  assert.equal(validGolfAdminId("titleist-pro-v1-2025", "text"), true);
  assert.equal(validGolfAdminId("course-la-vista", "text"), true);
  assert.equal(GOLF_CATALOG_ADMIN_DEFINITIONS.courses.idKind, "text");
  assert.equal(GOLF_CATALOG_ADMIN_DEFINITIONS["course-tees"].idKind, "text");
  assert.equal(validGolfAdminId("../../profiles", "text"), false);
  assert.equal(validGolfAdminId("cdf97d61-d3b3-4c93-9c02-068dc3c7655e", "uuid"), true);
});

test("la ruta revalida el JWT, no confía en metadata editable y no borra catálogos", () => {
  assert.match(route, /auth\.getUser\(token\)/);
  assert.match(route, /hasImmutableAdminRole\(data\.user\.app_metadata\)/);
  assert.doesNotMatch(route, /user_metadata/);
  assert.match(route, /getSupabaseAdmin\("cloud"\)/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.doesNotMatch(route, /\.delete\(\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /async function canonicalizeBrand/);
  assert.match(route, /\.from\(brandTable\)[\s\S]*\.select\("id,name"\)[\s\S]*brand: brand\.name/);
});

test("el admin falla cerrado antes de construir clientes con credenciales compartidas", () => {
  const accessFunction = route.slice(route.indexOf("async function requireAdmin"), route.indexOf("async function readJson"));
  const gate = accessFunction.indexOf("if (!equipmentCloudServerEnabled)");
  const userClient = accessFunction.indexOf("getSupabaseForUser(token");
  const serviceClient = accessFunction.indexOf("getSupabaseAdmin(\"cloud\")");
  assert.ok(gate >= 0);
  assert.ok(userClient > gate);
  assert.ok(serviceClient > gate);
});

test("/admin ofrece alta, edición y archivo sin exponer una acción destructiva", () => {
  assert.match(page, /<AccountProvider><GolfCatalogAdminPanel \/><\/AccountProvider>/);
  assert.match(panel, /method: editing \? "PATCH" : "POST"/);
  assert.match(panel, /Registro archivado sin borrarlo/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /No hay registros para esta búsqueda/);
  assert.match(panel, /Cargando catálogo/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /name: "brand_id", label: "Marca", kind: "select", required: true/);
  assert.match(panel, /resource=\$\{brandResource\}&limit=50&includeArchived=true/);
  assert.doesNotMatch(panel, /method:\s*"DELETE"/);
});

test("el admin invalida cargas anteriores al cambiar catálogo o búsqueda", () => {
  const gate = createLatestRequestGate();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.signal.aborted, false);
  assert.equal(second.isCurrent(), true);

  gate.invalidate();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);

  assert.match(panel, /signal: request\.signal/);
  assert.match(panel, /!request\.isCurrent\(\) \|\| !sameLoadContext\(loadContext\.current, requestedContext\)/);
  assert.match(panel, /if \(!sameLoadContext\(loadContext\.current, requestedContext\)\) return/);
  assert.match(panel, /function changeResource[\s\S]*clearLoadedSelection\(\)[\s\S]*setResource\(nextResource\)/);
  assert.match(panel, /function clearLoadedSelection[\s\S]*setItems\(\[\]\)[\s\S]*setEditing\(null\)/);
  assert.match(panel, /setEditing\(\{ resource, item \}\)/);
  assert.match(panel, /editing && editing\.resource !== resource/);
  assert.match(panel, /resource: editing\.resource, id: editing\.item\.id/);
  assert.match(panel, /if \(loadContext\.current\.resource !== savedResource\) return/);
});
