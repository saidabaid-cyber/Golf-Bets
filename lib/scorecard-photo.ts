const DB_NAME = "golfbets-media-v1";
const STORE = "scorecards";
const CLOUD_BUCKET = "scorecard-photos";
const TEMPORARY_PHOTO_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

type StoredScorecardPhoto = {
  schemaVersion: 1;
  blob: Blob;
  ownerId: string;
  state: "temporary" | "committed";
  createdAt: number;
};

function storedPhoto(value: unknown): StoredScorecardPhoto | null {
  if (!value || typeof value !== "object" || value instanceof Blob) return null;
  const candidate = value as Partial<StoredScorecardPhoto>;
  return candidate.schemaVersion === 1
    && candidate.blob instanceof Blob
    && typeof candidate.ownerId === "string"
    && (candidate.state === "temporary" || candidate.state === "committed")
    && typeof candidate.createdAt === "number"
    ? candidate as StoredScorecardPhoto
    : null;
}

function cloudPath(userId: string, roundId: string, photoId = roundId) {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return photoId === roundId ? `${clean(userId)}/${clean(roundId)}.jpg` : `${clean(userId)}/${clean(roundId)}/${clean(photoId)}.jpg`;
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putStoredScorecardPhoto(photoId: string, record: StoredScorecardPhoto) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(record, photoId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("No se guardó la foto local."));
    });
  } finally { db.close(); }
}

export async function compressScorecardPhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("No se pudo comprimir la foto.")), "image/jpeg", 0.82));
}

export async function saveScorecardPhoto(roundId: string, file: File, ownerId = "guest") {
  const blob = await compressScorecardPhoto(file);
  await putStoredScorecardPhoto(roundId, { schemaVersion: 1, blob, ownerId, state: "temporary", createdAt: Date.now() });
  return roundId;
}

export async function readScorecardPhoto(roundId: string, expectedOwnerId?: string, options: { adoptLegacy?: boolean } = {}) {
  const db = await database();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(roundId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const record = storedPhoto(value);
  if (record) return expectedOwnerId && record.ownerId !== expectedOwnerId ? undefined : record.blob;
  if (!(value instanceof Blob)) return undefined;
  if (!expectedOwnerId) return value;
  if (!options.adoptLegacy) return undefined;
  // Legacy blobs are adopted only after the caller proved that an
  // owner-scoped round or queue references this photo.
  await putStoredScorecardPhoto(roundId, {
    schemaVersion: 1,
    blob: value,
    ownerId: expectedOwnerId,
    state: "committed",
    createdAt: Date.now(),
  });
  return value;
}

async function allStoredScorecardPhotos() {
  const db = await database();
  try {
    return await new Promise<Array<{ photoId: string; record: StoredScorecardPhoto }>>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const store = transaction.objectStore(STORE);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      transaction.oncomplete = () => {
        const keys = keysRequest.result;
        const values = valuesRequest.result;
        resolve(values.flatMap((value, index) => {
          const record = storedPhoto(value);
          const key = keys[index];
          return record && typeof key === "string" ? [{ photoId: key, record }] : [];
        }));
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("No se pudieron revisar las fotos locales."));
    });
  } finally { db.close(); }
}

export async function scorecardPhotoIdsForOwner(ownerId: string) {
  if (!ownerId) return [];
  return (await allStoredScorecardPhotos()).filter((item) => item.record.ownerId === ownerId).map((item) => item.photoId);
}

/** Transfers only explicitly referenced local photos after the user approves
 * importing a guest workspace into an authenticated account. */
export async function adoptScorecardPhotos(photoIds: readonly string[], fromOwnerId: string, toOwnerId: string) {
  const wanted = new Set(photoIds.filter((photoId) => typeof photoId === "string" && Boolean(photoId.trim())));
  if (!wanted.size || !fromOwnerId || !toOwnerId || fromOwnerId === toOwnerId) return 0;
  const records = (await allStoredScorecardPhotos())
    .filter((item) => wanted.has(item.photoId) && item.record.ownerId === fromOwnerId);
  if (!records.length) return 0;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      records.forEach(({ photoId, record }) => store.put({ ...record, ownerId: toOwnerId }, photoId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("No se vincularon las fotos locales."));
    });
  } finally { db.close(); }
  return records.length;
}

export async function markScorecardPhotosCommitted(photoIds: readonly string[], ownerId: string) {
  const wanted = new Set(photoIds);
  if (!wanted.size || !ownerId) return;
  const records = (await allStoredScorecardPhotos()).filter((item) => wanted.has(item.photoId) && item.record.ownerId === ownerId);
  if (!records.length) return;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      records.forEach(({ photoId, record }) => store.put({ ...record, state: "committed" }, photoId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("No se confirmó la foto local."));
    });
  } finally { db.close(); }
}

export async function deleteStaleTemporaryScorecardPhotos(ownerId: string, now = Date.now(), protectedPhotoIds: readonly string[] = []) {
  if (!ownerId) return 0;
  const protectedIds = new Set(protectedPhotoIds);
  const staleIds = (await allStoredScorecardPhotos())
    .filter((item) => item.record.ownerId === ownerId && item.record.state === "temporary" && !protectedIds.has(item.photoId) && now - item.record.createdAt >= TEMPORARY_PHOTO_MAX_AGE_MS)
    .map((item) => item.photoId);
  await deleteScorecardPhotos(staleIds);
  return staleIds.length;
}

export async function deleteScorecardPhotos(photoIds: readonly string[]) {
  const ids = [...new Set(photoIds.filter(photoId => typeof photoId === "string" && Boolean(photoId.trim())))];
  if (!ids.length) return;
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      ids.forEach(photoId => store.delete(photoId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("No se eliminaron las fotos locales."));
    });
  } finally {
    db.close();
  }
}

export async function deleteScorecardPhoto(roundId: string) {
  await deleteScorecardPhotos([roundId]);
}

export async function uploadScorecardPhotoCloud(userId: string, roundId: string, blob: Blob, photoId = roundId) {
  const { getSupabaseBrowser } = await import("./supabase/client");
  const client = getSupabaseBrowser();
  if (!client) throw new Error("La nube no está disponible; la foto sigue guardada localmente.");
  const { error } = await client.storage.from(CLOUD_BUCKET).upload(cloudPath(userId, roundId, photoId), blob, {
    upsert: true,
    contentType: blob.type || "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw error;
  return true;
}

export async function readScorecardPhotoCloud(userId: string, roundId: string, photoId = roundId) {
  const { getSupabaseBrowser } = await import("./supabase/client");
  const client = getSupabaseBrowser();
  if (!client) throw new Error("Nube no disponible.");
  const { data, error } = await client.storage.from(CLOUD_BUCKET).download(cloudPath(userId, roundId, photoId));
  if (error) throw error;
  return data;
}

export async function deleteScorecardPhotoCloud(userId: string, roundId: string) {
  const { getSupabaseBrowser } = await import("./supabase/client");
  const client = getSupabaseBrowser();
  if (!client) throw new Error("Nube no disponible.");
  const folder = cloudPath(userId, roundId, "version").split("/").slice(0, -1).join("/");
  const paths = [cloudPath(userId, roundId)];
  for (let offset = 0; ; offset += 100) {
    const result = await client.storage.from(CLOUD_BUCKET).list(folder, { limit: 100, offset });
    if (result.error) throw result.error;
    paths.push(...result.data.filter(item => item.id).map(item => `${folder}/${item.name}`));
    if (result.data.length < 100) break;
  }
  const { error } = await client.storage.from(CLOUD_BUCKET).remove(paths);
  if (error) throw error;
  return true;
}
