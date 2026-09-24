import assert from "node:assert/strict";
import test from "node:test";
import { captureCompletedRoundIndex } from "../lib/backyard-index-auto-capture";
import { calculateBackyardIndex } from "../lib/backyard-index";
import { curatedPueblaCourseProvider } from "../lib/curated-puebla-course-data";
import { teeAssignmentSnapshot } from "../lib/player-tee-assignments";
import { saveRoundHistoryLocalFirst } from "../lib/round-history-save";
import { STORAGE_KEYS } from "../lib/round-utils";
import { persistIndexPreference, readIndexPreference, type BackyardIndexPreference } from "../lib/backyard-index-preferences";
import type { RoundSnapshot } from "../lib/types";

const preference: BackyardIndexPreference = { version: 1, userId: "qa-owner", enabled: true, updatedAt: "2026-09-15T09:00:00.000Z", localPccZeroDeclaredAt: "2026-09-15T09:00:00.000Z" };
function completed(id = "qa-round"): RoundSnapshot {
  const course = curatedPueblaCourseProvider.getPlayableSelectionByTeeId("tee-el-cristo-blancas")!;
  const assignment = teeAssignmentSnapshot("p1", course, "2026-09-15T10:00:00.000Z");
  // Synthetic engine fixture: P05 deliberately no longer promotes El Cristo's
  // category-unknown club evidence into this contract.
  assignment.rating = 68.6;
  assignment.slope = 125;
  assignment.indexRatingEvidence = {
    kind: "OFFICIAL_RATED_TEE",
    authority: "Synthetic deterministic test authority",
    sourceUrl: "https://ratings.example.invalid/verified-tee",
    verifiedAt: "2026-09-15T09:00:00.000Z",
    courseId: course.catalogCourseId!,
    teeId: course.catalogTeeId!,
    courseRating: 68.6,
    slopeRating: 125,
  };
  return { id, ownerId: "p1", ownerName: "QA", courseName: course.name, teeName: course.teeName,
    lifecycleState: "completed", date: "2026-09-15", roundHoles: 18,
    startedAt: "2026-09-15T10:00:00.000Z", completedAt: "2026-09-15T15:00:00.000Z", updatedAt: "2026-09-15T15:00:00.000Z",
    players: [{ id: "p1", name: "QA", handicap: 9, accountUserId: preference.userId }],
    courseSnapshot: course, playerTeeAssignments: [assignment],
    order: course.holes.map((hole) => hole.number), scores: Object.fromEntries(course.holes.map((hole) => [hole.number, { p1: hole.par + 1 }])),
    betResult: 0, expenseTotal: 0, netResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, categoryResults: {},
  } as RoundSnapshot;
}

test("activación persistida → cierre → snapshot → outbox/reload → Índice sin volver al Perfil", async () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  persistIndexPreference(storage, { preference, pending: false });
  for (let index = 0; index < 3; index += 1) {
    const round = completed(`qa-round-${index}`);
    const captured = captureCompletedRoundIndex(round, preference.userId, readIndexPreference(storage, preference.userId)!.preference);
    const snapshot = captured.backyardIndexSnapshots![0];
    assert.equal(snapshot.eligible, true);
    assert.equal(snapshot.adjustedGrossScore, 90);
    assert.equal(snapshot.pccEvidence?.kind, "DECLARED_LOCAL_ZERO");
    assert.equal(snapshot.pccEvidence?.value, 0);
    assert.equal(snapshot.ratedTeeEvidence?.kind, "OFFICIAL_RATED_TEE");
    assert.equal(snapshot.activation?.localPccZeroDeclaredAt, preference.localPccZeroDeclaredAt);
    const saved = await saveRoundHistoryLocalFirst({ storage, ownerId: preference.userId, snapshot: captured,
      defaultHandicap: 9, deviceId: "qa-device", hasLocalPreferenceState: false, queueForCloud: true,
      persistOffline: async (ownerId, bundle, queued) => {
        assert.equal(ownerId, preference.userId); assert.equal(queued, true);
        assert.equal(bundle.activeDraft, null);
        assert.deepEqual(bundle.history.find((item) => item.id === round.id)?.backyardIndexSnapshots, captured.backyardIndexSnapshots);
        return "qa-fingerprint";
      } });
    assert.equal(saved.history.length, index + 1);
  }
  const reloaded = JSON.parse(storage.getItem(STORAGE_KEYS.history)!);
  const summary = calculateBackyardIndex(reloaded, preference.userId);
  assert.equal(summary.eligibleRoundCount, 3);
  assert.equal(summary.usedCount, 1);
  assert.equal(summary.value, summary.records[0].scoreDifferential! - 2);
});

test("off/no owner/no declaration/no verified tee never silently creates a differential", () => {
  const disabled = captureCompletedRoundIndex(completed(), preference.userId, null);
  assert.deepEqual(disabled.backyardIndexSnapshots![0].reasons, ["INDEX_NOT_ENABLED"]);
  assert.equal(disabled.backyardIndexSnapshots![0].scoreDifferential, undefined);
  assert.equal(captureCompletedRoundIndex(completed(), "other-owner", preference).backyardIndexSnapshots, undefined);
  const legacy = captureCompletedRoundIndex(completed(), preference.userId, { ...preference, localPccZeroDeclaredAt: null });
  assert.ok(legacy.backyardIndexSnapshots![0].reasons.includes("MISSING_PCC_EVIDENCE"));
  const unverified = completed();
  unverified.playerTeeAssignments![0].indexRatingEvidence = undefined;
  const captured = captureCompletedRoundIndex(unverified, preference.userId, preference);
  assert.ok(captured.backyardIndexSnapshots![0].reasons.includes("MISSING_OFFICIAL_TEE_RATING"));
  assert.equal(captured.backyardIndexSnapshots![0].scoreDifferential, undefined);
  assert.equal(captured.lifecycleState, "completed"); // Still playable/saveable.
});

test("incompleta/9H/HCP necesario persiste motivo legible para Histórico", () => {
  const incomplete = completed(); delete incomplete.scores![18];
  assert.ok(captureCompletedRoundIndex(incomplete, preference.userId, preference).backyardIndexSnapshots![0].reasons.includes("MISSING_HOLE_SCORES"));
  const nine = completed(); nine.roundHoles = 9; nine.order = nine.order!.slice(0, 9);
  assert.ok(captureCompletedRoundIndex(nine, preference.userId, preference).backyardIndexSnapshots![0].reasons.includes("NOT_COMPLETE_18_HOLES"));
  const missingHcp = completed(); missingHcp.players![0].handicapIndex = 7;
  assert.ok(captureCompletedRoundIndex(missingHcp, preference.userId, preference).backyardIndexSnapshots![0].reasons.includes("MISSING_COURSE_HANDICAP_FOR_ADJUSTMENT"));
});

test("tee/PCC/activación congelados sobreviven catálogo o preferencia nuevos y corrección idempotente", () => {
  const original = completed();
  const saved = captureCompletedRoundIndex(original, preference.userId, preference);
  const frozen = JSON.stringify(saved);
  original.courseSnapshot!.rating = 99;
  original.playerTeeAssignments![0].indexRatingEvidence!.courseRating = 99;
  assert.equal(JSON.stringify(saved), frozen);
  const correction = completed();
  const recalculated = captureCompletedRoundIndex(correction, preference.userId, { ...preference, enabled: false }, saved);
  assert.deepEqual(recalculated.backyardIndexSnapshots, saved.backyardIndexSnapshots);
  const moved = { ...completed(), date: "2026-09-16" };
  assert.ok(captureCompletedRoundIndex(moved, preference.userId, preference, saved).backyardIndexSnapshots![0].reasons.includes("MISSING_PCC_EVIDENCE"));
  const disabled = captureCompletedRoundIndex(completed("disabled"), preference.userId, null);
  assert.deepEqual(captureCompletedRoundIndex(completed("disabled"), preference.userId, preference, disabled).backyardIndexSnapshots![0].reasons, ["INDEX_NOT_ENABLED"]);
});
