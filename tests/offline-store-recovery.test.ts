import assert from "node:assert/strict";
import test from "node:test";

import { CLOUD_LOCAL_META_KEY, type CloudDataBundle } from "../lib/cloud-sync";
import { accountDeletionMarkerKey } from "../lib/account-state";
import {
  acknowledgeOfflineBundle,
  getOfflineDeviceId,
  persistOfflineBundle,
  readOfflineBundle,
  readOfflineOutbox,
  restoreOfflineWorkspace,
  selectNewestOfflineWorkspace,
  selectPendingOfflineOutbox,
  type OfflineAcknowledgement,
  type OfflineOutbox,
  type OfflineWorkspace,
} from "../lib/offline-store";
import { STORAGE_KEYS } from "../lib/round-utils";

function replaceBrowserStorage(storage: unknown, indexedDb: unknown) {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDb });
  return () => {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage); else Reflect.deleteProperty(globalThis, "localStorage");
    if (oldDb) Object.defineProperty(globalThis, "indexedDB", oldDb); else Reflect.deleteProperty(globalThis, "indexedDB");
  };
}

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function bundle(roundId: string): CloudDataBundle {
  return {
    version: 1,
    history: [{ id: roundId, date: "2026-09-06", updatedAt: "2026-09-06T12:00:00.000Z" } as CloudDataBundle["history"][number]],
    frequentPlayers: [],
    frequentGroups: [],
    rivals: [],
    courses: [],
    preferences: { highContrast: false, language: "es-MX", notificationsEnabled: true, defaultHandicap: null },
    activeDraft: { roundId, scores: { 7: { player: roundId === "new-score" ? 3 : 5 } } },
    tombstones: [],
  };
}

function workspace(fingerprint: string, savedAt: string): OfflineWorkspace {
  return { ownerId: "account-1", bundle: bundle(fingerprint), fingerprint, savedAt };
}

function outbox(fingerprint: string, queuedAt: string): OfflineOutbox {
  return { ownerId: "account-1", bundle: bundle(fingerprint), fingerprint, queuedAt, attempts: 0 };
}

test("an IndexedDB open that never answers falls back without blocking hydration or deleting the active card", async t => {
  const storage = new MemoryStorage(); storage.setItem(STORAGE_KEYS.draft, JSON.stringify(bundle("pending-local").activeDraft));
  const requests: any[] = [];
  const restore = replaceBrowserStorage(storage, { open: () => { const request = {}; requests.push(request); return request; } });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const device = getOfflineDeviceId(); t.mock.timers.tick(4_001);
    assert.ok(await device);
    const recovering = restoreOfflineWorkspace("account-1", storage as unknown as Storage, null, "fixture-device");
    t.mock.timers.tick(4_001); assert.equal(await recovering, null);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!), bundle("pending-local").activeDraft);
    let closed = 0; requests[0].result = { close: () => closed++ }; requests[0].onsuccess();
    assert.equal(closed, 1, "a late successful open cannot leak a database connection after fallback");
  } finally { t.mock.timers.reset(); restore(); }
});

test("a stalled offline write aborts and preserves a durable fallback snapshot with all pending edits", async t => {
  const storage = new MemoryStorage(); let aborted = 0, closed = 0;
  const tx = { objectStore: () => ({ put() {} }), abort: () => { aborted++; } };
  const db = { transaction: () => tx, close: () => closed++ };
  const restore = replaceBrowserStorage(storage, { open: () => { const request: any = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = bundle("pending-write"); (pending.activeDraft as any).scoreEdits = { 8: { player: 7 } };
    const saving = persistOfflineBundle("account-1", pending, true);
    await new Promise<void>(resolve => setImmediate(resolve)); t.mock.timers.tick(4_001); await saving;
    assert.equal(aborted, 1); assert.equal(closed, 1);
    const durable = JSON.parse(storage.getItem("backyard-offline-workspace-fallback-v1:account-1")!);
    assert.deepEqual(durable.bundle.activeDraft, pending.activeDraft);
    assert.ok(storage.getItem("backyard-offline-outbox-fallback-v1:account-1"));
  } finally { t.mock.timers.reset(); restore(); }
});

test("a stalled offline read releases its connection and selects the previously verified fallback", async t => {
  const storage = new MemoryStorage(); const saved = workspace("new-score", "2026-10-10T12:00:00Z");
  storage.setItem("backyard-offline-workspace-fallback-v1:account-1", JSON.stringify(saved));
  let closed = 0; const db = { transaction: () => ({ objectStore: () => ({ get: () => ({}) }) }), close: () => closed++ };
  const restore = replaceBrowserStorage(storage, { open: () => { const request: any = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const reading = readOfflineBundle("account-1");
    await new Promise<void>(resolve => setImmediate(resolve)); t.mock.timers.tick(4_001);
    assert.deepEqual(await reading, saved); assert.equal(closed, 1);
  } finally { t.mock.timers.reset(); restore(); }
});

test("un fallback posterior gana sobre IndexedDB antiguo y conserva el score más reciente", () => {
  const indexedDb = workspace("old-score", "2026-09-06T12:00:00.000Z");
  const fallback = workspace("new-score", "2026-09-06T12:00:01.000Z");

  const recovered = selectNewestOfflineWorkspace(indexedDb, fallback);

  assert.equal(recovered?.fingerprint, "new-score");
  assert.equal((recovered?.bundle.activeDraft as { scores: Record<number, { player: number }> }).scores[7].player, 3);
});

test("un fallback del mismo milisegundo gana porque representa la recuperación tras el fallo", () => {
  const at = "2026-09-06T12:00:00.000Z";
  assert.equal(selectNewestOfflineWorkspace(workspace("indexed-db", at), workspace("fallback", at))?.fingerprint, "fallback");
});

test("el ACK descarta copias antiguas pero nunca una edición distinta posterior o simultánea", () => {
  const acknowledgement: OfflineAcknowledgement = {
    ownerId: "account-1",
    fingerprint: "confirmed",
    queuedAt: "2026-09-06T12:00:01.000Z",
    acknowledgedAt: "2026-09-06T12:00:02.000Z",
  };

  assert.equal(selectPendingOfflineOutbox(
    outbox("stale-indexed-db", "2026-09-06T12:00:00.000Z"),
    outbox("confirmed", acknowledgement.queuedAt),
    acknowledgement,
  ), null);
  assert.equal(selectPendingOfflineOutbox(
    outbox("same-millisecond-edit", acknowledgement.queuedAt),
    null,
    acknowledgement,
  )?.fingerprint, "same-millisecond-edit");
  assert.equal(selectPendingOfflineOutbox(
    outbox("new-edit", "2026-09-06T12:00:03.000Z"),
    null,
    acknowledgement,
  )?.fingerprint, "new-edit");
});

test("el watermark durable evita que reaparezca una cola vieja y una edición nueva vuelve a encolarse", async () => {
  const storage = new MemoryStorage();
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    const fingerprint = await persistOfflineBundle("account-1", bundle("confirmed"), true);
    const confirmed = await readOfflineOutbox("account-1");
    assert.equal(confirmed?.fingerprint, fingerprint);
    assert.equal(await acknowledgeOfflineBundle("account-1", fingerprint), true);
    assert.equal(await readOfflineOutbox("account-1"), null);

    // Simulate an older IndexedDB record becoming visible again after a
    // transient browser storage failure. The ACK watermark must hide it.
    storage.setItem("backyard-offline-outbox-fallback-v1:account-1", JSON.stringify({
      ...outbox("stale-indexed-db", "2020-01-01T00:00:00.000Z"),
    }));
    assert.equal(await readOfflineOutbox("account-1"), null);

    const nextFingerprint = await persistOfflineBundle("account-1", bundle("new-score"), true);
    assert.notEqual(nextFingerprint, fingerprint);
    assert.equal((await readOfflineOutbox("account-1"))?.fingerprint, nextFingerprint);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
});

test("un guardado sólo local actualiza el workspace sin borrar una mutación cloud pendiente", async () => {
  const storage = new MemoryStorage();
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    const pendingFingerprint = await persistOfflineBundle("account-1", bundle("pending-cloud"), true);
    await persistOfflineBundle("account-1", bundle("local-workspace-only"), false);

    assert.equal((await readOfflineOutbox("account-1"))?.fingerprint, pendingFingerprint);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
});

test("reload real elige el draft más nuevo entre localStorage e IndexedDB del mismo dispositivo", async () => {
  const storage = new MemoryStorage();
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  const deviceId = "iphone-main";
  const h1 = { roundId: "round-live", scores: { 1: { said: 4 } }, scoreEdits: {} };
  const h1H2 = { roundId: "round-live", scores: { 1: { said: 4 }, 2: { said: 5 } }, scoreEdits: {} };
  const h1H2H3 = { roundId: "round-live", scores: { 1: { said: 4 }, 2: { said: 5 }, 3: { said: 3 } }, scoreEdits: {} };
  const localMetadata = {
    draftAt: "2026-09-28T12:01:00.000Z",
    cloudDraftAt: "2026-09-28T12:01:00.000Z",
    cloudDraftFingerprint: JSON.stringify(h1H2),
  };
  try {
    await persistOfflineBundle("account-stale", {
      ...bundle("round-live"),
      deviceId,
      activeDraft: h1,
      activeDraftUpdatedAt: "2026-09-28T12:00:00.000Z",
    }, false);
    storage.setItem(STORAGE_KEYS.draft, JSON.stringify(h1H2));
    storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify(localMetadata));

    const fromStaleSnapshot = await restoreOfflineWorkspace("account-stale", storage as unknown as Storage, null, deviceId);
    assert.deepEqual(fromStaleSnapshot?.activeDraft, h1H2);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft) || "null"), h1H2);

    await persistOfflineBundle("account-newer", {
      ...bundle("round-live"),
      deviceId,
      activeDraft: h1H2H3,
      activeDraftUpdatedAt: "2026-09-28T12:02:00.000Z",
      baseDraft: h1H2,
      baseDraftUpdatedAt: "2026-09-28T12:01:00.000Z",
      baseDraftFingerprint: JSON.stringify(h1H2),
    }, false);
    storage.setItem(STORAGE_KEYS.draft, JSON.stringify(h1H2));
    storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify(localMetadata));

    const fromNewerSnapshot = await restoreOfflineWorkspace("account-newer", storage as unknown as Storage, null, deviceId);
    assert.deepEqual(fromNewerSnapshot?.activeDraft, h1H2H3);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft) || "null"), h1H2H3);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
});

test("el marker de eliminación bloquea cualquier nuevo workspace u outbox offline", async () => {
  const storage = new MemoryStorage();
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    storage.setItem(accountDeletionMarkerKey("account-1"), "pending");
    await assert.rejects(persistOfflineBundle("account-1", bundle("must-not-return"), true), /deletion in progress/i);
    assert.equal(storage.getItem("backyard-offline-workspace-fallback-v1:account-1"), null);
    assert.equal(storage.getItem("backyard-offline-outbox-fallback-v1:account-1"), null);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
});
