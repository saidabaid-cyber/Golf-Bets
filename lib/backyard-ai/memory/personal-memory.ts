import { normalizeUserPreference, preferenceSemanticKey, upsertPreference } from "./preference-utils";
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
import { cleanMemoryId, type UserPreference } from "./types";

export const USER_AI_PREFERENCES_NAMESPACE = "user-preferences";
export const MAX_USER_AI_PREFERENCES = 500;

export function userPreferenceStorageKey(ownerId: string) {
  return memoryStorageKey(USER_AI_PREFERENCES_NAMESPACE, ownerId);
}

export function readUserPreferences(storage: MemoryReadableStorage, ownerId: string, now?: string) {
  const result = readMemoryDocument(storage, USER_AI_PREFERENCES_NAMESPACE, ownerId, normalizeUserPreference, now);
  return {
    ...result,
    document: {
      ...result.document,
      items: result.document.items.filter((item) => item.ownerId === result.document.ownerId),
    },
  };
}

export function writeUserPreferences(
  storage: Pick<MemoryStorage, "setItem">,
  ownerId: string,
  preferences: readonly UserPreference[],
  now?: string,
) {
  const owner = cleanMemoryId(ownerId) ?? "";
  const seenIds = new Set<string>();
  const seenPreferences = new Set<string>();
  const ownerPreferences = preferences
    .map(normalizeUserPreference)
    .filter((item): item is UserPreference => item !== null && item.ownerId === owner)
    .filter((item) => {
      const semanticKey = preferenceSemanticKey(item);
      if (seenIds.has(item.id) || seenPreferences.has(semanticKey)) return false;
      seenIds.add(item.id);
      seenPreferences.add(semanticKey);
      return true;
    })
    .slice(0, MAX_USER_AI_PREFERENCES);
  return writeMemoryDocument(storage, USER_AI_PREFERENCES_NAMESPACE, owner, ownerPreferences, now);
}

export function persistUserPreference(
  storage: MemoryStorage,
  preference: UserPreference,
  now?: string,
): MemoryWriteResult<UserPreference> | {
  ok: false;
  persisted: false;
  document: ReturnType<typeof readUserPreferences>["document"];
  error: "invalid_preference" | "storage_read_failed" | "identity_missing";
} {
  const normalized = normalizeUserPreference(preference);
  if (!normalized) {
    return { ok: false, persisted: false, document: { version: 1, ownerId: preference.ownerId, items: [], updatedAt: now ?? new Date().toISOString() }, error: "invalid_preference" };
  }
  const current = readUserPreferences(storage, normalized.ownerId, now);
  if (!current.ok) return { ok: false, persisted: false, document: current.document, error: current.error };
  return writeUserPreferences(storage, normalized.ownerId, upsertPreference(current.document.items, normalized), now);
}

export function removeUserPreferences(storage: MemoryRemovableStorage, ownerId: string) {
  return removeMemoryDocument(storage, USER_AI_PREFERENCES_NAMESPACE, ownerId);
}
