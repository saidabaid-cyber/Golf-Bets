import assert from "node:assert/strict";
import test from "node:test";

import { createInternalEquipmentCatalogProvider } from "../lib/equipment-catalog-provider";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../lib/golf-equipment-catalog";

const internalEquipmentCatalogProvider = createInternalEquipmentCatalogProvider({
  balls: golfBallCatalog,
  clubs: golfClubCatalog,
  shafts: golfShaftCatalog,
});

test("equipment catalog search is bounded and matches brand/model tokens", async () => {
  const balls = await internalEquipmentCatalogProvider.search({ kind: "BALL", query: "Pro V", limit: 5 });
  assert.ok(balls.items.length > 0);
  assert.ok(balls.items.length <= 5);
  assert.ok(`${balls.items[0].brand} ${balls.items[0].model}`.toLocaleLowerCase().includes("pro v"));

  const clubs = await internalEquipmentCatalogProvider.search({ kind: "CLUB", query: "Taylor", limit: 5 });
  assert.ok(clubs.items.length > 0);
  assert.ok(clubs.items.every((item) => item.brand.toLocaleLowerCase().includes("taylor")));
});

test("equipment catalog provider paginates with an opaque stable cursor", async () => {
  const first = await internalEquipmentCatalogProvider.search({ kind: "CLUB", limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const second = await internalEquipmentCatalogProvider.search({ kind: "CLUB", limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 2);
  assert.equal(second.items.some((item) => first.items.some((prior) => prior.id === item.id)), false);
});

test("archived catalog entries are excluded unless explicitly requested", async () => {
  const active = await internalEquipmentCatalogProvider.search({ kind: "BALL", includeArchived: false, limit: 50 });
  assert.ok(active.items.every((item) => item.active));
});

test("malformed or oversized cursors fail closed without crashing search", async () => {
  const malformed = await internalEquipmentCatalogProvider.search({ kind: "BALL", cursor: "%", limit: 2 });
  const oversized = await internalEquipmentCatalogProvider.search({ kind: "BALL", cursor: "x".repeat(241), limit: 2 });
  assert.equal(malformed.items.length, 2);
  assert.deepEqual(oversized.items.map((item) => item.id), malformed.items.map((item) => item.id));
});

test("saved catalog ids are pinned across pagination and may resolve archived history", async () => {
  const archivedBall = { ...golfBallCatalog[0], id: "archived-saved-ball", active: false };
  const provider = createInternalEquipmentCatalogProvider({
    balls: [...golfBallCatalog, archivedBall],
    clubs: golfClubCatalog,
    shafts: golfShaftCatalog,
  });
  const result = await provider.search({ kind: "BALL", query: "unrelated", limit: 1, pinnedIds: [archivedBall.id] });
  assert.equal(result.items.some((item) => item.id === archivedBall.id), true);
  assert.equal(result.items.find((item) => item.id === archivedBall.id)?.active, false);
});

test("Ball Fit recibe el catálogo activo completo aunque la búsqueda normal tenga varias páginas", async () => {
  const expandedBalls = Array.from({ length: 51 }, (_, index) => ({
    ...golfBallCatalog[index % golfBallCatalog.length],
    id: `expanded-ball-${index}`,
    brand: `Brand ${index}`,
  }));
  const archivedCurrent = { ...golfBallCatalog[0], id: "archived-current", active: false };
  const provider = createInternalEquipmentCatalogProvider({
    balls: [...expandedBalls, archivedCurrent],
    clubs: golfClubCatalog,
    shafts: golfShaftCatalog,
  });
  const firstPage = await provider.search({ kind: "BALL", limit: 50 });
  const fitScope = await provider.loadBallFitCatalog({ currentBallId: archivedCurrent.id, maximumCandidates: 100 });

  assert.equal(firstPage.items.length, 50);
  assert.equal(firstPage.hasMore, true);
  assert.equal(fitScope.complete, true);
  assert.equal(fitScope.activeCandidateCount, 51);
  assert.equal(fitScope.evaluatedCandidateCount, 51);
  assert.equal(fitScope.items.filter((ball) => ball.active).length, 51);
  assert.equal(fitScope.items.some((ball) => ball.id === archivedCurrent.id), true);
});

test("Ball Fit falla cerrado cuando el catálogo rebasa el máximo; nunca entrega una muestra parcial", async () => {
  const expandedBalls = Array.from({ length: 51 }, (_, index) => ({
    ...golfBallCatalog[index % golfBallCatalog.length],
    id: `bounded-ball-${index}`,
  }));
  const provider = createInternalEquipmentCatalogProvider({
    balls: expandedBalls,
    clubs: golfClubCatalog,
    shafts: golfShaftCatalog,
  });
  const fitScope = await provider.loadBallFitCatalog({ maximumCandidates: 50 });

  assert.equal(fitScope.complete, false);
  assert.equal(fitScope.activeCandidateCount, 51);
  assert.equal(fitScope.evaluatedCandidateCount, 0);
  assert.deepEqual(fitScope.items, []);
});
