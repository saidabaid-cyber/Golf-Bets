import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { equipmentAliasRegistry } from "../lib/equipment-catalog-aliases";
import { createInternalEquipmentCatalogProvider } from "../lib/equipment-catalog-provider";
import { isPublicEquipmentCatalogItem } from "../lib/equipment-catalog-visibility";
import {
  canonicalBallIdentity,
  canonicalClubIdentity,
  canonicalShaftIdentity,
  dedupeGolfBallCatalog,
  dedupeGolfClubCatalog,
  golfBallCatalog,
  golfClubCatalog,
  golfShaftCatalog,
} from "../lib/golf-equipment-catalog";
import type { GolfBallCatalog, GolfClubCatalog } from "../lib/golf-equipment";

const provider = createInternalEquipmentCatalogProvider({
  balls: golfBallCatalog,
  clubs: golfClubCatalog,
  shafts: golfShaftCatalog,
});

const allCatalogs = [
  ["BALL", golfBallCatalog, canonicalBallIdentity],
  ["CLUB", golfClubCatalog, canonicalClubIdentity],
  ["SHAFT", golfShaftCatalog, canonicalShaftIdentity],
] as const;

const savedCatalogIds = [
  "titleist-pro-v1x-left-dash",
  "callaway-apex-pro-21-iron-set-2021",
  "callaway-paradym-triple-diamond-fairway-fairway-2023",
  "lab-golf-oz1i-putter-2025",
  "taylormade-milled-grind-4-wedge-2023",
  "taylormade-qi4d-driver-2026",
  "titleist-gt2-driver-2024",
  "titleist-vokey-sm11-wedge-2026",
  "fujikura-ventus-blue-velocore-plus-unversioned",
  "graphite-design-tour-ad-f-series-fairway-2015",
  "nippon-shaft-n-s-pro-modus3-wedge-wedge-2017",
  "nippon-shaft-n-s-pro-regio-formula-b-plus-wood-2018",
  "project-x-project-x-ls-iron-2020",
];

test("final public catalogs have stable IDs and zero duplicate semantic identities", () => {
  for (const [kind, rows, identity] of allCatalogs) {
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, `${kind} duplicate ID`);
    assert.equal(new Set(rows.map((row) => identity(row as never))).size, rows.length, `${kind} duplicate identity`);
    assert.ok(rows.every(isPublicEquipmentCatalogItem), `${kind} leaked an internal fixture`);
    assert.ok(rows.every((row) => row.active === true || row.active === false), `${kind} missing lifecycle state`);
  }
});

test("fixtures stay available to tests but never reach search, facets, pinned results or Ball Fit", async () => {
  const fixtureBall = { ...golfBallCatalog[0], id: "mock-ball", brand: "Synthetic QA", model: "Fixture Ball", sourceType: "QA_FIXTURE", active: true, fitEligible: true };
  const fixtureClub = { ...golfClubCatalog[0], id: "test-club", brand: "Internal QA", model: "Mock Driver", sourceType: "INTERNAL_TEST", active: true };
  const fixtureShaft = { ...golfShaftCatalog[0], id: "fixture-shaft", brand: "Fake", model: "Test Data", sourceType: "TEST_DATA", active: true };
  const fixtureProvider = createInternalEquipmentCatalogProvider({ balls: [fixtureBall], clubs: [fixtureClub], shafts: [fixtureShaft] });

  for (const [kind, id] of [["BALL", fixtureBall.id], ["CLUB", fixtureClub.id], ["SHAFT", fixtureShaft.id]] as const) {
    const search = await fixtureProvider.search({ kind, query: "", includeArchived: true, pinnedIds: [id], limit: 50 });
    const facets = await fixtureProvider.brandFacets({ kind, query: "", includeArchived: true, limit: 50 });
    assert.deepEqual(search.items, []);
    assert.deepEqual(facets.items, []);
  }
  const fit = await fixtureProvider.loadBallFitCatalog({ currentBallId: fixtureBall.id, maximumCandidates: 50 });
  assert.deepEqual(fit.items, []);
});

test("aliases participate in brand, model and historical search without creating duplicate families", async () => {
  const checks = [
    ["SHAFT", "Paderson", "Kinetixx"],
    ["SHAFT", "Paderson Kinetixx", "Kinetixx"],
    ["CLUB", "LAB Golf", "L.A.B. Golf"],
    ["BALL", "Vice Golf", "Vice"],
    ["CLUB", "Cleveland Golf", "Cleveland"],
    ["BALL", "Bridgestone Golf", "Bridgestone"],
  ] as const;
  for (const [kind, query, expectedBrand] of checks) {
    const result = await provider.search({ kind, query, includeArchived: true, limit: 50 });
    assert.ok(result.items.length > 0, `${query} returned no models`);
    assert.ok(result.items.every((item) => item.brand === expectedBrand), `${query} created a second visible brand`);
  }
  assert.equal(golfShaftCatalog.some((shaft) => /paderson/i.test(shaft.brand)), false);
  assert.ok(equipmentAliasRegistry.brandAliases.some((row) => row.kind === "SHAFT" && row.canonical === "Kinetixx" && row.aliases.includes("Paderson")));
});

test("current equipment is the default while explicit search can recover legacy equipment", async () => {
  for (const kind of ["BALL", "CLUB", "SHAFT"] as const) {
    const current = await provider.search({ kind, query: "", includeArchived: false, limit: 50 });
    assert.ok(current.items.length > 0);
    assert.ok(current.items.every((item) => item.active));
  }
  const noodleDefault = await provider.search({ kind: "BALL", query: "Noodle", includeArchived: false, limit: 50 });
  const noodleExplicit = await provider.search({ kind: "BALL", query: "Noodle", includeArchived: true, limit: 50 });
  assert.equal(noodleDefault.items.length, 0);
  assert.ok(noodleExplicit.items.length >= 3);
  assert.ok(noodleExplicit.items.every((item) => !item.active && item.brand === "TaylorMade"));
});

test("required manufacturers and models are present with verified current/legacy status", () => {
  assert.ok(golfClubCatalog.some((club) => club.brand === "Honma" && club.active));
  assert.ok(golfClubCatalog.some((club) => club.brand === "Honma" && !club.active));
  assert.ok(golfClubCatalog.some((club) => club.brand === "Takomo" && club.active));
  assert.ok(golfClubCatalog.some((club) => club.brand === "Takomo" && !club.active));
  assert.ok(golfShaftCatalog.some((shaft) => shaft.brand === "Veylix"));
  assert.ok(golfShaftCatalog.filter((shaft) => shaft.brand === "Veylix").every((shaft) => !shaft.active));
  assert.equal(golfBallCatalog.filter((ball) => ball.brand === "Top-Flite").length, 3);
  assert.equal(golfBallCatalog.filter((ball) => ball.brand === "PXG" && ball.model === "Xtreme Tour").length, 1);
  assert.equal(golfBallCatalog.filter((ball) => ball.brand === "PXG" && ball.model === "Xtreme Tour X").length, 1);
  assert.equal(golfBallCatalog.some((ball) => ball.brand === "Amazon Basics"), false);
});

test("plus variants and real generations remain distinct", () => {
  for (const [plain, plus] of [["TSR2", "TSR2+"], ["Bio Cell", "Bio Cell+"], ["F6", "F6+"]] as const) {
    const plainRow = golfClubCatalog.find((club) => club.model.includes(plain) && !club.model.includes("+"));
    const plusRow = golfClubCatalog.find((club) => club.model.includes(plus));
    assert.ok(plainRow, `${plain} missing`);
    assert.ok(plusRow, `${plus} missing`);
    assert.notEqual(canonicalClubIdentity(plainRow!), canonicalClubIdentity(plusRow!));
  }
  const ventus = golfShaftCatalog.find((shaft) => shaft.model === "VENTUS Blue VeloCore");
  const ventusPlus = golfShaftCatalog.find((shaft) => shaft.model === "VENTUS Blue VeloCore+");
  assert.ok(ventus);
  assert.ok(ventusPlus);
  assert.notEqual(canonicalShaftIdentity(ventus!), canonicalShaftIdentity(ventusPlus!));
});

test("an undated ball alias collapses into its only real generation without collapsing real generations", () => {
  const leftDash = golfBallCatalog.filter((ball) => ball.brand === "Titleist" && ball.model === "Pro V1x Left Dash");
  assert.equal(leftDash.length, 1);
  assert.equal(leftDash[0].generation, "2025");
  assert.equal(leftDash[0].year, 2025);
  assert.ok([leftDash[0].id, ...leftDash[0].aliases].includes("titleist-pro-v1x-left-dash"));
  assert.ok([leftDash[0].id, ...leftDash[0].aliases].includes("titleist-pro-v1x-left-dash-2025"));

  const proV1xGenerations = golfBallCatalog
    .filter((ball) => ball.brand === "Titleist" && ball.model === "Pro V1x")
    .map((ball) => ball.year)
    .filter((year): year is number => year !== null);
  assert.ok(proV1xGenerations.length > 1);
  assert.equal(new Set(proV1xGenerations).size, proV1xGenerations.length);
});

test("an undated current alias follows the newest current generation while dated generations remain distinct", () => {
  const template = golfBallCatalog.find((ball) => ball.brand === "Bridgestone" && ball.model === "TOUR B X");
  assert.ok(template);
  const row = (id: string, year: number | null, active: boolean): GolfBallCatalog => ({
    ...template!, id, aliases: [], generation: year === null ? null : String(year), year, active,
  });
  const merged = dedupeGolfBallCatalog([
    row("tour-b-x-undated", null, true),
    row("tour-b-x-2026", 2026, true),
    row("tour-b-x-2024", 2024, true),
    row("tour-b-x-2022", 2022, false),
  ]);
  assert.equal(merged.length, 3);
  const current = merged.find((ball) => ball.year === 2026);
  assert.equal(current?.year, 2026);
  assert.ok([current!.id, ...current!.aliases].includes("tour-b-x-undated"));
  assert.ok([current!.id, ...current!.aliases].includes("tour-b-x-2026"));
  assert.ok(merged.some((ball) => ball.active && ball.year === 2024));
  assert.ok(merged.some((ball) => !ball.active && ball.year === 2022));

  const speedSoft = golfBallCatalog.filter((ball) => ball.brand === "TaylorMade" && ball.model === "SpeedSoft" && ball.active);
  assert.deepEqual(speedSoft.map((ball) => ball.year).sort(), [2024, 2026]);
  const familyIdentity = (ball: GolfBallCatalog) => canonicalBallIdentity(ball).split(":").slice(0, -1).join(":");
  const activeUndatedDuplicates = golfBallCatalog.filter((ball) => ball.active && ball.year === null && ball.generation === null
    && golfBallCatalog.some((candidate) => candidate.active && candidate.year !== null && familyIdentity(candidate) === familyIdentity(ball)));
  assert.deepEqual(activeUndatedDuplicates, []);
});

test("published duplicates merge semantically while preserving both resolvable IDs", async () => {
  const seed = golfClubCatalog.find((club) => club.id === "titleist-gt2-driver-2024");
  assert.ok(seed);
  const publishedId = "admin-titleist-gt2-driver-2024";
  const published = { ...seed!, id: publishedId, aliases: [], sourceName: "Admin verified", sourceType: "ADMIN_RESEARCH" };
  const merged = dedupeGolfClubCatalog([seed!, published]);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].id === seed!.id || merged[0].aliases.includes(seed!.id));
  assert.ok(merged[0].id === publishedId || merged[0].aliases.includes(publishedId));
  const layeredProvider = createInternalEquipmentCatalogProvider({ balls: [], clubs: merged, shafts: [] }, "admin-published+versioned-seed");
  const pinned = await layeredProvider.search({ kind: "CLUB", query: "no-match", includeArchived: true, pinnedIds: [publishedId], limit: 10 });
  assert.equal(pinned.items.length, 1);
  assert.equal(canonicalClubIdentity(pinned.items[0] as GolfClubCatalog), canonicalClubIdentity(seed!));
});

test("brand facets cover the current public catalog and aliases resolve to canonical facets", async () => {
  for (const [kind, rows] of [["BALL", golfBallCatalog], ["CLUB", golfClubCatalog], ["SHAFT", golfShaftCatalog]] as const) {
    const expected = [...new Set(rows.filter((row) => row.active).map((row) => row.brand))].sort((a, b) => a.localeCompare(b, "es-MX"));
    const facets = await provider.brandFacets({ kind, query: "", includeArchived: false, limit: 100 });
    assert.deepEqual(facets.items.map((facet) => facet.brand), expected);
    assert.ok(facets.items.every((facet) => facet.historicalCount === 0));
  }
  const paderson = await provider.brandFacets({ kind: "SHAFT", query: "Paderson", includeArchived: true, limit: 50 });
  assert.deepEqual(paderson.items.map((facet) => facet.brand), ["Kinetixx"]);
});

test("saved bag IDs, legacy IDs and aliases remain resolvable", async () => {
  const allRows = [...golfBallCatalog, ...golfClubCatalog, ...golfShaftCatalog];
  for (const id of savedCatalogIds) {
    assert.ok(allRows.some((row) => row.id === id || row.aliases.includes(id)), `${id} no longer resolves`);
  }
  const alias = golfClubCatalog.find((club) => club.aliases.length > 0);
  assert.ok(alias);
  const pinned = await provider.search({ kind: "CLUB", query: "definitely-no-match", includeArchived: true, pinnedIds: [alias!.aliases[0]], limit: 10 });
  assert.ok(pinned.items.some((item) => item.id === alias!.id));
});

test("the HTTP contract remains the only UI catalog boundary", () => {
  const route = readFileSync("app/api/catalog/equipment/route.ts", "utf8");
  const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");
  const hook = readFileSync("app/components/use-equipment-catalog-search.ts", "utf8");
  const server = readFileSync("lib/equipment-catalog-provider.server.ts", "utf8");
  assert.match(hook, /fetch\(`\/api\/catalog\/equipment\?\$\{params\}`/);
  assert.match(route, /getEquipmentCatalogProvider\(\)/);
  assert.match(server, /mergePublishedCatalog/);
  assert.match(server, /dedupeGolfBallCatalog/);
  assert.match(server, /dedupeGolfClubCatalog/);
  assert.match(server, /dedupeGolfShaftCatalog/);
  assert.match(editor, /includeArchived: clubSearchQuery\.trim\(\)\.length > 0/);
  assert.doesNotMatch(editor, /from\(["'](?:golf_)?(?:club|ball|shaft)_catalog/);
});
