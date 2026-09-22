import assert from "node:assert/strict";
import test from "node:test";
import { commitScorecardVision, confirmScorecardVision, detectScorecardVision, reviewScorecardVision, type VisionEvidence, type VisionRound } from "../lib/scorecard-vision/review";
import { runBettingDataActionWithConsent } from "../lib/backyard-ai/runtime/betting-consent-boundary";
import { resolvePhase2FeatureFlags } from "../features/feature-flags/registry";
import { normalizeScorecardExtraction } from "../lib/backyard-ai/scorecard/extractor";

// Wholly synthetic readings; no image was recognized and no catalog row is created.
function fixture(roundHoles: 9 | 18 = 18, startHole: 1 | 10 = 1) {
  const holes = Array.from({ length: roundHoles }, (_, i) => (i + startHole - 1) % 18 + 1);
  const round: VisionRound = {
    roundId: "synthetic-vision-round", players: [{ id: "qa-a", name: "QA Persona A" }],
    course: { id: "synthetic-course", name: "Campo sintético de pruebas", holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4 })) },
    tees: [{ id: "synthetic-white", name: "Blancas QA" }], startHole, roundHoles,
  };
  const source = { photoId: "synthetic-image-1" };
  const raw = { version: 1,
    course: { value: round.course.name, confidence: 0.98, source },
    players: [{ playerName: "QA Persona A", confidence: 0.99, source }],
    cells: holes.map(hole => ({ playerName: "QA Persona A", hole, value: 4, confidence: 0.99, source })),
    totals: [
      ...(holes.includes(1) ? [{ playerName: "QA Persona A", kind: "out", value: 36, confidence: 0.99, source }] : []),
      ...(holes.includes(10) ? [{ playerName: "QA Persona A", kind: "in", value: 36, confidence: 0.99, source }] : []),
      { playerName: "QA Persona A", kind: "total", value: roundHoles * 4, confidence: 0.99, source },
    ],
  };
  const parsed = normalizeScorecardExtraction(raw);
  assert.ok(parsed.ok);
  const evidence: VisionEvidence = { version: 1, extraction: parsed.extraction, detectedTee: { value: "Blancas QA", confidence: 0.99, source }, provenance: "synthetic_fixture" };
  return { round, evidence, raw };
}

for (const environment of ["development", "preview", "production", "test"] as const) {
  test(`Vision is disabled by default in ${environment}`, () => assert.equal(resolvePhase2FeatureFlags(environment).scorecard_vision_v1, false));
}
for (const count of [9, 18] as const) for (const start of [1, 10] as const) {
  test(`Vision ${count} holes starting ${start}: confidence, source and validated totals`, () => {
    const { evidence, round } = fixture(count, start);
    const before = JSON.stringify({ evidence, round });
    const review = reviewScorecardVision(evidence, round);
    assert.equal(review.ready, true);
    assert.equal(review.validation.acceptedCells.length, count);
    assert.equal(review.sourceImageId, "synthetic-image-1");
    assert.ok(review.confidence.every(field => field.value >= 0 && field.value <= 1));
    assert.equal(review.total[0].value, 4 * count);
    assert.equal(JSON.stringify({ evidence, round }), before);
    assert.equal(reviewScorecardVision(evidence, round).confirmationKey, review.confirmationKey);
    assert.deepEqual(confirmScorecardVision({ evidence, currentRound: round, overrides: {}, confirmed: true, confirmationKey: review.confirmationKey }), { ok: false, reason: "fixture_not_importable" });
  });
}
test("Vision requires explicit confirmation and rejects stale round revisions", () => {
  const { evidence, round } = fixture();
  const review = reviewScorecardVision(evidence, round);
  assert.deepEqual(confirmScorecardVision({ evidence, currentRound: round, overrides: {}, confirmed: false, confirmationKey: review.confirmationKey }), { ok: false, reason: "confirmation_required" });
  round.digitalScores = { 1: { "qa-a": 5 } };
  assert.deepEqual(confirmScorecardVision({ evidence, currentRound: round, overrides: {}, confirmed: true, confirmationKey: review.confirmationKey }), { ok: false, reason: "stale_review" });
});
test("Vision rejects changed evidence and changed corrections after preview", () => {
  const { evidence, round } = fixture();
  const review = reviewScorecardVision(evidence, round);
  for (const overrides of [{ confirmedTeeId: "synthetic-white" }, { cells: [{ playerId: "qa-a", hole: 1, value: 5 }] }]) {
    assert.deepEqual(confirmScorecardVision({ evidence, currentRound: round, overrides, confirmed: true, confirmationKey: review.confirmationKey }), { ok: false, reason: "stale_review" });
  }
  evidence.extraction.cells[0].confidence = 0.96;
  assert.deepEqual(confirmScorecardVision({ evidence, currentRound: round, overrides: {}, confirmed: true, confirmationKey: review.confirmationKey }), { ok: false, reason: "stale_review" });
});
test("unknown tee and unverified color are unresolved; only a round tee is accepted", () => {
  const { evidence, round } = fixture();
  evidence.detectedTee!.value = "Azules";
  assert.ok(reviewScorecardVision(evidence, round).unresolvedFields.includes("tee"));
  assert.equal(reviewScorecardVision(evidence, round, { confirmedTeeId: "invented" }).ready, false);
  assert.equal(reviewScorecardVision(evidence, round, { confirmedTeeId: "synthetic-white" }).ready, true);
  round.tees = [];
  assert.equal(reviewScorecardVision(evidence, round, { confirmedTeeId: "synthetic-white" }).ready, false);
});
test("missing course requires human confirmation; unknown players never become guests automatically", () => {
  const { evidence, round } = fixture();
  evidence.extraction.course = null;
  evidence.extraction.courses = [];
  assert.ok(reviewScorecardVision(evidence, round).unresolvedFields.includes("course:absent"));
  assert.equal(reviewScorecardVision(evidence, round, { acceptCourseMismatch: true }).ready, true);
  evidence.extraction.players[0].playerName = "Guest desconocido";
  evidence.extraction.cells[0].playerName = "Guest desconocido";
  assert.equal(reviewScorecardVision(evidence, round, { acceptCourseMismatch: true }).ready, false);
  assert.equal(round.players.length, 1);
});
test("inconsistent front/back/total and missing Par remain blocking", () => {
  const { evidence, round } = fixture();
  evidence.extraction.totals[2].value = 71;
  assert.equal(reviewScorecardVision(evidence, round).ready, false);
  evidence.extraction.totals[2].value = 72;
  round.course.holes = [];
  assert.equal(reviewScorecardVision(evidence, round).ready, false);
});
for (const invalid of [0, -1, 21]) test(`Vision blocks score ${invalid} without fabricating a replacement`, () => {
  const { evidence, round } = fixture();
  evidence.extraction.cells[0].value = invalid;
  const result = reviewScorecardVision(evidence, round);
  assert.equal(result.ready, false);
  assert.equal(result.validation.acceptedScores[1]?.["qa-a"], undefined);
});
test("fractional hole scores fail the evidence schema before review", () => {
  const { evidence, round } = fixture();
  evidence.extraction.cells[0].value = 4.5;
  assert.throws(() => reviewScorecardVision(evidence, round), /invalid_vision_evidence/);
});
test("low-confidence or missing cell is corrected manually and historical overwrite is warned", () => {
  const { evidence, round } = fixture();
  evidence.extraction.cells[0].value = null;
  evidence.extraction.cells[0].confidence = 0.2;
  round.digitalScores = { 1: { "qa-a": 5 } };
  const result = reviewScorecardVision(evidence, round, { cells: [{ playerId: "qa-a", hole: 1, value: 4 }] });
  assert.equal(result.ready, true);
  assert.ok(result.warnings.some(w => w.includes("1 scores ya capturados")));
  assert.equal(round.digitalScores[1]["qa-a"], 5);
});
test("a total alone never fabricates per-hole scores", () => {
  const { evidence, round } = fixture();
  evidence.extraction.cells = [];
  const result = reviewScorecardVision(evidence, round);
  assert.equal(result.ready, false);
  assert.deepEqual(result.validation.acceptedScores, {});
});
test("provider unavailable is BLOCKED_EXTERNAL and never invoked", async () => {
  const source = { sourceImageId: "synthetic", image: new Blob(["synthetic"], { type: "image/png" }) };
  assert.deepEqual(await detectScorecardVision(null, source), { status: "BLOCKED_EXTERNAL", evidence: null });
  const result = await detectScorecardVision({ configured: false, extract: async () => { throw new Error("must not run"); } }, source);
  assert.equal(result.status, "BLOCKED_EXTERNAL");
});
test("provider adapter validates evidence and enforces authoritative source; fixture provider only", async () => {
  const { raw } = fixture();
  const source = { sourceImageId: "synthetic-image-1", image: new Blob(["synthetic"], { type: "image/png" }) };
  const result = await detectScorecardVision({ configured: true, extract: async () => raw }, source);
  assert.equal(result.status, "PASS");
  await assert.rejects(detectScorecardVision({ configured: true, extract: async () => raw }, { ...source, sourceImageId: "wrong-image" }), /invalid_vision_evidence/);
  await assert.rejects(detectScorecardVision({ configured: true, extract: async () => raw }, { ...source, image: new Blob(["bad"], { type: "text/html" }) }), /invalid_vision_image/);
});
test("confirmation returns detached validated import command, no persistence side effect", () => {
  const { evidence, round } = fixture();
  // Contract-level provider response fixture, explicitly not a real OCR test.
  evidence.provenance = "provider";
  const review = reviewScorecardVision(evidence, round);
  const command = confirmScorecardVision({ evidence, currentRound: round, overrides: {}, confirmed: true, confirmationKey: review.confirmationKey });
  assert.ok(command.ok);
  assert.equal(command.roundId, round.roundId);
  command.validation.acceptedScores[1]["qa-a"] = 9;
  assert.equal(evidence.extraction.cells[0].value, 4);
  assert.equal(round.digitalScores, undefined);
});
test("deferred consent uses latest persistence callback and rejects non-score revision changes", async () => {
  const { evidence, round } = fixture();
  evidence.provenance = "provider";
  round.revision = JSON.stringify({ putts: 2, lifecycle: "live", rules: "original" });
  let persisted = "none";
  let current = { evidence, currentRound: round, overrides: {}, persist: () => { persisted = "obsolete"; return true; } };
  let release!: (accepted: boolean) => void;
  const wait = () => new Promise<boolean>(resolve => { release = resolve; });
  const key = reviewScorecardVision(evidence, round).confirmationKey;
  const pending = runBettingDataActionWithConsent(true, () => commitScorecardVision(key, () => current), wait);
  current = { ...current, persist: () => { persisted = "latest"; return true; } };
  release(true);
  assert.deepEqual(await pending, { status: "APPLIED", value: { ok: true, persisted: true } });
  assert.equal(persisted, "latest");
  persisted = "none";
  const changed = runBettingDataActionWithConsent(true, () => commitScorecardVision(key, () => current), wait);
  current = { ...current, currentRound: { ...round, revision: JSON.stringify({ putts: 1, lifecycle: "cancelled", rules: "updated" }) } };
  release(true);
  assert.deepEqual(await changed, { status: "APPLIED", value: { ok: false, reason: "stale_review" } });
  assert.equal(persisted, "none");
});
