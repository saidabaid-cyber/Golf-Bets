const DB_NAME = "golfbets-media-v1";
const STORE = "scorecards";
const CLOUD_BUCKET = "scorecard-photos";

function cloudPath(userId: string, roundId: string) {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return `${clean(userId)}/${clean(roundId)}.jpg`;
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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

export async function saveScorecardPhoto(roundId: string, file: File) {
  const blob = await compressScorecardPhoto(file);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(blob, roundId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return roundId;
}

export async function readScorecardPhoto(roundId: string) {
  const db = await database();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(roundId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

export async function deleteScorecardPhoto(roundId: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(roundId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function uploadScorecardPhotoCloud(userId: string, roundId: string, blob: Blob) {
  const { getSupabaseBrowser } = await import("./supabase/client");
  const client = getSupabaseBrowser();
  if (!client) return false;
  const { error } = await client.storage.from(CLOUD_BUCKET).upload(cloudPath(userId, roundId), blob, {
    upsert: true,
    contentType: blob.type || "image/jpeg",
    cacheControl: "3600",
  });
  if (error) throw error;
  return true;
}

export async function readScorecardPhotoCloud(userId: string, roundId: string) {
  const { getSupabaseBrowser } = await import("./supabase/client");
  const client = getSupabaseBrowser();
  if (!client) return undefined;
  const { data, error } = await client.storage.from(CLOUD_BUCKET).download(cloudPath(userId, roundId));
  if (error) return undefined;
  return data;
}

export async function deleteScorecardPhotoCloud(userId: string, roundId: string) {
  const { getSupabaseBrowser } = await import("./supabase/client");
  const client = getSupabaseBrowser();
  if (!client) return false;
  const { error } = await client.storage.from(CLOUD_BUCKET).remove([cloudPath(userId, roundId)]);
  if (error) throw error;
  return true;
}
