import { cleanMemoryId, validIsoDate } from "./types";

export type MemoryReadableStorage = Pick<Storage, "getItem">;
export type MemoryWritableStorage = Pick<Storage, "setItem">;
export type MemoryRemovableStorage = Pick<Storage, "removeItem">;
export type MemoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type MemoryDocument<T> = {
  version: 1;
  ownerId: string;
  items: T[];
  updatedAt: string;
};

export type MemoryReadResult<T> =
  | { ok: true; document: MemoryDocument<T>; recoveredMalformed: boolean }
  | { ok: false; document: MemoryDocument<T>; error: "identity_missing" | "storage_read_failed" };

export type MemoryWriteResult<T> =
  | { ok: true; persisted: true; document: MemoryDocument<T> }
  | { ok: false; persisted: false; document: MemoryDocument<T>; error: "identity_missing" | "storage_write_failed" };

export function memoryStorageKey(namespace: string, ownerId: string): string | null {
  const owner = cleanMemoryId(ownerId);
  const safeNamespace = cleanMemoryId(namespace, 80);
  return owner && safeNamespace ? `the-backyard:ai:${safeNamespace}:v1:${encodeURIComponent(owner)}` : null;
}

export function emptyMemoryDocument<T>(ownerId: string, now = new Date().toISOString()): MemoryDocument<T> {
  return { version: 1, ownerId: cleanMemoryId(ownerId) ?? "", items: [], updatedAt: validIsoDate(now) ? now : new Date(0).toISOString() };
}

function normalizeDocument<T>(value: unknown, ownerId: string, normalize: (value: unknown) => T | null, now: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyMemoryDocument<T>(ownerId, now);
  const candidate = value as { version?: unknown; ownerId?: unknown; items?: unknown; updatedAt?: unknown };
  if (candidate.version !== 1 || cleanMemoryId(candidate.ownerId) !== cleanMemoryId(ownerId) || !Array.isArray(candidate.items)) {
    return emptyMemoryDocument<T>(ownerId, now);
  }
  const items = candidate.items.map(normalize).filter((item): item is T => item !== null);
  return {
    version: 1 as const,
    ownerId: cleanMemoryId(ownerId) ?? "",
    items,
    updatedAt: validIsoDate(candidate.updatedAt) ? candidate.updatedAt : now,
  };
}

export function readMemoryDocument<T>(
  storage: MemoryReadableStorage,
  namespace: string,
  ownerId: string,
  normalize: (value: unknown) => T | null,
  now = new Date().toISOString(),
): MemoryReadResult<T> {
  const fallback = emptyMemoryDocument<T>(ownerId, now);
  const key = memoryStorageKey(namespace, ownerId);
  if (!key) return { ok: false, document: fallback, error: "identity_missing" };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { ok: true, document: fallback, recoveredMalformed: false };
    try {
      const parsed = JSON.parse(raw) as unknown;
      const document = normalizeDocument(parsed, ownerId, normalize, now);
      return { ok: true, document, recoveredMalformed: JSON.stringify(document) !== JSON.stringify(parsed) };
    } catch {
      return { ok: true, document: fallback, recoveredMalformed: true };
    }
  } catch {
    return { ok: false, document: fallback, error: "storage_read_failed" };
  }
}

export function writeMemoryDocument<T>(
  storage: MemoryWritableStorage,
  namespace: string,
  ownerId: string,
  items: readonly T[],
  now = new Date().toISOString(),
): MemoryWriteResult<T> {
  const document: MemoryDocument<T> = {
    version: 1,
    ownerId: cleanMemoryId(ownerId) ?? "",
    items: [...items],
    updatedAt: validIsoDate(now) ? now : new Date(0).toISOString(),
  };
  const key = memoryStorageKey(namespace, ownerId);
  if (!key) return { ok: false, persisted: false, document, error: "identity_missing" };
  try {
    storage.setItem(key, JSON.stringify(document));
    return { ok: true, persisted: true, document };
  } catch {
    return { ok: false, persisted: false, document, error: "storage_write_failed" };
  }
}

export function removeMemoryDocument(
  storage: MemoryRemovableStorage,
  namespace: string,
  ownerId: string,
): { ok: true } | { ok: false; error: "identity_missing" | "storage_remove_failed" } {
  const key = memoryStorageKey(namespace, ownerId);
  if (!key) return { ok: false, error: "identity_missing" };
  try {
    storage.removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, error: "storage_remove_failed" };
  }
}
