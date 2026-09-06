import assert from "node:assert/strict";
import test from "node:test";

import type { CloudDataBundle } from "../lib/cloud-sync";
import {
  acknowledgeOfflineBundle,
  persistOfflineBundle,
  readOfflineOutbox,
  selectNewestOfflineWorkspace,
  selectPendingOfflineOutbox,
  type OfflineAcknowledgement,
  type OfflineOutbox,
  type OfflineWorkspace,
} from "../lib/offline-store";

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
