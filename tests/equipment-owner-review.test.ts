import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  catalogClubGenerationOptions,
  catalogClubLofts,
  clubHandednessFromProfile,
  groupCatalogClubModels,
} from "../lib/equipment-editor-selection";
import { golfClubCatalog, golfShaftCatalog } from "../lib/golf-equipment-catalog";

test("la generación y el año salen de variantes reales del catálogo", () => {
  const families = groupCatalogClubModels(golfClubCatalog);
  const multiGeneration = families.find((family) => family.generations.length > 1);
  const singleGeneration = families.find((family) => family.generations.length === 1 && family.representative.year !== null);

  assert.ok(multiGeneration, "el catálogo real debe conservar al menos una familia multigeneración");
  assert.ok(singleGeneration, "el catálogo real debe conservar al menos una familia de generación única");
  assert.deepEqual(
    catalogClubGenerationOptions(multiGeneration.representative, golfClubCatalog).map((club) => club.id),
    multiGeneration.generations.map((club) => club.id),
  );
  assert.equal(catalogClubGenerationOptions(singleGeneration.representative, golfClubCatalog).length, 1);
  assert.ok(multiGeneration.generations.every((club) => club.brand === multiGeneration.representative.brand
    && club.model === multiGeneration.representative.model
    && club.category === multiGeneration.representative.category));
});

test("la mano de Equipment se deriva de la preferencia canónica del perfil", () => {
  assert.equal(clubHandednessFromProfile("right"), "RH");
  assert.equal(clubHandednessFromProfile("left"), "LH");
  assert.equal(clubHandednessFromProfile("ambidextrous", "LH"), "LH");
  assert.equal(clubHandednessFromProfile("", "RH"), "RH");
});

test("lofts y opciones de shaft son los valores publicados, no rangos genéricos", () => {
  const wedge = golfClubCatalog.find((club) => club.category === "WEDGE" && catalogClubLofts(club).length > 1);
  const shaft = golfShaftCatalog.find((item) => item.weightOptions.length > 1 && item.flexOptions.length > 1);

  assert.ok(wedge, "el catálogo combinado debe aportar un wedge con grados verificados");
  assert.ok(shaft, "el catálogo real debe aportar una varilla con opciones estructuradas");
  assert.deepEqual(catalogClubLofts(wedge), [...new Set([...wedge.lofts, ...wedge.variants.map((variant) => variant.loft)])].sort((a, b) => a - b));
  assert.equal(new Set(shaft.weightOptions).size, shaft.weightOptions.length);
  assert.equal(new Set(shaft.flexOptions).size, shaft.flexOptions.length);
  assert.ok(shaft.weightOptions.every(Number.isFinite));
  assert.ok(shaft.flexOptions.every((value) => value.trim() === value && value.length > 0));
});

test("la UI final usa bolsa premium, selección guiada y modo manual explícito", () => {
  const panel = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");
  const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");

  for (const category of ["Driver", "Maderas", "Híbridos", "Hierros", "Wedges", "Putter", "Bola"]) {
    assert.match(panel, new RegExp(category));
  }
  assert.match(panel, /wedgeLoftSummary/);
  assert.match(panel, /styles\.bagItemMain/);
  assert.match(panel, /styles\.rowChevron/);
  assert.match(editor, /generationOptions\.length > 1/);
  assert.match(editor, /selectedShaft\.flexOptions\.length/);
  assert.match(editor, /selectedShaft\.weightOptions\.length/);
  assert.match(editor, /Agregar especificación manual/);
  assert.match(editor, /Medidas y detalles opcionales/);
  assert.match(editor, /Bounce y grind sólo aparecerán/);
});
