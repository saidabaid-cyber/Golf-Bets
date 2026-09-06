import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgePendingProfileWrite,
  cloudProfileRevisionIsNewer,
  createProfileWriteCoordinator,
  queuePendingProfileWrite,
  readPendingProfileWrite,
  recordCloudProfileRevision,
  retimePendingProfileWrite,
} from "../lib/profile-sync";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

test("perfil pendiente conserva HCP plus y normaliza texto antes del retry", () => {
  const storage = new MemoryStorage();
  const pending = queuePendingProfileWrite(storage, "user-a", { displayName: " Said ", defaultHandicap: -1.2, avatarUrl: " avatar " }, "2026-09-06T12:00:00.000Z");
  assert.deepEqual(pending.profile, { displayName: "Said", defaultHandicap: -1.2, avatarUrl: "avatar" });
  assert.deepEqual(readPendingProfileWrite(storage, "user-a"), pending);
});

test("ack tardío no borra una edición de perfil más nueva", () => {
  const storage = new MemoryStorage();
  const first = queuePendingProfileWrite(storage, "user-a", { displayName: "Primero", defaultHandicap: 8, avatarUrl: "" }, "2026-09-06T12:00:00.000Z", "revision-a");
  const latest = queuePendingProfileWrite(storage, "user-a", { displayName: "Después", defaultHandicap: 7, avatarUrl: "" }, "2026-09-06T12:00:00.000Z", "revision-b");
  assert.notEqual(first.updatedAt, latest.updatedAt);
  assert.equal(acknowledgePendingProfileWrite(storage, "user-a", first.revision), false);
  assert.deepEqual(readPendingProfileWrite(storage, "user-a"), latest);
  assert.equal(acknowledgePendingProfileWrite(storage, "user-a", latest.revision), true);
  assert.equal(readPendingProfileWrite(storage, "user-a"), null);
});

test("payload corrupto no se reintenta como perfil scratch", () => {
  const storage = new MemoryStorage();
  storage.setItem("backyard-profile-write-v1:user-a", JSON.stringify({ profile: { displayName: "Said", defaultHandicap: 7, avatarUrl: "" }, updatedAt: "now" }));
  assert.equal(readPendingProfileWrite(storage, "user-a"), null);
});

test("las escrituras de perfil llegan al servidor en orden", async () => {
  const coordinator = createProfileWriteCoordinator();
  const events: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const first = coordinator.run(async () => {
    events.push("start:first");
    markFirstStarted();
    await firstGate;
    events.push("end:first");
  });
  const second = coordinator.run(async () => {
    events.push("start:second");
    events.push("end:second");
  });
  await firstStarted;
  assert.deepEqual(events, ["start:first"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["start:first", "end:first", "start:second", "end:second"]);
});

test("un fallo de perfil no bloquea la siguiente escritura", async () => {
  const coordinator = createProfileWriteCoordinator();
  const failed = coordinator.run(async () => { throw new Error("offline"); });
  const recovered = coordinator.run(async () => "saved");
  await assert.rejects(failed, /offline/);
  assert.equal(await recovered, "saved");
});

test("una pestaña detecta que su respuesta cloud quedó detrás de otra", () => {
  const storage = new MemoryStorage();
  assert.equal(recordCloudProfileRevision(storage, "user-a", "2026-09-06T12:02:00.000Z"), true);
  assert.equal(cloudProfileRevisionIsNewer(storage, "user-a", "2026-09-06T12:01:00.000Z"), true);
  assert.equal(cloudProfileRevisionIsNewer(storage, "user-a", "2026-09-06T12:02:00.000Z"), false);
  assert.equal(recordCloudProfileRevision(storage, "user-a", "2026-09-06T12:01:00.000Z"), false);
});

test("un fallo parcial conserva revisión y adopta el reloj efectivo del servidor", () => {
  const storage = new MemoryStorage();
  const pending = queuePendingProfileWrite(storage, "user-clock", { displayName: "Said", defaultHandicap: 7, avatarUrl: "" }, "2026-09-06T12:00:00.000Z", "revision-clock");
  assert.equal(retimePendingProfileWrite(storage, "user-clock", "otra-revision", "2026-09-06T14:00:00.001Z"), false);
  assert.equal(retimePendingProfileWrite(storage, "user-clock", pending.revision, "2026-09-06T14:00:00.001Z"), true);
  assert.deepEqual(readPendingProfileWrite(storage, "user-clock"), { ...pending, updatedAt: "2026-09-06T14:00:00.001Z" });
});
