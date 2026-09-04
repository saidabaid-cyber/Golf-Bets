import { CLOUD_TOMBSTONES_KEY, cloudDataFingerprint, collectLocalCloudData, mergeLocalAndCloud, persistCloudMetadata, restoreLocalRoundUi, type CloudDataBundle } from "./cloud-sync";
import { serializeFrequentGroups } from "./frequent-templates";
import { STORAGE_KEYS } from "./round-utils";

const DB_NAME = "the-backyard-offline-v1";
const DB_VERSION = 1;
const WORKSPACES = "workspaces";
const OUTBOX = "outbox";
const META = "meta";

export type OfflineWorkspace = {
  ownerId: string;
  bundle: CloudDataBundle;
  fingerprint: string;
  savedAt: string;
  syncedAt?: string;
};

export type OfflineOutbox = {
  ownerId: string;
  bundle: CloudDataBundle;
  fingerprint: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB no respondió"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB canceló la operación"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB no pudo guardar"));
  });
}

function openOfflineDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve<IDBDatabase | null>(null);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACES)) db.createObjectStore(WORKSPACES, { keyPath: "ownerId" });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "ownerId" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento offline"));
    request.onblocked = () => reject(new Error("Otra pestaña está actualizando el almacenamiento offline"));
  });
}

export function createDeviceId() {
  return globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function getOfflineDeviceId() {
  const db = await openOfflineDb();
  if (!db) return "browser-no-indexeddb";
  const read = db.transaction(META, "readonly").objectStore(META).get("device-id");
  const existing = await requestResult<{ key: string; value: string } | undefined>(read);
  if (existing?.value) return existing.value;
  const value = createDeviceId();
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put({ key: "device-id", value });
  await transactionDone(tx);
  return value;
}

/** One durable snapshot and one idempotent outbox item per account. Repeated
 * edits replace the pending snapshot instead of creating duplicate operations. */
export async function persistOfflineBundle(ownerId: string, bundle: CloudDataBundle, queueForCloud: boolean) {
  const db = await openOfflineDb();
  if (!db) throw new Error("IndexedDB no está disponible");
  const fingerprint = cloudDataFingerprint(bundle);
  const now = new Date().toISOString();
  const tx = db.transaction(queueForCloud ? [WORKSPACES, OUTBOX] : [WORKSPACES], "readwrite");
  tx.objectStore(WORKSPACES).put({ ownerId, bundle, fingerprint, savedAt: now } satisfies OfflineWorkspace);
  if (queueForCloud) tx.objectStore(OUTBOX).put({ ownerId, bundle, fingerprint, queuedAt: now, attempts: 0 } satisfies OfflineOutbox);
  await transactionDone(tx);
  return fingerprint;
}

export async function readOfflineBundle(ownerId: string) {
  const db = await openOfflineDb();
  if (!db) return null;
  return (await requestResult(db.transaction(WORKSPACES, "readonly").objectStore(WORKSPACES).get(ownerId)) as OfflineWorkspace | undefined) || null;
}

export async function readOfflineOutbox(ownerId: string) {
  const db = await openOfflineDb();
  if (!db) return null;
  return (await requestResult(db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).get(ownerId)) as OfflineOutbox | undefined) || null;
}

export function outboxAcknowledged(outbox: Pick<OfflineOutbox, "fingerprint"> | null, fingerprint: string) {
  return Boolean(outbox && outbox.fingerprint === fingerprint);
}

/** Exponential, bounded retry: transient outages recover automatically without
 * hammering Supabase forever. The manual retry action always bypasses it. */
export function offlineRetryDelayMs(attempts: number) {
  if (attempts <= 0) return 0;
  return Math.min(5 * 60_000, 15_000 * (2 ** Math.min(attempts - 1, 5)));
}

/** Delete pending work only after the exact snapshot was acknowledged. A newer
 * local edit remains queued even if an older request finishes later. */
export async function acknowledgeOfflineBundle(ownerId: string, fingerprint: string) {
  const db = await openOfflineDb();
  if (!db) return false;
  const current = await readOfflineOutbox(ownerId);
  if (!outboxAcknowledged(current, fingerprint)) return false;
  const workspace = await readOfflineBundle(ownerId);
  const tx = db.transaction([WORKSPACES, OUTBOX], "readwrite");
  tx.objectStore(OUTBOX).delete(ownerId);
  if (workspace) tx.objectStore(WORKSPACES).put({ ...workspace, syncedAt: new Date().toISOString() });
  await transactionDone(tx);
  return true;
}

export async function markOfflineAttempt(ownerId: string, error: string) {
  const db = await openOfflineDb();
  if (!db) return;
  const current = await readOfflineOutbox(ownerId);
  if (!current) return;
  const tx = db.transaction(OUTBOX, "readwrite");
  tx.objectStore(OUTBOX).put({ ...current, attempts: current.attempts + 1, lastError: error.slice(0, 240) });
  await transactionDone(tx);
}

export function writeCloudBundleToStorage(storage: Pick<Storage, "getItem" | "setItem">, bundle: CloudDataBundle) {
  storage.setItem(STORAGE_KEYS.courses, JSON.stringify(bundle.courses));
  storage.setItem(STORAGE_KEYS.history, JSON.stringify(bundle.history));
  storage.setItem(STORAGE_KEYS.rivals, JSON.stringify(bundle.rivals));
  storage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify(bundle.frequentPlayers));
  storage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups(bundle.frequentGroups));
  storage.setItem(STORAGE_KEYS.contrast, String(bundle.preferences.highContrast));
  let localDraft: unknown = null;
  try { localDraft = JSON.parse(storage.getItem(STORAGE_KEYS.draft) || "null") as unknown; } catch { /* invalid legacy cache is replaced */ }
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(restoreLocalRoundUi(bundle.activeDraft, localDraft)));
  storage.setItem(CLOUD_TOMBSTONES_KEY, JSON.stringify(bundle.tombstones));
  persistCloudMetadata(storage, bundle);
}

/** Recover the newest local snapshot before React hydrates. localStorage stays
 * as a compatibility/read-through cache; IndexedDB is the durable source. */
export async function restoreOfflineWorkspace(ownerId: string, storage: Storage, defaultHandicap: number | null) {
  const saved = await readOfflineBundle(ownerId);
  if (!saved) return null;
  const local = collectLocalCloudData(storage, defaultHandicap, storage.getItem(STORAGE_KEYS.contrast) !== null);
  const recovered = mergeLocalAndCloud(local, saved.bundle);
  writeCloudBundleToStorage(storage, recovered);
  return recovered;
}
