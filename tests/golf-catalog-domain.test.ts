import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGolfBallTestResult } from "../lib/golf-catalog-domain";

const ISO = "2026-09-06T12:00:00.000Z";

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-result-1",
    golfBallId: "ball-1",
    testSource: "Licensed independent test",
    sourceUrl: "https://example.com/licensed-test",
    testYear: 2026,
    clubType: "DRIVER",
    swingSpeedMph: 100,
    ballSpeedMph: 148,
    launchAngleDegrees: 13.2,
    spinRateRpm: 2450,
    carryYards: 247,
    totalDistanceYards: 267,
    peakHeightYards: 30.3,
    descentAngleDegrees: 37,
    dispersionYards: 18,
    notes: "Conditions disclosed by source",
    verifiedAt: ISO,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

test("ball test evidence keeps verified metrics and provenance", () => {
  const result = normalizeGolfBallTestResult(evidence());
  assert.ok(result);
  assert.equal(result.clubType, "DRIVER");
  assert.equal(result.spinRateRpm, 2450);
  assert.equal(result.sourceUrl, "https://example.com/licensed-test");
});

test("ball test evidence rejects anonymous or insecure sources", () => {
  assert.equal(normalizeGolfBallTestResult(evidence({ testSource: "" })), null);
  assert.equal(normalizeGolfBallTestResult(evidence({ sourceUrl: "http://example.com/test" })), null);
  assert.equal(normalizeGolfBallTestResult(evidence({ verifiedAt: "not-a-date" })), null);
});

test("unknown test metrics remain null instead of being inferred", () => {
  const result = normalizeGolfBallTestResult(evidence({
    spinRateRpm: undefined,
    carryYards: "247",
    peakHeightYards: -1,
  }));
  assert.ok(result);
  assert.equal(result.spinRateRpm, null);
  assert.equal(result.carryYards, null);
  assert.equal(result.peakHeightYards, null);
});

test("ball test evidence preserves catalog ids up to the SQL contract", () => {
  const golfBallId = `ball-${"x".repeat(195)}`;
  const result = normalizeGolfBallTestResult(evidence({ golfBallId }));
  assert.equal(golfBallId.length, 200);
  assert.equal(result?.golfBallId, golfBallId);
});
