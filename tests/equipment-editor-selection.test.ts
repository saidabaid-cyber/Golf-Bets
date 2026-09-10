import assert from "node:assert/strict";
import test from "node:test";

import { resolveCatalogShaftSelection } from "../lib/equipment-editor-selection";
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
