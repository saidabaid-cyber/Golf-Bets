import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  emptyBackyardAiMetrics,
  recordRoundSetupMetrics,
  recordScorecardMetrics,
  recordScorecardOutcomeMetrics,
  summarizeBackyardAiMetrics,
} from "../lib/backyard-ai/observability/metrics";
import { scorecardCorrectionEvidenceForCell } from "../lib/backyard-ai/observability/scorecard-telemetry";
import type { ScorecardValidationIssue } from "../lib/backyard-ai/schemas/scorecard";

const NOW = "2026-09-08T12:00:00.000Z";
const lowConfidenceIssue: ScorecardValidationIssue = {
  id: "juan-14",
  code: "low_confidence_score",
  severity: "doubtful",
  resolution: "cell_value",
  message: "Parece 5, confirma el valor.",
  playerId: "juan",
  playerName: "Juan",
  hole: 14,
  candidateValue: 5,
  confidence: 0.61,
  source: { photoId: "photo-front" },
};

test("confirmar 5 como 5 resuelve la duda sin crear una corrección", () => {
  assert.equal(scorecardCorrectionEvidenceForCell(lowConfidenceIssue, { playerId: "juan", hole: 14, value: 5 }), null);
  assert.deepEqual(scorecardCorrectionEvidenceForCell(lowConfidenceIssue, { playerId: "juan", hole: 14, value: 6 }), {
    playerId: "juan",
    hole: 14,
    extractedScore: 5,
    correctedScore: 6,
    confidence: 0.61,
    source: "VISION",
    photoId: "photo-front",
    reason: "LOW_CONFIDENCE",
  });
});

test("una aclaración normal no incrementa AI_FAILURE", () => {
  const clarification = recordRoundSetupMetrics(emptyBackyardAiMetrics(NOW), {
    success: false,
    corrections: 0,
    questionCount: 1,
    durationMs: 250,
    confidence: 0.7,
    now: NOW,
  });
  assert.equal(clarification.aggregates.AI_FAILURE, undefined);
  assert.equal(summarizeBackyardAiMetrics(clarification).aiFailureRate, null);

  const terminalFailure = recordRoundSetupMetrics(clarification, {
    success: false,
    corrections: 0,
    questionCount: 0,
    durationMs: 100,
    now: NOW,
  });
  assert.equal(summarizeBackyardAiMetrics(terminalFailure).aiFailureRate, 1);
});

test("analizar una tarjeta no registra éxito ni PHOTO_TO_RESULT hasta alcanzar resultados", () => {
  const analyzed = recordScorecardMetrics(emptyBackyardAiMetrics(NOW), {
    detectedCells: 72,
    correctedCells: 0,
    averageConfidence: 0.94,
    now: NOW,
  });
  assert.equal(analyzed.aggregates.AI_FAILURE, undefined);
  assert.equal(analyzed.aggregates.PHOTO_TO_RESULT_MS, undefined);
  assert.equal(summarizeBackyardAiMetrics(analyzed).averagePhotoToResultMs, null);

  const result = recordScorecardOutcomeMetrics(analyzed, { outcome: "result", photoToResultMs: 1_250, now: NOW });
  assert.equal(summarizeBackyardAiMetrics(result).averagePhotoToResultMs, 1_250);
  assert.equal(summarizeBackyardAiMetrics(result).aiFailureRate, 0);
});

test("Card AI conserva el reloj ante capturas especiales y lo cierra sólo al entrar a Resultados", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const applyStart = page.indexOf("function applyScannedScorecard(");
  const applyEnd = page.indexOf("function confirmNewRound()", applyStart);
  const apply = page.slice(applyStart, applyEnd);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  assert.ok(apply.indexOf("if (incomplete)") < apply.indexOf("recordScorecardResultReached();"));
  assert.doesNotMatch(apply.slice(0, apply.indexOf("if (incomplete)")), /recordScorecardResultReached\(\)/);
  assert.match(page, /else \{ recordScorecardResultReached\(\); setTab\("results"\)/);
  assert.match(page, /onManualFallback=\{\(\) => \{ setScorecardScanStartedAt\(null\); setTab\("round"\); \}\}/);
  assert.match(page, /onCancel=\{\(\) => \{ setScorecardScanStartedAt\(null\); setTab\("round"\); \}\}/);
});
