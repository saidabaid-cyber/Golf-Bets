import { CLOUD_TOMBSTONES_KEY, cloudDataFingerprint, collectLocalCloudData, mergeLocalAndCloud, persistCloudMetadata, restoreLocalRoundUi, type CloudDataBundle } from "./cloud-sync";
import { serializeFrequentGroups } from "./frequent-templates";
import { STORAGE_KEYS } from "./round-utils";

const DB_NAME = "the-backyard-offline-v1";
const DB_VERSION = 1;
const WORKSPACES = "workspaces";
const OUTBOX = "outbox";
const META = "meta";
const FALLBACK_WORKSPACE_PREFIX = "backyard-offline-workspace-fallback-v1:";
const FALLBACK_OUTBOX_PREFIX = "backyard-offline-outbox-fallback-v1:";

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

function browserStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function readFallback<T>(prefix: string, ownerId: string): T | null {
  const storage = browserStorage();
  if (!storage) return null;
  try { return JSON.parse(storage.getItem(`${prefix}${ownerId}`) || "null") as T | null; }
  catch { return null; }
}

function writeFallback(ownerId: string, workspace: OfflineWorkspace, outbox?: OfflineOutbox) {
  const storage = browserStorage();
  if (!storage) throw new Error("No existe una persistencia local alternativa");
  storage.setItem(`${FALLBACK_WORKSPACE_PREFIX}${ownerId}`, JSON.stringify(workspace));
  if (outbox) storage.setItem(`${FALLBACK_OUTBOX_PREFIX}${ownerId}`, JSON.stringify(outbox));
  const verifiedWorkspace = readFallback<OfflineWorkspace>(FALLBACK_WORKSPACE_PREFIX, ownerId);
  const verifiedOutbox = outbox ? readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId) : null;
  if (verifiedWorkspace?.fingerprint !== workspace.fingerprint || (outbox && verifiedOutbox?.fingerprint !== outbox.fingerprint)) {
    throw new Error("No se pudo verificar la cola local alternativa");
  }
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
  const fingerprint = cloudDataFingerprint(bundle);
  const now = new Date().toISOString();
  const workspace = { ownerId, bundle, fingerprint, savedAt: now } satisfies OfflineWorkspace;
  const outbox = queueForCloud ? { ownerId, bundle, fingerprint, queuedAt: now, attempts: 0 } satisfies OfflineOutbox : undefined;
  try {
    const db = await openOfflineDb();
    if (!db) throw new Error("IndexedDB no está disponible");
    const tx = db.transaction(queueForCloud ? [WORKSPACES, OUTBOX] : [WORKSPACES], "readwrite");
    tx.objectStore(WORKSPACES).put(workspace);
    if (outbox) tx.objectStore(OUTBOX).put(outbox);
    await transactionDone(tx);
    const storage = browserStorage();
    storage?.removeItem(`${FALLBACK_WORKSPACE_PREFIX}${ownerId}`);
    storage?.removeItem(`${FALLBACK_OUTBOX_PREFIX}${ownerId}`);
  } catch {
    // Safari private mode and storage pressure can reject IndexedDB while
    // localStorage is still durable. Keep one idempotent, verified fallback
    // snapshot/outbox so refresh and reconnect do not lose the pending round.
    writeFallback(ownerId, workspace, outbox);
  }
  return fingerprint;
}

export async function readOfflineBundle(ownerId: string) {
  try {
    const db = await openOfflineDb();
    if (db) {
      const saved = (await requestResult(db.transaction(WORKSPACES, "readonly").objectStore(WORKSPACES).get(ownerId)) as OfflineWorkspace | undefined) || null;
      if (saved) return saved;
    }
  } catch { /* use the verified fallback below */ }
  return readFallback<OfflineWorkspace>(FALLBACK_WORKSPACE_PREFIX, ownerId);
}

export async function readOfflineOutbox(ownerId: string) {
  try {
    const db = await openOfflineDb();
    if (db) {
      const saved = (await requestResult(db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).get(ownerId)) as OfflineOutbox | undefined) || null;
      if (saved) return saved;
    }
  } catch { /* use the verified fallback below */ }
  return readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId);
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
  const current = await readOfflineOutbox(ownerId);
  if (!outboxAcknowledged(current, fingerprint)) return false;
  const fallback = readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId);
  if (fallback?.fingerprint === fingerprint) {
    const storage = browserStorage();
    const workspace = readFallback<OfflineWorkspace>(FALLBACK_WORKSPACE_PREFIX, ownerId);
    if (!storage) return false;
    if (workspace) storage.setItem(`${FALLBACK_WORKSPACE_PREFIX}${ownerId}`, JSON.stringify({ ...workspace, syncedAt: new Date().toISOString() }));
    storage.removeItem(`${FALLBACK_OUTBOX_PREFIX}${ownerId}`);
    return true;
  }
  const db = await openOfflineDb();
  if (!db) return false;
  const workspace = await readOfflineBundle(ownerId);
  const tx = db.transaction([WORKSPACES, OUTBOX], "readwrite");
  tx.objectStore(OUTBOX).delete(ownerId);
  if (workspace) tx.objectStore(WORKSPACES).put({ ...workspace, syncedAt: new Date().toISOString() });
  await transactionDone(tx);
  return true;
}

export async function markOfflineAttempt(ownerId: string, error: string) {
  const current = await readOfflineOutbox(ownerId);
  if (!current) return;
  const fallback = readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId);
  if (fallback?.fingerprint === current.fingerprint) {
    browserStorage()?.setItem(`${FALLBACK_OUTBOX_PREFIX}${ownerId}`, JSON.stringify({ ...current, attempts: current.attempts + 1, lastError: error.slice(0, 240) }));
    return;
  }
  const db = await openOfflineDb();
  if (!db) return;
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
