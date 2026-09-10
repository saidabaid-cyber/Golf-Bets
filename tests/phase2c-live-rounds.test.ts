import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyLiveRoundOperation, buildLiveScoreboard, canEditLiveRoundOperation, canViewLiveRound, type LiveRoundOperation, type LiveRoundState } from "../features/live-rounds/domain";
import { InMemoryLiveRoundRealtimeProvider } from "../features/live-rounds/realtime-provider";
import { acknowledgeRoundOperation, enqueueRoundOperation, failRoundOperation, readyRoundOperations } from "../features/live-rounds/offline-queue";
import { activityFromScoreOperation, compactRoundActivity } from "../features/live-rounds/activity";
import { defaultNotificationPreferences, deliveryChannels, type NotificationEvent } from "../features/notifications/domain";
import { unavailablePushProvider } from "../features/notifications/push-provider";
import type { Course, Player } from "../lib/types";

const root = process.cwd();
const state: LiveRoundState = { id: "r1", ownerId: "owner", version: 1, lifecycle: "LIVE", participants: [
  { id: "rp1", roundId: "r1", userId: "owner", playerId: "p1", role: "ORGANIZER", joinedAt: "2026-09-10T00:00:00Z" },
  { id: "rp2", roundId: "r1", userId: "u2", playerId: "p2", role: "PLAYER", joinedAt: "2026-09-10T00:00:00Z" },
  { id: "rp3", roundId: "r1", userId: "u3", playerId: "p3", role: "VIEWER", joinedAt: "2026-09-10T00:00:00Z" },
], scores: {}, putts: {}, stats: {}, appliedOperationIds: [], cellVersions: {}, updatedAt: "2026-09-10T00:00:00Z" };

function scoreOperation(overrides: Partial<LiveRoundOperation> = {}): LiveRoundOperation {
  return { id: "op1", roundId: "r1", actorId: "u2", kind: "SCORE_SET", playerId: "p2", hole: 1, value: 4, baseVersion: 0, createdAt: "2026-09-10T00:01:00Z", ...overrides };
}

test("live round permissions let players edit only their own card", () => {
  assert.equal(canViewLiveRound(state, "u2"), true);
  assert.equal(canViewLiveRound(state, "stranger"), false);
  assert.equal(canEditLiveRoundOperation(state, scoreOperation()), true);
  assert.equal(canEditLiveRoundOperation(state, scoreOperation({ playerId: "p1" })), false);
  assert.equal(canEditLiveRoundOperation(state, scoreOperation({ actorId: "u3" })), false);
  assert.equal(canEditLiveRoundOperation(state, scoreOperation({ actorId: "owner", kind: "ROUND_SETTINGS_PATCH", hole: undefined, playerId: undefined, value: {} })), true);
});

test("live operations are idempotent and conflict only on the same newer cell", () => {
  const first = applyLiveRoundOperation(state, scoreOperation());
  assert.equal(first.applied, true);
  assert.equal(first.state.scores[1].p2, 4);
  assert.equal(applyLiveRoundOperation(first.state, scoreOperation()).applied, false);
  const conflict = applyLiveRoundOperation(first.state, scoreOperation({ id: "op2", value: 5, baseVersion: 0 }));
  assert.equal(conflict.applied, false);
  assert.equal(conflict.conflict?.cellKey, "SCORE_SET:1:p2");
  const otherHole = applyLiveRoundOperation(first.state, scoreOperation({ id: "op3", hole: 2, value: 5, baseVersion: 0 }));
  assert.equal(otherHole.applied, true);
});

test("offline queue deduplicates, backs off and acknowledges exact operations", () => {
  const queued = enqueueRoundOperation(enqueueRoundOperation([], scoreOperation()), scoreOperation());
  assert.equal(queued.length, 1);
  const failed = failRoundOperation(queued, "op1", "2026-09-10T00:02:00Z", "network");
  assert.equal(failed[0].attempts, 1);
  assert.equal(readyRoundOperations(failed, "2026-09-10T00:02:00Z").length, 0);
  assert.deepEqual(acknowledgeRoundOperation(failed, "op1"), []);
});

test("realtime provider rejects strangers and transports operations without owning domain state", async () => {
  const provider = new InMemoryLiveRoundRealtimeProvider();
  provider.seed(state);
  assert.equal(await provider.fetch("r1", "stranger"), null);
  const received: string[] = [];
  const unsubscribe = await provider.subscribe("r1", "u2", (operation) => received.push(operation.id));
  await provider.publish(scoreOperation());
  unsubscribe();
  assert.deepEqual(received, ["op1"]);
});

test("live scoreboard reuses Phase 1 golf math and canonical zero-sum balances", () => {
  const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
  const course: Course = { id: "c1", name: "La Vista", teeName: "Blancas", holes };
  const players: Player[] = [{ id: "p1", name: "Said", handicap: 8 }, { id: "p2", name: "Pedro", handicap: 10 }];
  const scores = { 1: { p1: 4, p2: 5 } };
  const scoreboard = buildLiveScoreboard({ course, players, scores, order: holes.map((hole) => hole.number), deterministic: { engineVersion: "phase1", balances: { p1: 100, p2: -100 }, calculatedAt: "2026-09-10T00:00:00Z" } });
  assert.equal(scoreboard.status, "PROVISIONAL");
  assert.equal(scoreboard.golf[0].thru, 1);
  assert.equal(scoreboard.balances.p1, 100);
  assert.throws(() => buildLiveScoreboard({ course, players, scores, order: [1], deterministic: { engineVersion: "phase1", balances: { p1: 100 }, calculatedAt: "2026-09-10T00:00:00Z" } }), /suma cero/);
});

test("activity is private, deduped and grouped by score cell", () => {
  const event = activityFromScoreOperation(scoreOperation(), 5);
  assert.equal(event?.type, "BIRDIE");
  assert.equal(compactRoundActivity([event!, event!, { ...event!, id: "another", occurredAt: "2026-09-10T00:02:00Z" }]).length, 1);
});

test("notification channels honor preference and push remains fail-closed", async () => {
  const preferences = defaultNotificationPreferences("u2", "2026-09-10T00:00:00Z");
  const event: NotificationEvent = { id: "n1", recipientId: "u2", type: "round_invite", resourceType: "ROUND", resourceId: "r1", createdAt: "2026-09-10T00:00:00Z" };
  assert.deepEqual(deliveryChannels(event, preferences, false), ["IN_APP"]);
  assert.equal((await unavailablePushProvider.send(event)).delivered, false);
});

test("Phase 2C migration is private, idempotent and never exposes realtime publicly", () => {
  const migration = readFileSync(`${root}/supabase/migrations/202609100003_phase2_live_rounds_notifications.sql`, "utf8");
  for (const table of ["round_participants_v2", "live_round_operations_v2", "round_activity_v2", "notification_preferences_v2", "notification_events_v2"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /private\.has_round_participation/);
  assert.match(migration, /private\.can_read_round_player/);
  assert.match(migration, /rounds participant read v2/);
  assert.match(migration, /round players participant read v2/);
  assert.match(migration, /round scores participant read v2/);
  assert.doesNotMatch(migration, /alter publication|drop table|truncate table/i);
});
