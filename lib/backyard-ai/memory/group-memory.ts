import { normalizeGroupPreference, preferenceSemanticKey, upsertPreference } from "./preference-utils";
import {
  memoryStorageKey,
  readMemoryDocument,
  removeMemoryDocument,
  writeMemoryDocument,
  type MemoryReadableStorage,
  type MemoryRemovableStorage,
  type MemoryStorage,
  type MemoryWriteResult,
} from "./storage";
import { cleanMemoryId, type GroupPreference } from "./types";

export const GROUP_AI_PREFERENCES_NAMESPACE = "group-preferences";
export const MAX_GROUP_AI_PREFERENCES = 1_000;

export function groupPreferenceStorageKey(ownerId: string) {
  return memoryStorageKey(GROUP_AI_PREFERENCES_NAMESPACE, ownerId);
}

export function readGroupPreferences(storage: MemoryReadableStorage, ownerId: string, groupId?: string, now?: string) {
  const result = readMemoryDocument(storage, GROUP_AI_PREFERENCES_NAMESPACE, ownerId, normalizeGroupPreference, now);
  const items = result.document.items.filter((item) => (
    item.ownerId === result.document.ownerId && (!groupId || item.groupId === groupId)
  ));
  return { ...result, document: { ...result.document, items } };
}

export function writeGroupPreferences(
  storage: Pick<MemoryStorage, "setItem">,
  ownerId: string,
  preferences: readonly GroupPreference[],
  now?: string,
) {
  const owner = cleanMemoryId(ownerId) ?? "";
  const seenIds = new Set<string>();
  const seenPreferences = new Set<string>();
  const ownerPreferences = preferences
    .map(normalizeGroupPreference)
    .filter((item): item is GroupPreference => item !== null && item.ownerId === owner)
    .filter((item) => {
      const semanticKey = preferenceSemanticKey(item);
      if (seenIds.has(item.id) || seenPreferences.has(semanticKey)) return false;
      seenIds.add(item.id);
      seenPreferences.add(semanticKey);
      return true;
    })
    .slice(0, MAX_GROUP_AI_PREFERENCES);
  return writeMemoryDocument(storage, GROUP_AI_PREFERENCES_NAMESPACE, owner, ownerPreferences, now);
}

export function persistGroupPreference(
  storage: MemoryStorage,
  preference: GroupPreference,
  now?: string,
): MemoryWriteResult<GroupPreference> | {
  ok: false;
  persisted: false;
  document: ReturnType<typeof readGroupPreferences>["document"];
  error: "invalid_preference" | "storage_read_failed" | "identity_missing";
} {
  const normalized = normalizeGroupPreference(preference);
  if (!normalized) {
    return { ok: false, persisted: false, document: { version: 1, ownerId: preference.ownerId, items: [], updatedAt: now ?? new Date().toISOString() }, error: "invalid_preference" };
  }
  const current = readGroupPreferences(storage, normalized.ownerId, undefined, now);
  if (!current.ok) return { ok: false, persisted: false, document: current.document, error: current.error };
  return writeGroupPreferences(storage, normalized.ownerId, upsertPreference(current.document.items, normalized), now);
}

export function removeGroupPreferences(storage: MemoryRemovableStorage, ownerId: string) {
  return removeMemoryDocument(storage, GROUP_AI_PREFERENCES_NAMESPACE, ownerId);
}
