import assert from "node:assert/strict";
import test from "node:test";

import { cloudDataFingerprint, findAmbiguousCloudConflicts, resolveAmbiguousCloudConflicts, stableValue, type CloudDataBundle, type CloudDataConflict } from "../lib/cloud-sync";
import { runCloudSyncCycle } from "../lib/cloud-sync-cycle";
import { readCloudBundle, writeCloudBundle } from "../lib/cloud-sync-service";
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
