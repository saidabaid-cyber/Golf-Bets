import assert from "node:assert/strict";
import test from "node:test";

import { catalogClubLofts, isCatalogLoftAllowed, resolveCatalogShaftSelection } from "../lib/equipment-editor-selection";
import type { GolfShaftCatalog } from "../lib/golf-equipment";

function shaft(id: string, model: string): GolfShaftCatalog {
  return {
    id,
    aliases: [],
    brand: "Fujikura",
    model,
    generation: null,
    year: null,
    usage: "WOOD",
    active: true,
    bagEligible: true,
    fitEligible: false,
    oemStockOrAftermarket: "AFTERMARKET",
    weightOptions: [60],
    flexOptions: ["S"],
    weight: 60,
    flex: ["STIFF"],
    launch: null,
    spin: null,
    material: null,
    torqueRange: [],
    torque: null,
    tipDiameter: null,
    buttDiameter: null,
    officialUrl: null,
    sourceName: null,
    sourceUrl: null,
    sourceType: null,
    confidence: null,
    license: null,
    provenance: [],
    verifiedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

test("wedge selector uses only selected model lofts/variants, deduplicated, never a generic wedge range", () => {
  const model = { lofts: [56, 52], variants: [{ loft: 56, handedness: ["RH" as const] }, { loft: 60, handedness: ["RH" as const] }] };
  assert.deepEqual(catalogClubLofts(model), [52, 56, 60]);
  assert.equal(isCatalogLoftAllowed(56, model), true);
  assert.equal(isCatalogLoftAllowed(58, model), false);
  assert.equal(isCatalogLoftAllowed(null, model), true, "optional unknown stays unknown");
});

test("manual wedge and catalog without published degrees permit an explicitly declared loft", () => {
  assert.deepEqual(catalogClubLofts(null), []);
  assert.equal(isCatalogLoftAllowed(56, null), true);
  assert.equal(isCatalogLoftAllowed(56, { lofts: [], variants: [] }), true);
});

test("limpiar un shaft existente produce una selección explícitamente vacía", () => {
  const existing = shaft("shaft-existing", "Ventus Blue");

  assert.equal(resolveCatalogShaftSelection("", [existing], existing), null);
});

test("el shaft existente solo actúa como fallback mientras conserva el mismo id", () => {
  const existing = shaft("shaft-existing", "Ventus Blue");
  const replacement = shaft("shaft-new", "Ventus Red");

  assert.equal(resolveCatalogShaftSelection(existing.id, [], existing), existing);
  assert.equal(resolveCatalogShaftSelection(replacement.id, [replacement], existing), replacement);
  assert.equal(resolveCatalogShaftSelection("shaft-missing", [], existing), null);
});
