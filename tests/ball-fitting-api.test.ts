import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKYARD_BALL_FIT_DISCLAIMER,
  runBackyardBallFit,
} from "../lib/ball-fitting";
import {
  BALL_FIT_TRANSPORT_SCOPE_ID,
  createBallFitTransportInput,
  normalizeBallFitApiSuccess,
  normalizeBallFitTransportInput,
} from "../lib/ball-fitting-api";
import { golfBallCatalog } from "../lib/golf-equipment-catalog";

const input = {
  userId: "fit-api-user",
  currentBallId: golfBallCatalog[0].id,
  handicap: 12,
  typicalScore: 86,
  driverDistanceYards: 240,
  swingSpeedBand: "FROM_85_TO_95",
  feelPreference: "SOFT",
  trajectoryPreference: "MID",
  greenFirmness: "FIRM",
  priorities: ["STOP_ON_GREEN", "GREENSIDE_FEEL"],
  approachBehavior: "ROLLS_TOO_MUCH",
  wantsGreensideSpin: "YES",
  pricePreference: "BEST_FIT",
  colorPreference: "ANY",
  launchMonitorSession: null,
};

test("el transporte stateless sustituye identidades sin mutar la sesión local", () => {
  const localInput = {
    ...input,
    userId: "auth-user-real-id",
    launchMonitorSession: {
      id: "session-random-id",
      userId: "auth-user-real-id",
      source: "TrackMan",
      startedAt: "2026-09-06T20:00:00.000Z",
      completedAt: null,
      shots: [{
        id: "shot-random-id",
        club: "DRIVER",
        excluded: false,
        capturedAt: null,
        note: null,
        clubSpeedMph: 98,
        ballSpeedMph: 145,
        launchAngleDegrees: 13,
        spinRpm: 2_400,
        carryYards: 250,
        totalYards: 270,
        peakHeightYards: 30,
        landingAngleDegrees: 38,
      }],
    },
  };
  const transport = createBallFitTransportInput(localInput);

  assert.ok(transport);
  assert.equal(transport.userId, BALL_FIT_TRANSPORT_SCOPE_ID);
  assert.equal(transport.launchMonitorSession?.userId, BALL_FIT_TRANSPORT_SCOPE_ID);
  assert.equal(localInput.userId, "auth-user-real-id");
  assert.equal(localInput.launchMonitorSession.userId, "auth-user-real-id");
  assert.equal(JSON.stringify(transport).includes("auth-user-real-id"), false);
  assert.deepEqual(normalizeBallFitTransportInput(transport), transport);
  assert.equal(normalizeBallFitTransportInput(localInput), null);
});

test("normaliza una respuesta exhaustiva y sólo exige detalles de recomendaciones", () => {
  const eligibleCatalog = golfBallCatalog.filter((ball) => ball.active && ball.fitEligible);
  const result = runBackyardBallFit(eligibleCatalog, input);
  const selectedIds = new Set([input.currentBallId, ...result.recommendations.map((item) => item.catalogBallId)]);
  const catalog = golfBallCatalog.filter((ball) => selectedIds.has(ball.id));
  const normalized = normalizeBallFitApiSuccess({
    provider: "test-provider",
    scope: {
      complete: true,
      activeCandidateCount: eligibleCatalog.length,
      evaluatedCandidateCount: eligibleCatalog.length,
      maximumCandidates: 2_000,
    },
    result,
    catalog,
  });

  assert.ok(normalized);
  assert.equal(normalized.scope.complete, true);
  assert.equal(normalized.result.disclaimer, BACKYARD_BALL_FIT_DISCLAIMER);
  assert.equal(normalized.catalog.length, catalog.length);
  assert.ok(normalized.result.recommendations.every((recommendation) => normalized.catalog.some((ball) => ball.id === recommendation.catalogBallId)));
});

test("rechaza alcance parcial, conteos inconsistentes y recomendaciones sin detalle", () => {
  const result = runBackyardBallFit(golfBallCatalog, input);
  const base = {
    provider: "test-provider",
    scope: { complete: true, activeCandidateCount: 11, evaluatedCandidateCount: 11, maximumCandidates: 2_000 },
    result,
    catalog: golfBallCatalog.filter((ball) => result.recommendations.some((item) => item.catalogBallId === ball.id)),
  };

  assert.equal(normalizeBallFitApiSuccess({ ...base, scope: { ...base.scope, complete: false } }), null);
  assert.equal(normalizeBallFitApiSuccess({ ...base, scope: { ...base.scope, evaluatedCandidateCount: 10 } }), null);
  assert.equal(normalizeBallFitApiSuccess({ ...base, catalog: [] }), null);
});
