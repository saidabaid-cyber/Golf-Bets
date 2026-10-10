import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { patchSharedScores, sharedEditablePlayers, sharedRoundComplete, SharedLiveError, type SharedScorePatch } from "../lib/shared-round-live";
import { finalizeSharedRound } from "../lib/shared-round-finalize";
import { initialBets } from "../lib/new-round-bets";
import { DEFAULT_LA_VISTA_COURSE as laVista } from "../lib/golf-course-directory";
import type { RoundSnapshot } from "../lib/types";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const now = "2026-10-09T18:00:00Z";
function card(): RoundSnapshot { return { id: "qa-only", date: "2026-10-09", lifecycleState: "live", startedAt: now,
  scorekeeping: { version: 1, mode: "self", organizerAccountUserId: A }, ownerId: "a", ownerName: "A", courseName: "QA", teeName: "QA",
  courseSnapshot: laVista, betConfig: initialBets([]), players: [{ id: "a", name: "A", accountUserId: A, handicap: null }, { id: "b", name: "B", accountUserId: B, handicap: null }, { id: "guest", name: "Guest", handicap: null }],
  order: [1, 2, 3], scores: {}, presentation: { version: 1, groupNassauTerm: "polla", playMode: "score_only" },
  betResult: 0, netResult: 0, categoryResults: {}, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0 }; }
const patch = (playerKey = "a", hole = 1, score: number | null = 4, baseVersion = 1) => ({ id: randomUUID(), playerKey, hole, score, baseVersion });
function apply(round: RoundSnapshot, actor = A, changes: SharedScorePatch[] = [patch()], version = 1) { return patchSharedScores("canonical", A, version, round, actor, changes, now); }
const code = (name: string) => (e: unknown) => e instanceof SharedLiveError && e.code === name;

test("self capture permissions use account identity; owner captures guests only alongside own card", () => {
  assert.deepEqual(sharedEditablePlayers(card(), A, A), ["a", "guest"]);
  assert.deepEqual(sharedEditablePlayers(card(), A, B), ["b"]);
  assert.deepEqual(sharedEditablePlayers(card(), A, C), []);
  assert.throws(() => apply(card(), B, [patch("a")]), code("FORBIDDEN"));
  assert.throws(() => apply(card(), A, [patch("b")]), code("FORBIDDEN"));
  assert.throws(() => apply(card(), C), code("FORBIDDEN"));
});
test("owner mode allows partial capture for any player and rejects participant writes", () => {
  const round = card(); round.scorekeeping!.mode = "owner";
  const result = apply(round, A, [patch("b")]);
  assert.equal(result.snapshot.scores![1].b, 4); assert.equal(result.snapshot.scores![1].a, undefined);
  assert.throws(() => apply(round, B, [patch("b")]), code("FORBIDDEN"));
});
test("different participant writes from same revision merge without changing another cell", () => {
  const first = apply(card()).snapshot;
  const second = apply(first, B, [patch("b", 1, 5)], 2).snapshot;
  assert.deepEqual(second.scores![1], { a: 4, b: 5 });
  assert.equal(second.sharedLive!.audit[1].actorId, B);
  assert.equal(second.sharedLive!.cellVersions["SCORE_SET:1:b"], 3);
});
test("same cell stale write rejects explicitly and keeps committed value", () => {
  const first = apply(card()).snapshot;
  assert.throws(() => apply(first, A, [patch("a", 1, 6)], 2), code("SCORE_CONFLICT"));
  assert.equal(first.scores![1].a, 4);
  assert.equal(apply(first, A, [patch("a", 1, 6, 2)], 2).snapshot.scores![1].a, 6);
});
test("same participant may save another hole from previous overall revision", () => {
  const result = apply(apply(card()).snapshot, A, [patch("a", 2, 5)], 2);
  assert.equal(result.snapshot.scores![1].a, 4); assert.equal(result.snapshot.scores![2].a, 5);
});
test("retry is idempotent, changed payload with same operation id rejected", () => {
  const operation = patch(); const first = apply(card(), A, [operation]).snapshot;
  const retry = apply(first, A, [operation], 2); assert.equal(retry.applied, false); assert.equal(retry.snapshot.sharedLive!.audit.length, 1);
  assert.throws(() => apply(first, A, [{ ...operation, score: 7 }], 2), code("IDEMPOTENCY_CONFLICT"));
});
test("join metadata does not remove the fence on older owner scores", () => {
  const round = card(); round.scores = { 1: { a: 4 } }; round.sharedLive = { cellVersions: {}, audit: [], operationIds: [], joinedUserIds: [B] };
  assert.throws(() => apply(round, A, [patch("a", 1, 6, 1)], 3), code("SCORE_CONFLICT"));
});
test("putts and scores each have a revision; unrelated optional putts preserved", () => {
  const round = apply(card(), A, [{ ...patch(), putts: 2 }]).snapshot;
  const second = apply(round, B, [{ ...patch("b", 1, 5), putts: 3 }], 2).snapshot;
  assert.deepEqual(second.putts![1], { a: 2, b: 3 }); assert.equal(second.sharedLive!.audit.length, 4);
});
test("invalid holes, revisions, score values and operations rejected", () => {
  for (const p of [patch("a", 19), patch("a", 1, 0), patch("a", 1, 21), patch("a", 1, 4, 9), { ...patch(), id: "bad" }]) assert.throws(() => apply(card(), A, [p]), code("INVALID_REQUEST"));
});
test("closed cards cannot be edited and partial cards cannot finalize", () => {
  for (const lifecycleState of ["completed", "cancelled"] as const) assert.throws(() => apply({ ...card(), lifecycleState }), code("ROUND_CLOSED"));
  assert.equal(sharedRoundComplete(apply(card()).snapshot), false);
  assert.throws(() => finalizeSharedRound(apply(card()).snapshot, now), code("INCOMPLETE_CARD"));
});
test("canonical completion preserves ids, account links, scores and guest; score-only skips handicap/money engines", () => {
  const round = card(); round.scores = Object.fromEntries(round.order!.map(h => [h, { a: 4, b: 5, guest: 6 }]));
  const finished = finalizeSharedRound(round, now);
  assert.equal(finished.id, round.id); assert.deepEqual(finished.players, round.players); assert.deepEqual(finished.scores, round.scores);
  assert.equal(finished.lifecycleState, "completed"); assert.equal(finished.playerBalances!.b, 0); assert.equal(round.lifecycleState, "live");
});
