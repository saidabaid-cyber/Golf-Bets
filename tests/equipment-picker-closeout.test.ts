import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isClubHandednessAllowed, verifiedClubHandedness } from "../lib/equipment-editor-selection";
import { createInternalEquipmentCatalogProvider } from "../lib/equipment-catalog-provider";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../lib/golf-equipment-catalog";
import { normalizeGolfClubCatalogEntries, type GolfClubCatalog } from "../lib/golf-equipment";

const provider = createInternalEquipmentCatalogProvider({ balls: golfBallCatalog, clubs: golfClubCatalog, shafts: golfShaftCatalog });

test("las marcas se calculan sobre todo el catálogo elegible, no sobre la primera página de modelos", async () => {
  const facets = await provider.brandFacets({ kind: "CLUB", category: "DRIVER", includeArchived: true, limit: 50 });
  const full = await provider.search({ kind: "CLUB", category: "DRIVER", includeArchived: true, limit: 50 });
  const facetCount = facets.items.reduce((sum, item) => sum + item.count, 0);
  assert.ok(facetCount > full.items.length, "la faceta debe cubrir más que la primera página de 50 modelos");
  assert.equal(facets.hasMore, false);
  assert.ok(facets.items.some((item) => item.historicalCount > 0));
});

test("las facetas respetan categoría, uso, búsqueda y conteos actuales/históricos", async () => {
  const clubs = await provider.brandFacets({ kind: "CLUB", category: "DRIVER", query: "title", includeArchived: true, limit: 10 });
  assert.ok(clubs.items.some((item) => item.brand === "Titleist" && item.count === item.currentCount + item.historicalCount));
  const shafts = await provider.brandFacets({ kind: "SHAFT", shaftUsage: "WOOD", query: "fuji", includeArchived: true, limit: 10 });
  assert.ok(shafts.items.some((item) => item.brand === "Fujikura"));
  const balls = await provider.brandFacets({ kind: "BALL", query: "title", includeArchived: true, limit: 10 });
  assert.ok(balls.items.some((item) => item.brand === "Titleist"));
});

test("una mano sin dato verificado permite RH/LH y una restricción real sí se respeta", () => {
  const source = golfClubCatalog.find((club) => club.category === "DRIVER");
  assert.ok(source);
  const unknown = { ...source, handedness: [], variants: [] } satisfies GolfClubCatalog;
  assert.equal(verifiedClubHandedness(unknown), null);
  assert.equal(isClubHandednessAllowed("RH", unknown), true);
  assert.equal(isClubHandednessAllowed("LH", unknown), true);
  const rightOnly = { ...unknown, handedness: ["RH" as const] };
  assert.equal(isClubHandednessAllowed("RH", rightOnly), true);
  assert.equal(isClubHandednessAllowed("LH", rightOnly), false);
});

test("los editores incluyen históricos desde la primera pantalla y usan facetas server-side", () => {
  const editors = readFileSync("app/components/equipment-editors.tsx", "utf8");
  const hook = readFileSync("app/components/use-equipment-catalog-search.ts", "utf8");
  const route = readFileSync("app/api/catalog/equipment/route.ts", "utf8");
  assert.match(editors, /includeArchived: true/);
  assert.match(editors, /useEquipmentBrandFacets/);
  assert.match(hook, /facet: "brands"/);
  assert.match(route, /facet === "brands"/);
  assert.doesNotMatch(editors, /Select Brand|Select Model/);
});

test("las imágenes de catálogo sólo aceptan HTTPS con metadata de procedencia y tienen fallback", () => {
  const source = golfClubCatalog[0];
  assert.ok(source);
  const insecure = normalizeGolfClubCatalogEntries([{ ...source, imageUrl: "http://example.com/club.jpg", imageSourceUrl: "javascript:bad", imageAlt: "Producto", imageLicense: "OEM media terms" }])[0];
  assert.ok(insecure);
  assert.equal(insecure.imageUrl, null);
  assert.equal(insecure.imageSourceUrl, null);
  const secure = normalizeGolfClubCatalogEntries([{ ...source, imageUrl: "https://media.example.com/club.jpg", imageSourceUrl: "https://example.com/product", imageAlt: "Producto", imageLicense: "OEM media terms" }])[0];
  assert.ok(secure);
  assert.equal(secure.imageUrl, "https://media.example.com/club.jpg");
  assert.equal(secure.imageSourceUrl, "https://example.com/product");
  const media = readFileSync("app/components/catalog-product-media.tsx", "utf8");
  assert.match(media, /catalogMediaFallback/);
  assert.match(media, /onError=\{\(\) => setFailed\(true\)\}/);
});
