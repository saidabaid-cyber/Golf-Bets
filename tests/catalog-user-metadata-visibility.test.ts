import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const userSurfaces = [
  "app/components/equipment-editors.tsx",
  "app/components/equipment-onboarding.tsx",
  "app/components/equipment-profile-panel.tsx",
  "app/components/ball-fit-wizard.tsx",
  "app/components/course-library.tsx",
  "app/components/catalog-course-picker.tsx",
  "app/components/profile-club-picker.tsx",
  "app/components/round-course-picker.tsx",
  "app/components/round-capture-v2.tsx",
].map((path) => ({ path, source: readFileSync(path, "utf8") }));

const equipmentEditor = readFileSync("app/components/equipment-editors.tsx", "utf8");
const ballFitWizard = readFileSync("app/components/ball-fit-wizard.tsx", "utf8");
const equipmentModel = readFileSync("lib/golf-equipment.ts", "utf8");
const equipmentProvider = readFileSync("lib/equipment-catalog-provider.server.ts", "utf8");
const equipmentApi = readFileSync("app/api/catalog/equipment/route.ts", "utf8");
const admin = readFileSync("app/components/admin-control-center.tsx", "utf8");
const coursePicker = readFileSync("app/components/catalog-course-picker.tsx", "utf8");

test("las superficies del jugador no presentan metadata interna del catálogo", () => {
  const forbidden = [
    /Consultar fuente/i,
    /Ver ficha oficial/i,
    /Datos verificados/i,
    /Datos revisados/i,
    /Catálogo curado/i,
    /cobertura parcial/i,
    /señales comparables/i,
    /Sin dato verificado/i,
    /no tiene suficientes datos disponibles/i,
    /official product specifications/i,
  ];

  for (const { path, source } of userSurfaces) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${path} no debe exponer ${pattern}`);
    }
  }

  assert.doesNotMatch(equipmentEditor, /selectedShaft\.(?:sourceName|sourceUrl|verifiedAt|officialUrl)/);
  assert.doesNotMatch(ballFitWizard, /catalogBall\?\.(?:sourceName|sourceUrl|verifiedAt|officialUrl)/);
  assert.doesNotMatch(coursePicker, /layoutSource\(/);
  assert.doesNotMatch(coursePicker, /c\.(?:sourceUrl|dataVersion|origin)/);
});

test("los datos técnicos útiles y el estado Sin dato permanecen visibles", () => {
  assert.match(equipmentEditor, /selectedShaft\?\.material/);
  assert.match(equipmentEditor, /aria-label="Ficha de la varilla"/);
  for (const fact of ["Uso", "Launch", "Spin", "Torque", "Tip", "Butt"]) {
    assert.match(equipmentEditor, new RegExp(fact));
  }
  assert.match(equipmentEditor, /selected\.construction/);
  assert.match(equipmentEditor, /selected\.compression/);
  assert.match(equipmentEditor, /Sin dato/);
  assert.match(ballFitWizard, /technicalFact/);
  assert.match(ballFitWizard, /Sin dato/);
});

test("la trazabilidad sigue en modelo, provider, API y Admin", () => {
  for (const field of ["sourceName", "sourceUrl", "verifiedAt", "provenance"]) {
    assert.match(equipmentModel, new RegExp(field));
    assert.match(equipmentProvider, new RegExp(field));
    assert.match(admin, new RegExp(field));
  }
  assert.match(equipmentApi, /items = page\.items\.map/);
  assert.match(equipmentApi, /internalEquipmentCatalogProvider\.search/);
  assert.match(equipmentApi, /provider: internalEquipmentCatalogProvider\.id/);
});

test("la atribución obligatoria de OpenStreetMap se conserva", () => {
  assert.match(coursePicker, /openstreetmap\.org\/copyright/);
  assert.match(coursePicker, /© OpenStreetMap contributors \(ODbL\)/);
});
