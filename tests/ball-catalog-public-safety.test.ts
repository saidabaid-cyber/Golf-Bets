import assert from "node:assert/strict";
import test from "node:test";

import { createInternalEquipmentCatalogProvider } from "../lib/equipment-catalog-provider";
import { isPublicEquipmentCatalogItem } from "../lib/equipment-catalog-visibility";
import { golfBallBrands, golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../lib/golf-equipment-catalog";
import ballCatalogDiff from "../data/qa/ball-catalog-diff.json";

const INTERNAL_MARKER = /synthetic|fixture|(?:^|\W)qa(?:\W|$)|test fixture/i;

test("public ball catalog has no Synthetic QA or other fixture identity", () => {
  assert.ok(golfBallCatalog.length > 0);
  assert.equal(golfBallCatalog.some((ball) => INTERNAL_MARKER.test(`${ball.id} ${ball.brand} ${ball.model} ${ball.sourceName}`)), false);
  assert.equal(golfBallBrands.some((brand) => INTERNAL_MARKER.test(brand)), false);
});

test("player provider excludes internal fixtures from search, facets, pinned ids and Ball Fit", async () => {
  const publicBall = golfBallCatalog[0];
  assert.ok(publicBall);
  const syntheticBall = {
    ...publicBall,
    id: "synthetic-qa-ball",
    brand: "Synthetic QA",
    model: "Fixture Ball",
    active: true,
    bagEligible: true,
    fitEligible: true,
    sourceName: "QA fixture",
    sourceType: "INTERNAL_QA",
  };
  assert.equal(isPublicEquipmentCatalogItem(syntheticBall), false);

  const provider = createInternalEquipmentCatalogProvider({
    balls: [publicBall, syntheticBall],
    clubs: golfClubCatalog,
    shafts: golfShaftCatalog,
  });
  const search = await provider.search({
    kind: "BALL",
    includeArchived: true,
    pinnedIds: [syntheticBall.id],
    limit: 50,
  });
  const facets = await provider.brandFacets({ kind: "BALL", includeArchived: true, limit: 50 });
  const fit = await provider.loadBallFitCatalog({ currentBallId: syntheticBall.id, maximumCandidates: 50 });

  assert.equal(search.items.some((item) => item.id === syntheticBall.id), false);
  assert.equal(facets.items.some((item) => item.brand === syntheticBall.brand), false);
  assert.equal(fit.items.some((item) => item.id === syntheticBall.id), false);
});

test("only source-verified additions are public and unknown technical facts remain null", () => {
  const expected = [
    ["pxg-xtreme-tour-2024", "https://www.pxg.com/products/xtreme-tour-golf-ball"],
    ["pxg-xtreme-tour-x-2024", "https://www.pxg.com/products/xtreme-tour-x-golf-ball"],
    ["pinnacle-distance-current", "https://www.pinnaclegolf.com/"],
    ["nitro-ultimate-distance-current", "https://thenitrogolf.com/nitro-golf-balls/"],
  ] as const;

  for (const [id, sourceUrl] of expected) {
    const ball = golfBallCatalog.find((candidate) => candidate.id === id);
    assert.ok(ball, id);
    assert.equal(ball.officialUrl, sourceUrl);
    assert.equal(ball.sourceType, "OEM_OFFICIAL");
    assert.equal(ball.compression, null);
    assert.equal(ball.fitEligible, false);
  }
});

test("published ball catalog audit matches the normalized runtime catalog", () => {
  assert.equal(ballCatalogDiff.afterVerifiedAdditions.inAppModels, golfBallCatalog.length);
  assert.equal(ballCatalogDiff.afterVerifiedAdditions.inAppCurrent, golfBallCatalog.filter((ball) => ball.active).length);
  assert.equal(ballCatalogDiff.afterVerifiedAdditions.inAppHistorical, golfBallCatalog.filter((ball) => !ball.active).length);
  assert.deepEqual(ballCatalogDiff.afterVerifiedAdditions.brandNames, golfBallBrands);
  assert.equal(ballCatalogDiff.qaRecordsFoundInVersionedSources.length, 0);
});
