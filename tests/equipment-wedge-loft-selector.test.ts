import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseUniversalWedgeLoft, UNIVERSAL_WEDGE_LOFTS } from "../lib/equipment-editor-selection";

const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");

test("Wedge always renders the universal loft selector", () => {
  assert.match(editor, /category === "WEDGE" && <label>Loft \/ grados[\s\S]*<select aria-label="Loft \/ grados" required/);
  assert.deepEqual(UNIVERSAL_WEDGE_LOFTS, Array.from({ length: 21 }, (_, index) => 48 + index));
});

test("the selector stays universal when a model has no catalog lofts", () => {
  assert.equal(parseUniversalWedgeLoft("48"), 48);
  assert.equal(parseUniversalWedgeLoft("68"), 68);
  assert.match(editor, /UNIVERSAL_WEDGE_LOFTS\.map/);
  assert.doesNotMatch(editor, /verifiedLofts\.length && .*Loft \/ grados/);
  assert.match(editor, /const verifiedVariant = category === "WEDGE" \? null/);
});

test("Wedge no longer renders the missing-degrees message or manual loft path", () => {
  assert.doesNotMatch(editor, /No hay grados disponibles para este modelo/);
  assert.doesNotMatch(editor, /Agregar loft manualmente|manualLoft/);
  assert.doesNotMatch(editor, /aria-label="Loft \/ grados" type="number"/);
});

test("selecting 56 degrees produces the clean numeric value persisted by the editor", () => {
  assert.equal(parseUniversalWedgeLoft("56"), 56);
  assert.match(editor, /loft: parsedLoft \?\? null/);
});

test("a saved 60 degree loft is restored as the selected value", () => {
  assert.match(editor, /String\(existing\.loft\)/);
  assert.match(editor, /<select aria-label="Loft \/ grados" required value=\{loft\}/);
  assert.equal(parseUniversalWedgeLoft(60), 60);
});

test("Wedge cannot advance or save without a universal loft", () => {
  assert.equal(parseUniversalWedgeLoft(""), null);
  assert.equal(parseUniversalWedgeLoft("47"), null);
  assert.equal(parseUniversalWedgeLoft("69"), null);
  assert.match(editor, /if \(!hasRequiredWedgeLoft\(\)\) return/);
  assert.match(editor, /category === "WEDGE" && parsedLoft === null/);
  assert.match(editor, /Selecciona un loft entre 48° y 68° para guardar este wedge/);
});
