import assert from "node:assert/strict";
import test from "node:test";

import { cloudDataFingerprint, findAmbiguousCloudConflicts, mergeLocalAndCloud, resolveAmbiguousCloudConflicts, stableValue, type CloudDataBundle, type CloudDataConflict } from "../lib/cloud-sync";
import { runCloudSyncCycle } from "../lib/cloud-sync-cycle";
import { readCloudBundle, writeCloudBundle } from "../lib/cloud-sync-service";
import type { RoundSnapshot } from "../lib/types";
import { CloudDb } from "./helpers/cloud-db";

function empty(deviceId: string): CloudDataBundle {
  return {
    version: 1,
    deviceId,
    history: [], frequentPlayers: [], frequentGroups: [], rivals: [], courses: [],
    preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null },
    activeDraft: null, tombstones: [],
  };
}

function round(score = 4) {
  return { roundId: "round-shared", players: [{ id: "player-said", name: "Said", handicap: 8 }], scores: { 5: { "player-said": score }, 6: { "player-said": 4 } }, bets: { skins: { enabled: true, value: 100 } } };
}

function historicalRound(patch: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    id: "history-round", date: "2026-09-06", courseName: "Campo", teeName: "General", ownerName: "Said",
    betResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0,
    netResult: 0, categoryResults: {},
    ...patch,
  };
}

test("lifecycle derivado no crea conflicto cuando terminar y capturar ocurren en dispositivos distintos", () => {
  const base = { roundId: "round-lifecycle", players: [{ id: "player-said", name: "Said", handicap: 8 }], scores: {}, reviewPending: false, lifecycleState: "draft" };
  const local = {
    ...empty("computer"),
    activeDraft: { ...base, scores: { 1: { "player-said": 4 } }, reviewPending: true, lifecycleState: "completed" },
    activeDraftUpdatedAt: "2026-09-06T12:02:00.000Z",
    baseDraft: base,
    baseDraftFingerprint: JSON.stringify(base),
  };
  const cloud = {
    ...empty("phone"),
    activeDraft: { ...base, scores: { 2: { "player-said": 5 } }, lifecycleState: "live" },
    activeDraftUpdatedAt: "2026-09-06T12:03:00.000Z",
  };

  assert.deepEqual(findAmbiguousCloudConflicts(local, cloud), []);
  const merged = mergeLocalAndCloud(local, cloud).activeDraft as typeof base & { scores: Record<number, Record<string, number>> };
  assert.equal(merged.lifecycleState, "completed");
  assert.equal(merged.reviewPending, true);
  assert.equal(merged.scores[1]["player-said"], 4);
  assert.equal(merged.scores[2]["player-said"], 5);
});

test("dos inicios offline conservan el primer instante y convergen sin conflicto falso", () => {
  const base = { roundId: "round-start", players: [{ id: "player-said", name: "Said", handicap: 8 }], scores: {}, lifecycleState: "draft" };
  const local = {
    ...empty("computer"),
    activeDraft: { ...base, startedAt: "2026-09-06T12:01:00.000Z", lifecycleState: "live" },
    activeDraftUpdatedAt: "2026-09-06T12:02:00.000Z",
    baseDraft: base,
    baseDraftFingerprint: JSON.stringify(base),
  };
  const cloud = {
    ...empty("phone"),
    activeDraft: { ...base, startedAt: "2026-09-06T12:00:00.000Z", scores: { 1: { "player-said": 4 } }, lifecycleState: "live" },
    activeDraftUpdatedAt: "2026-09-06T12:03:00.000Z",
  };

  assert.deepEqual(findAmbiguousCloudConflicts(local, cloud), []);
  const merged = mergeLocalAndCloud(local, cloud).activeDraft as typeof base & { startedAt: string; scores: Record<number, Record<string, number>> };
  assert.equal(merged.startedAt, "2026-09-06T12:00:00.000Z");
  assert.equal(merged.scores[1]["player-said"], 4);
  assert.equal(merged.lifecycleState, "live");
});

test("startedAt es monotónico para la misma ronda y no cruza a otra ronda", () => {
  const firstStart = "2026-09-06T12:00:00.000Z";
  const laterStart = "2026-09-06T12:01:00.000Z";
  const base = { roundId: "same-round", players: [{ id: "player-said", name: "Said", handicap: 8 }], scores: {}, startedAt: firstStart, lifecycleState: "live" };
  const staleClient = {
    ...empty("old-client"),
    activeDraft: { roundId: base.roundId, players: base.players, scores: { 1: { "player-said": 4 } }, lifecycleState: "live" },
    activeDraftUpdatedAt: "2026-09-06T12:03:00.000Z",
    baseDraft: base,
    baseDraftFingerprint: JSON.stringify(base),
  };
  const unchangedCloud = { ...empty("phone"), activeDraft: base, activeDraftUpdatedAt: "2026-09-06T12:02:00.000Z" };
  const preserved = mergeLocalAndCloud(staleClient, unchangedCloud).activeDraft as Record<string, unknown>;
  assert.equal(preserved.startedAt, firstStart);
  assert.deepEqual(findAmbiguousCloudConflicts(staleClient, unchangedCloud), []);

  const noBaseLocal = { ...empty("computer"), activeDraft: { ...base, startedAt: laterStart }, activeDraftUpdatedAt: "2026-09-06T12:05:00.000Z" };
  const noBaseCloud = { ...empty("phone"), activeDraft: base, activeDraftUpdatedAt: "2026-09-06T12:04:00.000Z" };
  assert.equal((mergeLocalAndCloud(noBaseLocal, noBaseCloud).activeDraft as Record<string, unknown>).startedAt, firstStart);

  const replacement = {
    ...empty("computer"),
    activeDraft: { roundId: "replacement-round", players: base.players, scores: {}, lifecycleState: "draft" },
    activeDraftUpdatedAt: "2026-09-06T12:06:00.000Z",
    baseDraft: base,
    baseDraftFingerprint: JSON.stringify(base),
  };
  const replaced = mergeLocalAndCloud(replacement, unchangedCloud).activeDraft as Record<string, unknown>;
  assert.equal(replaced.roundId, "replacement-round");
  assert.equal(replaced.startedAt, undefined);
  assert.equal(replaced.lifecycleState, "draft");
});

test("una corrección histórica hecha por un cliente viejo conserva el inicio original", () => {
  const firstStart = "2026-09-06T12:00:00.000Z";
  const local = { ...empty("old-client"), history: [historicalRound({ updatedAt: "2026-09-06T14:00:00.000Z", betResult: 250 })] };
  const cloud = { ...empty("phone"), history: [historicalRound({ startedAt: firstStart, updatedAt: "2026-09-06T13:00:00.000Z" })] };
  const merged = mergeLocalAndCloud(local, cloud).history[0];
  assert.equal(merged.startedAt, firstStart);
  assert.equal(merged.betResult, 250);
  assert.equal(merged.updatedAt, "2026-09-06T14:00:00.000Z");
});

test("startedAt no crea un conflicto histórico falso y sobrevive una resolución real", () => {
  const firstStart = "2026-09-06T12:00:00.000Z";
  const revision = "2026-09-06T14:00:00.000Z";
  const oldClientRound = historicalRound({ updatedAt: revision });
  const modernRound = historicalRound({ startedAt: firstStart, updatedAt: revision });
  const local = { ...empty("old-client"), history: [oldClientRound] };
  const cloud = { ...empty("phone"), history: [modernRound] };
  assert.deepEqual(findAmbiguousCloudConflicts(local, cloud), []);
  assert.equal(mergeLocalAndCloud(local, cloud).history[0].startedAt, firstStart);

  const localWithRealEdit = { ...local, history: [{ ...oldClientRound, betResult: 250 }] };
  const conflicts = findAmbiguousCloudConflicts(localWithRealEdit, cloud);
  assert.equal(conflicts.length, 1);
  assert.equal((conflicts[0].localValue as RoundSnapshot).startedAt, firstStart);
  const resolved = resolveAmbiguousCloudConflicts(localWithRealEdit, cloud, conflicts, "local", "2026-09-06T15:00:00.000Z");
  assert.equal(resolved.history[0].betResult, 250);
  assert.equal(resolved.history[0].startedAt, firstStart);
});

test("dos dispositivos descargan, editan, trabajan offline y convergen sin duplicados ni conflictos falsos", async () => {
  const db = new CloudDb();
  const userId = "auth-user-shared";
  type Device = { data: CloudDataBundle; conflicts: CloudDataConflict[] };
  const deviceA: Device = { data: { ...empty("computer"), activeDraft: round(), activeDraftUpdatedAt: "2026-09-04T12:00:00.000Z" }, conflicts: [] };
  const deviceB: Device = { data: empty("phone"), conflicts: [] };

  const sync = async (device: Device, online = true) => runCloudSyncCycle({
    read: () => structuredClone(device.data),
    download: async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return readCloudBundle(db.client, userId, true);
    },
    upload: async data => {
      if (!online) throw new TypeError("Failed to fetch");
      await writeCloudBundle(db.client, userId, { data, fingerprint: cloudDataFingerprint(data) }, { extendedSchema: true });
    },
    media: async () => {},
    apply: data => { device.data = { ...structuredClone(data), deviceId: device.data.deviceId }; },
    current: () => true,
    status: () => {},
    conflicts: (local, cloud) => {
      device.conflicts = findAmbiguousCloudConflicts(local, cloud);
      return device.conflicts.length > 0;
    },
  });

  assert.equal(await sync(deviceA), true);
  assert.equal(await sync(deviceB), true);
  assert.deepEqual(deviceB.data.activeDraft, deviceA.data.activeDraft);
  assert.equal(deviceB.conflicts.length, 0);

  const phoneDraft = structuredClone(deviceB.data.activeDraft) as ReturnType<typeof round>;
  phoneDraft.scores[5]["player-said"] = 3;
  deviceB.data.activeDraft = phoneDraft;
  // Deliberately behind the cloud clock: three-way merge, not wall time, must win.
  deviceB.data.activeDraftUpdatedAt = "2026-09-04T11:59:00.000Z";
  await assert.rejects(() => sync(deviceB, false), /Failed to fetch/);
  assert.equal((deviceB.data.activeDraft as ReturnType<typeof round>).scores[5]["player-said"], 3);

  assert.equal(await sync(deviceB), true);
  assert.equal(await sync(deviceA), true);
  assert.equal((deviceA.data.activeDraft as ReturnType<typeof round>).scores[5]["player-said"], 3);
  assert.equal(deviceA.conflicts.length, 0);
  assert.equal(db.rows("user_cloud_state").length, 1);
  assert.equal(db.rows("user_devices").length, 2);

  // Both devices now share the same canonical base. Only an edit of the exact
  // same player/hole is ambiguous.
  const commonA = structuredClone(deviceA.data);
  const commonB = structuredClone(deviceB.data);
  const draftA = structuredClone(commonA.activeDraft) as ReturnType<typeof round>;
  const draftB = structuredClone(commonB.activeDraft) as ReturnType<typeof round>;
  draftA.scores[5]["player-said"] = 2;
  draftB.scores[5]["player-said"] = 5;
  commonA.activeDraft = draftA; commonA.activeDraftUpdatedAt = "2026-09-04T12:02:00.000Z";
  commonB.activeDraft = draftB; commonB.activeDraftUpdatedAt = "2026-09-04T12:03:00.000Z";
  deviceA.data = commonA; deviceB.data = commonB;
  assert.equal(await sync(deviceA), true);
  assert.equal(await sync(deviceB), false);
  assert.equal(deviceB.conflicts.length, 1);
  assert.equal(deviceB.conflicts[0].fieldPath, "/scores/5/player-said");

  const cloud = await readCloudBundle(db.client, userId, true);
  deviceB.data = { ...resolveAmbiguousCloudConflicts(deviceB.data, cloud, deviceB.conflicts, "cloud", "2026-09-04T12:04:00.000Z"), deviceId: "phone" };
  deviceB.conflicts = [];
  assert.equal(await sync(deviceB), true);
  assert.equal(await sync(deviceA), true);
  assert.equal(findAmbiguousCloudConflicts(deviceB.data, await readCloudBundle(db.client, userId, true)).length, 0);
  assert.equal(JSON.stringify(stableValue(deviceA.data.activeDraft)), JSON.stringify(stableValue(deviceB.data.activeDraft)));
  assert.equal(db.rows("user_cloud_state").length, 1);
});
