import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BAG_CATEGORY_SECTIONS, bagCategoryManagement } from "../lib/equipment-bag-management";
import type { ClubCategory } from "../lib/golf-equipment";

test("Mi Bolsa separates populated equipment from compact missing categories", () => {
  const clubs = [{ category: "DRIVER" as ClubCategory }, { category: "WEDGE" as ClubCategory }, { category: "WEDGE" as ClubCategory }];
  const result = bagCategoryManagement(clubs);
  assert.deepEqual(result.populated.map((section) => [section.id, section.clubs.length]), [["driver", 1], ["wedges", 2]]);
  assert.deepEqual(result.missing.map((section) => section.id), ["mini-driver", "woods", "hybrids", "utility", "irons", "putter"]);
  assert.deepEqual(BAG_CATEGORY_SECTIONS.map((section) => section.label), ["Driver", "Mini Driver", "Maderas", "Híbridos", "Utility / Driving Iron", "Hierros", "Wedges", "Putter"]);
});

test("permanent Mi Bolsa keeps the A-B-C-D management order and no promotional or empty-card wall", () => {
  const panel = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");
  const inBag = panel.indexOf("MI BOLSA");
  const add = panel.indexOf("CATEGORÍAS FALTANTES");
  const ball = panel.indexOf("MI BOLA");
  const fit = panel.indexOf("BALL FIT");
  assert.ok(inBag >= 0 && inBag < add && add < ball && ball < fit);
  assert.doesNotMatch(panel, />\+ Agregar<\/button>/);
  assert.doesNotMatch(panel, /Tu juego empieza<br \/>en tu bolsa/);
  assert.doesNotMatch(panel, /className=\{styles\.emptyBagRow\}/);
  assert.match(panel, /initialCategory=\{clubEditor === "new" \? newClubCategory/);
  assert.match(panel, /aria-label=\{`Editar \$\{clubName/);
  assert.match(panel, /<CatalogProductMedia item=\{currentBallCatalog\}/);
  assert.match(panel, /"Actualizar fit"/);
  assert.match(panel, />Comparar</);
});
