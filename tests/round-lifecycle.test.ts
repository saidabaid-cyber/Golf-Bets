import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveRoundLifecycleState,
  markRoundDraftCancelled,
  normalizeHistoricalRoundLifecycle,
  withDerivedRoundLifecycle,
} from "../lib/round-lifecycle";

test("an empty configured round remains a draft until a score is confirmed", () => {
  const draft = withDerivedRoundLifecycle({ roundId: "round-1", players: [{ id: "a" }], scores: {}, scoreEdits: { 1: { a: 4 } } });
  assert.equal(draft.lifecycleState, "draft");
});

test("a confirmed score makes the current round live", () => {
  assert.equal(deriveRoundLifecycleState({ scores: { 1: { a: 4, b: null } } }), "live");
});

test("an explicit valid start makes a scoreless round live", () => {
  assert.equal(deriveRoundLifecycleState({ startedAt: "2026-09-06T12:00:00.000Z", scores: {} }), "live");
  assert.equal(deriveRoundLifecycleState({ startedAt: "not-a-date", scores: {} }), "draft");
  assert.equal(deriveRoundLifecycleState({ startedAt: "2026-09-06", scores: {} }), "draft");
  assert.equal(deriveRoundLifecycleState({ startedAt: "", scores: {} }), "draft");
});

test("pending review is completed even when scores exist", () => {
  assert.equal(deriveRoundLifecycleState({ reviewPending: true, scores: { 18: { a: 4 } } }), "completed");
  assert.equal(deriveRoundLifecycleState({ reviewPending: true, startedAt: "2026-09-06T12:00:00.000Z" }), "completed");
});

test("legacy historical snapshots normalize to completed without mutating the source", () => {
  const legacy = { id: "legacy-round", scores: { 1: { a: 4 } } };
  const normalized = normalizeHistoricalRoundLifecycle(legacy);
  assert.equal(normalized.lifecycleState, "completed");
  assert.equal("lifecycleState" in legacy, false);
});

test("explicit historical lifecycle states remain intact", () => {
  for (const lifecycleState of ["draft", "live", "completed", "cancelled"] as const) {
    assert.equal(normalizeHistoricalRoundLifecycle({ lifecycleState }).lifecycleState, lifecycleState);
  }
  assert.equal(normalizeHistoricalRoundLifecycle({ lifecycleState: "corrupt" }).lifecycleState, "completed");
});

test("starting another round produces a recoverable cancelled copy only", () => {
  const active = { roundId: "round-1", startedAt: "2026-09-06T07:00:00.000Z", scores: { 1: { a: 4 } }, lifecycleState: "live" };
  const cancelled = markRoundDraftCancelled(active, "2026-09-06T08:00:00.000Z");
  assert.equal(cancelled.lifecycleState, "cancelled");
  assert.equal(cancelled.cancelledAt, "2026-09-06T08:00:00.000Z");
  assert.equal(active.lifecycleState, "live");
  assert.equal(cancelled.startedAt, active.startedAt);
  assert.deepEqual(cancelled.scores, active.scores);
});
