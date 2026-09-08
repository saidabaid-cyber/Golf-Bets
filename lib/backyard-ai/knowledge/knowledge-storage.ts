import { memoryStorageKey, removeMemoryDocument } from "../memory/storage";
import { cleanMemoryId, validIsoDate } from "../memory/types";
import type { KnowledgeItem, KnowledgeSource } from "./knowledge-types";
import { auditKnowledgeItem, validateKnowledgeSource } from "./provenance";

export const PERSONAL_KNOWLEDGE_NAMESPACE = "personal-knowledge";
export const MAX_LOCAL_KNOWLEDGE_SOURCES = 250;
export const MAX_LOCAL_KNOWLEDGE_ITEMS = 2_000;

export type LocalKnowledgeCatalog = {
  version: 1;
  ownerId: string;
  sources: KnowledgeSource[];
  items: KnowledgeItem[];
  updatedAt: string;
};

function emptyCatalog(ownerId: string, now: string): LocalKnowledgeCatalog {
  return {
    version: 1,
    ownerId: cleanMemoryId(ownerId) ?? "",
    sources: [],
    items: [],
    updatedAt: validIsoDate(now) ? now : new Date(0).toISOString(),
  };
}

function jsonClone<T>(value: T): T | null {
  try { return JSON.parse(JSON.stringify(value)) as T; }
  catch { return null; }
}

function normalizeCatalog(value: unknown, ownerId: string, now: string) {
  const fallback = emptyCatalog(ownerId, now);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const source = value as { version?: unknown; ownerId?: unknown; sources?: unknown; items?: unknown; updatedAt?: unknown };
  if (
    source.version !== 1
    || cleanMemoryId(source.ownerId) !== cleanMemoryId(ownerId)
    || !Array.isArray(source.sources)
    || !Array.isArray(source.items)
  ) return fallback;
  const sourceIds = new Set<string>();
  const sources = source.sources.flatMap((candidate): KnowledgeSource[] => {
    const cloned = jsonClone(candidate) as KnowledgeSource | null;
    if (
      !cloned
      || sourceIds.has(cloned.id)
      || cloned.scope === "GLOBAL"
      || cloned.ownerId !== fallback.ownerId
      || validateKnowledgeSource(cloned).length
    ) return [];
    sourceIds.add(cloned.id);
    return [cloned];
  }).slice(0, MAX_LOCAL_KNOWLEDGE_SOURCES);
  const sourceById = new Map(sources.map((candidate) => [candidate.id, candidate]));
  const itemIds = new Set<string>();
  const items = source.items.flatMap((candidate): KnowledgeItem[] => {
    const cloned = jsonClone(candidate) as KnowledgeItem | null;
    const provenance = cloned ? sourceById.get(cloned.sourceId) : undefined;
    if (
      !cloned
      || itemIds.has(cloned.id)
      || cloned.scope === "GLOBAL"
      || cloned.ownerId !== fallback.ownerId
      || !auditKnowledgeItem(cloned, provenance).valid
    ) return [];
    itemIds.add(cloned.id);
    return [cloned];
  }).slice(0, MAX_LOCAL_KNOWLEDGE_ITEMS);
  return {
    version: 1 as const,
    ownerId: fallback.ownerId,
    sources,
    items,
    updatedAt: validIsoDate(source.updatedAt) ? source.updatedAt : fallback.updatedAt,
  };
}

export function personalKnowledgeStorageKey(ownerId: string) {
  return memoryStorageKey(PERSONAL_KNOWLEDGE_NAMESPACE, ownerId);
}

export function readPersonalKnowledgeCatalog(
  storage: Pick<Storage, "getItem">,
  ownerId: string,
  now = new Date().toISOString(),
): { ok: true; catalog: LocalKnowledgeCatalog; recoveredMalformed: boolean } | {
  ok: false;
  catalog: LocalKnowledgeCatalog;
  error: "identity_missing" | "storage_read_failed";
} {
  const fallback = emptyCatalog(ownerId, now);
  const key = personalKnowledgeStorageKey(ownerId);
  if (!key) return { ok: false, catalog: fallback, error: "identity_missing" };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { ok: true, catalog: fallback, recoveredMalformed: false };
    try {
      const parsed = JSON.parse(raw) as unknown;
      const catalog = normalizeCatalog(parsed, ownerId, now);
      return { ok: true, catalog, recoveredMalformed: JSON.stringify(catalog) !== JSON.stringify(parsed) };
    } catch {
      return { ok: true, catalog: fallback, recoveredMalformed: true };
    }
  } catch {
    return { ok: false, catalog: fallback, error: "storage_read_failed" };
  }
}

export function writePersonalKnowledgeCatalog(
  storage: Pick<Storage, "setItem">,
  ownerId: string,
  value: Pick<LocalKnowledgeCatalog, "sources" | "items">,
  now = new Date().toISOString(),
): { ok: true; persisted: true; catalog: LocalKnowledgeCatalog; rejectedSources: number; rejectedItems: number } | {
  ok: false;
  persisted: false;
  catalog: LocalKnowledgeCatalog;
  rejectedSources: number;
  rejectedItems: number;
  error: "identity_missing" | "storage_write_failed";
} {
  const normalized = normalizeCatalog({ version: 1, ownerId, sources: value.sources, items: value.items, updatedAt: now }, ownerId, now);
  const rejectedSources = Math.max(0, value.sources.length - normalized.sources.length);
  const rejectedItems = Math.max(0, value.items.length - normalized.items.length);
  const key = personalKnowledgeStorageKey(ownerId);
  if (!key) return { ok: false, persisted: false, catalog: normalized, rejectedSources, rejectedItems, error: "identity_missing" };
  try {
    storage.setItem(key, JSON.stringify(normalized));
    return { ok: true, persisted: true, catalog: normalized, rejectedSources, rejectedItems };
  } catch {
    return { ok: false, persisted: false, catalog: normalized, rejectedSources, rejectedItems, error: "storage_write_failed" };
  }
}

/** Read-modify-write helper that refuses to overwrite after a read error. */
export function updatePersonalKnowledgeCatalog(
  storage: Pick<Storage, "getItem" | "setItem">,
  ownerId: string,
  update: (catalog: LocalKnowledgeCatalog) => Pick<LocalKnowledgeCatalog, "sources" | "items">,
  now = new Date().toISOString(),
) {
  const current = readPersonalKnowledgeCatalog(storage, ownerId, now);
  if (!current.ok) {
    return {
      ok: false as const,
      persisted: false as const,
      catalog: current.catalog,
      rejectedSources: 0,
      rejectedItems: 0,
      error: current.error,
    };
  }
  return writePersonalKnowledgeCatalog(storage, ownerId, update(current.catalog), now);
}

export function removePersonalKnowledgeCatalog(storage: Pick<Storage, "removeItem">, ownerId: string) {
  return removeMemoryDocument(storage, PERSONAL_KNOWLEDGE_NAMESPACE, ownerId);
}
