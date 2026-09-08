import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectAccountScorecardPhotoIds, switchAccountWorkspace, WORKSPACE_OWNER_KEY } from "../lib/account-workspace";
import { createPersonalLearningEvent, createScorecardCorrection, writeLearningRecords } from "../lib/backyard-ai/memory/learning-events";
import { deleteOfflineAccountData } from "../lib/offline-store";
import { PHOTO_QUEUE_KEY } from "../lib/photo-sync-queue";
import { STORAGE_KEYS } from "../lib/round-utils";

const NOW = "2026-09-08T12:00:00.000Z";

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

function photoJob(userId: string, photoId: string) {
  return { userId, roundId: `round-${photoId}`, photoId, operation: "upload", status: "pending", revision: "v1" };
}

test("selecciona fotos de histórico, draft, cola y learning sólo para la cuenta objetivo", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "user-a");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([
    { photoId: "history-legacy", scorecardPhotoIds: ["history-front", "history-back", "history-front"] },
  ]));
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ photoId: "draft-legacy", scorecardPhotoIds: ["draft-detail"] }));
  storage.setItem(PHOTO_QUEUE_KEY, JSON.stringify([
    photoJob("user-a", "queue-a"),
    photoJob("user-b", "queue-b"),
    photoJob("guest", "queue-guest"),
  ]));
  const correction = createScorecardCorrection({
    id: "correction-a",
    ownerId: "user-a",
    interactionId: "interaction-a",
    roundId: "round-a",
    roundPlayerId: "player-a",
    hole: 14,
    extractedScore: 6,
    correctedScore: 5,
    confidence: 0.61,
    source: "VISION",
    imageReference: "learning-correction",
    createdAt: NOW,
  });
  const learning = createPersonalLearningEvent({
    id: "learning-a",
    ownerId: "user-a",
    eventType: "SCORECARD_ACCEPTED",
    payload: { evidence: { imageReference: "learning-nested" } },
    occurredAt: NOW,
  });
  assert.ok(correction && learning);
  assert.equal(writeLearningRecords(storage, "user-a", [correction, learning], NOW).ok, true);

  assert.deepEqual(selectAccountScorecardPhotoIds(storage, "user-a"), [
    "draft-detail",
    "draft-legacy",
    "history-back",
    "history-front",
    "history-legacy",
    "learning-correction",
    "learning-nested",
    "queue-a",
  ]);
});

test("incluye el workspace archivado y snapshots offline owner-scoped sin tocar guest ni otras cuentas", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "user-a");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ photoId: "archived-a" }]));
  storage.setItem(PHOTO_QUEUE_KEY, JSON.stringify([photoJob("user-a", "archived-queue-a"), photoJob("guest", "archived-guest")]));
  switchAccountWorkspace(storage, "user-b");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ photoId: "active-b" }]));
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ scorecardPhotoIds: ["active-b-draft"] }));
  storage.setItem(PHOTO_QUEUE_KEY, JSON.stringify([photoJob("user-b", "queue-b"), photoJob("user-a", "stranded-queue-a")]));

  const offlineA = {
    ownerId: "user-a",
    bundle: {
      history: [{ photoId: "offline-history-a", scorecardPhotoIds: ["offline-detail-a"] }],
      activeDraft: { photoId: "offline-draft-a" },
    },
  };
  const offlineB = { ownerId: "user-b", bundle: { history: [{ photoId: "offline-b" }], activeDraft: null } };
  assert.deepEqual(selectAccountScorecardPhotoIds(storage, "user-a", [offlineA, offlineB]), [
    "archived-a",
    "archived-queue-a",
    "offline-detail-a",
    "offline-draft-a",
    "offline-history-a",
    "stranded-queue-a",
  ]);
  assert.deepEqual(selectAccountScorecardPhotoIds(storage, "guest", [offlineA]), []);
  assert.deepEqual(selectAccountScorecardPhotoIds(storage, "user-c", [offlineA, offlineB]), []);
});

test("metadata malformada no amplía el alcance de borrado", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "user-b");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ photoId: "belongs-to-b" }]));
  storage.setItem(PHOTO_QUEUE_KEY, "not-json");
  storage.setItem("backyard-local-workspace-v1:user-a", "not-json");
  assert.deepEqual(selectAccountScorecardPhotoIds(storage, "user-a", [{ ownerId: "user-b", bundle: { history: [{ photoId: "also-b" }] } }]), []);
});

test("una referencia compartida con guest u otra cuenta nunca borra su blob", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "user-a");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ scorecardPhotoIds: ["only-a", "shared-guest", "shared-b"] }]));
  storage.setItem("backyard-local-workspace-v1:guest", JSON.stringify({
    [STORAGE_KEYS.history]: JSON.stringify([{ photoId: "shared-guest" }]),
  }));
  storage.setItem("backyard-local-workspace-v1:user-b", JSON.stringify({
    [STORAGE_KEYS.draft]: JSON.stringify({ photoId: "shared-b" }),
  }));
  const offlineB = { ownerId: "user-b", bundle: { history: [{ photoId: "only-offline-b" }], activeDraft: { photoId: "only-a" } } };
  assert.deepEqual(selectAccountScorecardPhotoIds(storage, "user-a", [offlineB]), []);
  assert.deepEqual(selectAccountScorecardPhotoIds(storage, "user-a", [offlineB], ["only-a"]), ["only-a"]);
});

test("el índice propietario es autoritativo aunque otro workspace conserve una referencia ilegible", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "guest");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ photoId: "shared-temporary" }]));
  assert.deepEqual(
    selectAccountScorecardPhotoIds(storage, "user-a", [], ["orphan-a", "shared-temporary"]),
    ["orphan-a", "shared-temporary"],
  );
});

test("purga offline fallback es idempotente y elimina sólo las claves del owner", async () => {
  const storage = new MemoryStorage();
  const prefixes = [
    "backyard-offline-workspace-fallback-v1:",
    "backyard-offline-outbox-fallback-v1:",
    "backyard-offline-ack-fallback-v1:",
  ];
  for (const prefix of prefixes) {
    storage.setItem(`${prefix}user-a`, "private-a");
    storage.setItem(`${prefix}user-b`, "private-b");
    storage.setItem(`${prefix}guest`, "private-guest");
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage as unknown as Storage });
  try {
    assert.equal(await deleteOfflineAccountData("user-a"), true);
    assert.equal(await deleteOfflineAccountData("user-a"), true);
    assert.equal(await deleteOfflineAccountData("guest"), false);
    for (const prefix of prefixes) {
      assert.equal(storage.getItem(`${prefix}user-a`), null);
      assert.equal(storage.getItem(`${prefix}user-b`), "private-b");
      assert.equal(storage.getItem(`${prefix}guest`), "private-guest");
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("toda lectura local de scorecard exige owner y sólo adopta legacy desde referencias owner-scoped", () => {
  const storage = readFileSync("lib/scorecard-photo.ts", "utf8");
  const page = readFileSync("app/page.tsx", "utf8");
  const scanner = readFileSync("app/components/backyard-ai/scorecard-scanner.tsx", "utf8");
  assert.match(storage, /record\.ownerId !== expectedOwnerId/);
  assert.match(storage, /if \(!options\.adoptLegacy\) return undefined/);
  assert.match(storage, /record\.ownerId === fromOwnerId/);
  assert.match(storage, /ownerId: toOwnerId/);
  assert.match(page, /readScorecardPhoto\(photoId, userId, \{ adoptLegacy: true \}\)/);
  assert.match(page, /readScorecardPhoto\(round\.photoId \|\| round\.id, identity\.userId, \{ adoptLegacy: true \}\)/);
  assert.match(scanner, /readScorecardPhoto\(photo\.id, storageOwnerId\)/);
});
