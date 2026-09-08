import { MAX_SCORECARD_IMAGE_BYTES } from "./backyard-ai/scorecard/limits";

const DB_NAME = "golfbets-media-v1";
const STORE = "scorecards";
const CLOUD_BUCKET = "scorecard-photos";
const TEMPORARY_PHOTO_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const LOCAL_DATABASE_TIMEOUT_MS = 4_000;
const IMAGE_DECODE_TIMEOUT_MS = 15_000;
const IMAGE_ENCODE_TIMEOUT_MS = 15_000;

export type ScorecardPhotoErrorCode =
  | "photo_open_failed"
  | "photo_compression_failed"
  | "photo_too_large"
  | "photo_storage_unavailable";

export class ScorecardPhotoError extends Error {
  readonly code: ScorecardPhotoErrorCode;

  constructor(code: ScorecardPhotoErrorCode, message: string) {
    super(message);
    this.name = "ScorecardPhotoError";
    this.code = code;
  }
}

export type DecodedScorecardPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

export type ScorecardPhotoDecoders = {
  bitmap?: (file: Blob) => Promise<DecodedScorecardPhoto>;
  imageElement: (file: Blob) => Promise<DecodedScorecardPhoto>;
};

export type ScorecardPhotoCompressionOptions = {
  decoders?: ScorecardPhotoDecoders;
  createCanvas?: () => HTMLCanvasElement;
  maxBytes?: number;
};

function uniquePhotoIds(photoIds: readonly string[]) {
  return [...new Set(photoIds.filter((photoId) => typeof photoId === "string" && Boolean(photoId.trim())))];
}

/** Resolves the durable evidence attached to a scorecard confirmation. A new
 * in-memory analysis may succeed even when every IndexedDB write fails; that
 * case must retain the prior committed photo instead of deleting it. */
export function resolveScorecardPhotoCommit(
  previousPhotoIds: readonly string[],
  newlyPersistedPhotoIds: readonly string[],
) {
  const previous = uniquePhotoIds(previousPhotoIds);
  const newlyDurable = uniquePhotoIds(newlyPersistedPhotoIds);
  const usesPreviousFallback = newlyDurable.length === 0;
  const durablePhotoIds = usesPreviousFallback ? previous : newlyDurable;
  return {
    durablePhotoIds,
    newlyDurablePhotoIds: newlyDurable,
    removedPhotoIds: usesPreviousFallback ? [] : previous.filter((photoId) => !newlyDurable.includes(photoId)),
    usesPreviousFallback,
  };
}

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
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new ScorecardPhotoError("photo_storage_unavailable", "El almacenamiento local de fotos no está disponible."));
      return;
    }
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      action();
    };
    const timer = globalThis.setTimeout(() => finish(() => reject(new ScorecardPhotoError(
      "photo_storage_unavailable",
      "El almacenamiento local de fotos tardó demasiado.",
    ))), LOCAL_DATABASE_TIMEOUT_MS);
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      finish(() => resolve(request.result));
    };
    request.onerror = () => finish(() => reject(request.error || new ScorecardPhotoError(
      "photo_storage_unavailable",
      "No se pudo abrir el almacenamiento local de fotos.",
    )));
    request.onblocked = () => finish(() => reject(new ScorecardPhotoError(
      "photo_storage_unavailable",
      "El almacenamiento local de fotos está bloqueado.",
    )));
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

function browserScorecardPhotoDecoders(): ScorecardPhotoDecoders {
  const bitmapFactory = globalThis.createImageBitmap;
  return {
    ...(typeof bitmapFactory === "function" ? {
      bitmap: async (file: Blob) => {
        const bitmap = await bitmapFactory(file, { imageOrientation: "from-image" });
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        };
      },
    } : {}),
    imageElement: async (file: Blob) => {
      const ImageConstructor = globalThis.Image;
      const objectUrl = globalThis.URL?.createObjectURL?.(file);
      if (!ImageConstructor || !objectUrl) throw new Error("HTML image decoding unavailable");
      const image = new ImageConstructor();
      image.decoding = "async";
      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (action: () => void) => {
            if (settled) return;
            settled = true;
            globalThis.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            action();
          };
          const timer = globalThis.setTimeout(
            () => finish(() => reject(new Error("Image decoding timed out"))),
            IMAGE_DECODE_TIMEOUT_MS,
          );
          image.onload = () => finish(resolve);
          image.onerror = () => finish(() => reject(new Error("Image decoding failed")));
          image.src = objectUrl;
        });
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("Image has no dimensions");
        return {
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          release: () => {
            image.src = "";
            globalThis.URL.revokeObjectURL(objectUrl);
          },
        };
      } catch (error) {
        image.src = "";
        globalThis.URL.revokeObjectURL(objectUrl);
        throw error;
      }
    },
  };
}

/** Uses createImageBitmap when it is reliable and falls back to the browser's
 * native HTMLImageElement decoder, which also honours iPhone EXIF orientation. */
export async function decodeScorecardPhoto(
  file: Blob,
  decoders: ScorecardPhotoDecoders = browserScorecardPhotoDecoders(),
) {
  if (decoders.bitmap) {
    try {
      const decoded = await decoders.bitmap(file);
      if (decoded.width > 0 && decoded.height > 0) return decoded;
      decoded.release();
    } catch {
      // Safari has shipped createImageBitmap implementations that reject some
      // otherwise displayable camera files. The element path is authoritative.
    }
  }
  try {
    const decoded = await decoders.imageElement(file);
    if (decoded.width > 0 && decoded.height > 0) return decoded;
    decoded.release();
  } catch {
    // The caller receives a stable, user-facing error instead of a DOMException.
  }
  throw new ScorecardPhotoError("photo_open_failed", "No pude abrir la foto.");
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      action();
    };
    const timer = globalThis.setTimeout(
      () => finish(() => reject(new ScorecardPhotoError("photo_compression_failed", "No pude comprimir la foto."))),
      IMAGE_ENCODE_TIMEOUT_MS,
    );
    try {
      canvas.toBlob(
        (blob) => finish(() => blob?.size
          ? resolve(blob)
          : reject(new ScorecardPhotoError("photo_compression_failed", "No pude comprimir la foto."))),
        "image/jpeg",
        quality,
      );
    } catch {
      finish(() => reject(new ScorecardPhotoError("photo_compression_failed", "No pude comprimir la foto.")));
    }
  });
}

const COMPRESSION_ATTEMPTS = [
  { maxDimension: 1_600, quality: 0.82 },
  { maxDimension: 1_440, quality: 0.76 },
  { maxDimension: 1_280, quality: 0.7 },
  { maxDimension: 1_024, quality: 0.66 },
] as const;

export async function compressScorecardPhoto(file: File, options: ScorecardPhotoCompressionOptions = {}) {
  const decoded = await decodeScorecardPhoto(file, options.decoders);
  const createCanvas = options.createCanvas || (() => document.createElement("canvas"));
  const maxBytes = Number.isFinite(options.maxBytes) && (options.maxBytes as number) > 0
    ? Math.floor(options.maxBytes as number)
    : MAX_SCORECARD_IMAGE_BYTES;
  try {
    for (const attempt of COMPRESSION_ATTEMPTS) {
      const scale = Math.min(1, attempt.maxDimension / Math.max(decoded.width, decoded.height));
      const canvas = createCanvas();
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new ScorecardPhotoError("photo_compression_failed", "No pude comprimir la foto.");
      try {
        context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      } catch {
        throw new ScorecardPhotoError("photo_compression_failed", "No pude comprimir la foto.");
      }
      const blob = await canvasBlob(canvas, attempt.quality);
      if (blob.size <= maxBytes) return blob;
    }
    throw new ScorecardPhotoError("photo_too_large", "La foto supera el tamaño permitido.");
  } catch (error) {
    if (error instanceof ScorecardPhotoError) throw error;
    throw new ScorecardPhotoError("photo_compression_failed", "No pude comprimir la foto.");
  } finally {
    decoded.release();
  }
}

export async function saveScorecardPhoto(roundId: string, file: File, ownerId = "guest") {
  const blob = await compressScorecardPhoto(file);
  await saveCompressedScorecardPhoto(roundId, blob, ownerId);
  return roundId;
}

/** Persists an already-prepared image. Card AI uses this as a best-effort side
 * effect so a storage failure can never prevent the provider request. */
export async function saveCompressedScorecardPhoto(photoId: string, blob: Blob, ownerId = "guest") {
  try {
    await putStoredScorecardPhoto(photoId, { schemaVersion: 1, blob, ownerId, state: "temporary", createdAt: Date.now() });
    return photoId;
  } catch (error) {
    if (error instanceof ScorecardPhotoError) throw error;
    throw new ScorecardPhotoError("photo_storage_unavailable", "No pude guardar una copia local de esta foto.");
  }
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
