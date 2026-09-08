import test from "node:test";
import assert from "node:assert/strict";

import { adoptGuestPhotoJobs, flushPhotoQueue, photoJobs, queuePhoto, roundScorecardPhotoIds } from "../lib/photo-sync-queue";
import type { CloudDataBundle } from "../lib/cloud-sync";

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function bundle(photoId: string, scorecardPhotoIds?: string[]): CloudDataBundle {
  return {
    version: 1,
    history: [{ id: "round-1", photoId, scorecardPhotoIds }] as CloudDataBundle["history"],
    frequentPlayers: [],
    frequentGroups: [],
    rivals: [],
    courses: [],
    preferences: { highContrast: false, defaultHandicap: null, language: "es-MX", notificationsEnabled: false },
    activeDraft: null,
    tombstones: [],
  };
}

function upload(storage: MemoryStorage, photoId: string, revision = photoId) {
  queuePhoto(storage, { userId: "user-1", roundId: "round-1", photoId, operation: "upload", revision });
}

test("la cola conserva varias fotos de una ronda y deduplica sólo la misma foto", () => {
  const storage = new MemoryStorage();
  upload(storage, "front", "v1");
  upload(storage, "back", "v2");
  upload(storage, "front", "v3");
  assert.deepEqual(photoJobs(storage).map(job => [job.photoId, job.revision]), [["back", "v2"], ["front", "v3"]]);
});

test("normaliza foto legacy y fotos Card AI para recuperación y borrado local", () => {
  assert.deepEqual(roundScorecardPhotoIds({ photoId: "front", scorecardPhotoIds: ["front", "back", "", 42] }), ["front", "back"]);
  assert.deepEqual(roundScorecardPhotoIds({}), []);
});

test("sincroniza todas las fotos declaradas por el snapshot y conserva su identidad", async () => {
  const storage = new MemoryStorage();
  upload(storage, "front");
  upload(storage, "back");
  const uploads: Array<[string, string]> = [];
  await flushPhotoQueue(storage, "user-1", bundle("front", ["front", "back"]), {
    read: async photoId => new Blob([photoId]),
    upload: async (_roundId, photoId, blob) => { uploads.push([photoId, await blob.text()]); return true; },
    remove: async () => true,
  });
  assert.deepEqual(uploads, [["front", "front"], ["back", "back"]]);
  assert.deepEqual(photoJobs(storage), []);
});

test("un trabajo obsoleto se descarta y sólo sube la foto vigente legacy", async () => {
  const storage = new MemoryStorage();
  upload(storage, "old");
  upload(storage, "new");
  const uploads: string[] = [];
  await flushPhotoQueue(storage, "user-1", bundle("new"), {
    read: async () => new Blob(["fixture"]),
    upload: async (_roundId, photoId) => { uploads.push(photoId); return true; },
    remove: async () => true,
  });
  assert.deepEqual(uploads, ["new"]);
  assert.deepEqual(photoJobs(storage), []);
});

test("borrar una ronda reemplaza todos sus uploads pendientes", () => {
  const storage = new MemoryStorage();
  upload(storage, "front");
  upload(storage, "back");
  queuePhoto(storage, { userId: "user-1", roundId: "round-1", photoId: "front", operation: "delete", revision: "delete-v1" });
  assert.deepEqual(photoJobs(storage).map(job => job.operation), ["delete"]);
});

test("reemplazar un escaneo limpia la carpeta remota una vez y sube sólo las fotos nuevas", async () => {
  const storage = new MemoryStorage();
  upload(storage, "old-front");
  queuePhoto(storage, { userId: "user-1", roundId: "round-1", photoId: "new-front", operation: "replace", revision: "replace-v1" });
  upload(storage, "new-back", "replace-v2");
  const removals: string[] = [];
  const uploads: string[] = [];

  await flushPhotoQueue(storage, "user-1", bundle("new-front", ["new-front", "new-back"]), {
    read: async photoId => new Blob([photoId]),
    upload: async (_roundId, photoId) => { uploads.push(photoId); return true; },
    remove: async roundId => { removals.push(roundId); return true; },
  });

  assert.deepEqual(removals, ["round-1"]);
  assert.deepEqual(uploads, ["new-front", "new-back"]);
  assert.deepEqual(photoJobs(storage), []);
});

test("adoptar trabajos guest conserva fotos distintas sin duplicar reintentos", () => {
  const storage = new MemoryStorage();
  queuePhoto(storage, { userId: "guest", roundId: "round-1", photoId: "front", operation: "upload", revision: "v1" });
  queuePhoto(storage, { userId: "guest", roundId: "round-1", photoId: "back", operation: "upload", revision: "v2" });
  adoptGuestPhotoJobs(storage, "user-1");
  adoptGuestPhotoJobs(storage, "user-1");
  assert.deepEqual(photoJobs(storage).map(job => job.photoId), ["front", "back"]);
  assert.ok(photoJobs(storage).every(job => job.userId === "user-1" && job.status === "pending"));
});
