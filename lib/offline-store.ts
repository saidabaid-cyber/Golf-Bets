import { CLOUD_TOMBSTONES_KEY, cloudDataFingerprint, collectLocalCloudData, hasLocalCloudPreferenceState, mergeLocalAndCloud, persistCloudMetadata, restoreLocalRoundUi, type CloudDataBundle } from "./cloud-sync";
import { serializeFrequentGroups } from "./frequent-templates";
import { STORAGE_KEYS } from "./round-utils";

const DB_NAME = "the-backyard-offline-v1";
const DB_VERSION = 1;
const WORKSPACES = "workspaces";
const OUTBOX = "outbox";
const META = "meta";
const FALLBACK_WORKSPACE_PREFIX = "backyard-offline-workspace-fallback-v1:";
const FALLBACK_OUTBOX_PREFIX = "backyard-offline-outbox-fallback-v1:";
const FALLBACK_ACK_PREFIX = "backyard-offline-ack-fallback-v1:";

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

export type OfflineAcknowledgement = {
  ownerId: string;
  fingerprint: string;
  queuedAt: string;
  acknowledgedAt: string;
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

function timestampMs(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function newestRecord<T>(indexedDbRecord: T | null, fallbackRecord: T | null, timestamp: (record: T) => string) {
  if (!indexedDbRecord) return fallbackRecord;
  if (!fallbackRecord) return indexedDbRecord;
  const indexedDbTime = timestampMs(timestamp(indexedDbRecord));
  const fallbackTime = timestampMs(timestamp(fallbackRecord));
  if (indexedDbTime === null) return fallbackRecord;
  if (fallbackTime === null) return indexedDbRecord;
  // A fallback is written after an IndexedDB failure. Prefer it on an exact
  // timestamp tie so a score captured in the same millisecond is not lost.
  return fallbackTime >= indexedDbTime ? fallbackRecord : indexedDbRecord;
}

export function selectNewestOfflineWorkspace(indexedDbRecord: OfflineWorkspace | null, fallbackRecord: OfflineWorkspace | null) {
  return newestRecord(indexedDbRecord, fallbackRecord, record => record.savedAt);
}

export function outboxSupersededByAcknowledgement(outbox: OfflineOutbox | null, acknowledgement: OfflineAcknowledgement | null) {
  if (!outbox || !acknowledgement || outbox.ownerId !== acknowledgement.ownerId) return false;
  if (outbox.fingerprint === acknowledgement.fingerprint) return true;
  const queuedAt = timestampMs(outbox.queuedAt);
  const acknowledgedQueuedAt = timestampMs(acknowledgement.queuedAt);
  // Preserve different snapshots on a tie or with malformed legacy clocks.
  // A new write from this version is always timestamped after the watermark.
  return queuedAt !== null && acknowledgedQueuedAt !== null && queuedAt < acknowledgedQueuedAt;
}

export function selectPendingOfflineOutbox(
  indexedDbRecord: OfflineOutbox | null,
  fallbackRecord: OfflineOutbox | null,
  acknowledgement: OfflineAcknowledgement | null = null,
) {
  const indexedDbPending = outboxSupersededByAcknowledgement(indexedDbRecord, acknowledgement) ? null : indexedDbRecord;
  const fallbackPending = outboxSupersededByAcknowledgement(fallbackRecord, acknowledgement) ? null : fallbackRecord;
  return newestRecord(indexedDbPending, fallbackPending, record => record.queuedAt);
}

function nextOfflineTimestamp(ownerId: string) {
  const acknowledgement = readFallback<OfflineAcknowledgement>(FALLBACK_ACK_PREFIX, ownerId);
  const acknowledgedQueuedAt = timestampMs(acknowledgement?.queuedAt);
  return new Date(Math.max(Date.now(), acknowledgedQueuedAt === null ? 0 : acknowledgedQueuedAt + 1)).toISOString();
}

function clearAcknowledgement(ownerId: string) {
  try { browserStorage()?.removeItem(`${FALLBACK_ACK_PREFIX}${ownerId}`); }
  catch { /* the newer queuedAt still keeps this outbox above the watermark */ }
}

function removeFallbackIfSuperseded<T extends { fingerprint: string }>(
  prefix: string,
  ownerId: string,
  persisted: T,
  timestamp: (record: T) => string,
) {
  const storage = browserStorage();
  if (!storage) return;
  const fallback = readFallback<T>(prefix, ownerId);
  if (!fallback) return;
  const selected = newestRecord(persisted, fallback, timestamp);
  if (fallback.fingerprint === persisted.fingerprint || selected === persisted) {
    try { storage.removeItem(`${prefix}${ownerId}`); } catch { /* stale fallback remains harmless */ }
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
  const now = nextOfflineTimestamp(ownerId);
  const workspace = { ownerId, bundle, fingerprint, savedAt: now } satisfies OfflineWorkspace;
  const outbox = queueForCloud ? { ownerId, bundle, fingerprint, queuedAt: now, attempts: 0 } satisfies OfflineOutbox : undefined;
  try {
    const db = await openOfflineDb();
    if (!db) throw new Error("IndexedDB no está disponible");
    const tx = db.transaction(queueForCloud ? [WORKSPACES, OUTBOX] : [WORKSPACES], "readwrite");
    tx.objectStore(WORKSPACES).put(workspace);
    if (outbox) tx.objectStore(OUTBOX).put(outbox);
    await transactionDone(tx);
    removeFallbackIfSuperseded(FALLBACK_WORKSPACE_PREFIX, ownerId, workspace, record => record.savedAt);
    // A local-only save must not erase a previously queued cloud mutation.
    if (outbox) removeFallbackIfSuperseded(FALLBACK_OUTBOX_PREFIX, ownerId, outbox, record => record.queuedAt);
  } catch {
    // Safari private mode and storage pressure can reject IndexedDB while
    // localStorage is still durable. Keep one idempotent, verified fallback
    // snapshot/outbox so refresh and reconnect do not lose the pending round.
    writeFallback(ownerId, workspace, outbox);
  }
  if (outbox) clearAcknowledgement(ownerId);
  return fingerprint;
}

export async function readOfflineBundle(ownerId: string) {
  let indexedDbRecord: OfflineWorkspace | null = null;
  try {
    const db = await openOfflineDb();
    if (db) {
      indexedDbRecord = (await requestResult(db.transaction(WORKSPACES, "readonly").objectStore(WORKSPACES).get(ownerId)) as OfflineWorkspace | undefined) || null;
    }
  } catch { /* use the verified fallback below */ }
  return selectNewestOfflineWorkspace(indexedDbRecord, readFallback<OfflineWorkspace>(FALLBACK_WORKSPACE_PREFIX, ownerId));
}

export async function readOfflineOutbox(ownerId: string) {
  let indexedDbRecord: OfflineOutbox | null = null;
  try {
    const db = await openOfflineDb();
    if (db) {
      indexedDbRecord = (await requestResult(db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).get(ownerId)) as OfflineOutbox | undefined) || null;
    }
  } catch { /* use the verified fallback below */ }
  return selectPendingOfflineOutbox(
    indexedDbRecord,
    readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId),
    readFallback<OfflineAcknowledgement>(FALLBACK_ACK_PREFIX, ownerId),
  );
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
  if (!current || !outboxAcknowledged(current, fingerprint)) return false;
  const acknowledgement = {
    ownerId,
    fingerprint,
    queuedAt: current.queuedAt,
    acknowledgedAt: new Date().toISOString(),
  } satisfies OfflineAcknowledgement;
  const storage = browserStorage();
  let acknowledgementPersisted = false;
  if (storage) {
    try {
      storage.setItem(`${FALLBACK_ACK_PREFIX}${ownerId}`, JSON.stringify(acknowledgement));
      acknowledgementPersisted = readFallback<OfflineAcknowledgement>(FALLBACK_ACK_PREFIX, ownerId)?.fingerprint === fingerprint;
    } catch { /* IndexedDB can still complete the acknowledgement atomically */ }
  }

  let indexedDbAcknowledged = false;
  try {
    const db = await openOfflineDb();
    if (db) {
      const tx = db.transaction([WORKSPACES, OUTBOX], "readwrite");
      const done = transactionDone(tx);
      const outboxStore = tx.objectStore(OUTBOX);
      const workspaceStore = tx.objectStore(WORKSPACES);
      const [storedOutbox, storedWorkspace] = await Promise.all([
        requestResult(outboxStore.get(ownerId)) as Promise<OfflineOutbox | undefined>,
        requestResult(workspaceStore.get(ownerId)) as Promise<OfflineWorkspace | undefined>,
      ]);
      if (outboxSupersededByAcknowledgement(storedOutbox || null, acknowledgement)) outboxStore.delete(ownerId);
      if (storedWorkspace?.fingerprint === fingerprint) workspaceStore.put({ ...storedWorkspace, syncedAt: acknowledgement.acknowledgedAt });
      await done;
      indexedDbAcknowledged = true;
    }
  } catch { /* the durable watermark prevents an old IndexedDB row resurfacing */ }

  if (!acknowledgementPersisted && !indexedDbAcknowledged) return false;
  const fallbackOutbox = readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId);
  if (storage && outboxSupersededByAcknowledgement(fallbackOutbox, acknowledgement)) {
    try {
      const workspace = readFallback<OfflineWorkspace>(FALLBACK_WORKSPACE_PREFIX, ownerId);
      if (workspace?.fingerprint === fingerprint) {
        storage.setItem(`${FALLBACK_WORKSPACE_PREFIX}${ownerId}`, JSON.stringify({ ...workspace, syncedAt: acknowledgement.acknowledgedAt }));
      }
      storage.removeItem(`${FALLBACK_OUTBOX_PREFIX}${ownerId}`);
    } catch { /* the watermark keeps the acknowledged item logically empty */ }
  }
  return true;
}

export async function markOfflineAttempt(ownerId: string, error: string) {
  const current = await readOfflineOutbox(ownerId);
  if (!current) return;
  const fallback = readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId);
  if (fallback?.fingerprint === current.fingerprint) {
    const latestFallback = readFallback<OfflineOutbox>(FALLBACK_OUTBOX_PREFIX, ownerId);
    if (latestFallback?.fingerprint === current.fingerprint) {
      browserStorage()?.setItem(`${FALLBACK_OUTBOX_PREFIX}${ownerId}`, JSON.stringify({ ...latestFallback, attempts: latestFallback.attempts + 1, lastError: error.slice(0, 240) }));
    }
    return;
  }
  const db = await openOfflineDb();
  if (!db) return;
  const tx = db.transaction(OUTBOX, "readwrite");
  const done = transactionDone(tx);
  const store = tx.objectStore(OUTBOX);
  const stored = await requestResult(store.get(ownerId)) as OfflineOutbox | undefined;
  if (stored?.fingerprint === current.fingerprint) {
    store.put({ ...stored, attempts: stored.attempts + 1, lastError: error.slice(0, 240) });
  }
  await done;
}

export function writeCloudBundleToStorage(storage: Pick<Storage, "getItem" | "setItem">, bundle: CloudDataBundle) {
  storage.setItem(STORAGE_KEYS.courses, JSON.stringify(bundle.courses));
  storage.setItem(STORAGE_KEYS.history, JSON.stringify(bundle.history));
  storage.setItem(STORAGE_KEYS.rivals, JSON.stringify(bundle.rivals));
  storage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify(bundle.frequentPlayers));
  storage.setItem(STORAGE_KEYS.frequentGroups, serializeFrequentGroups(bundle.frequentGroups));
  storage.setItem(STORAGE_KEYS.contrast, String(bundle.preferences.highContrast));
  storage.setItem(STORAGE_KEYS.notifications, String(bundle.preferences.notificationsEnabled));
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
  const local = collectLocalCloudData(storage, defaultHandicap, hasLocalCloudPreferenceState(storage));
  const recovered = mergeLocalAndCloud(local, saved.bundle);
  writeCloudBundleToStorage(storage, recovered);
  return recovered;
}
