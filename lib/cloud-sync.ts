import type { Course, FrequentGroup, FrequentPlayer, RoundSnapshot, SavedPersonalRival } from "./types";
import { STORAGE_KEYS, hasRoundProgress, readStoredJson } from "./round-utils";
import { parseFrequentGroups } from "./frequent-templates";
import { fetchWithTimeout } from "./network-timeout";

export const CLOUD_SYNC_VERSION = 1;
export const CLOUD_TOMBSTONES_KEY = "backyard-cloud-tombstones-v1";
export const CLOUD_LOCAL_META_KEY = "backyard-cloud-local-meta-v1";

export type CloudEntityType = "round" | "frequent_player" | "frequent_group" | "rival" | "course";
export type CloudTombstone = { entityType: CloudEntityType; localId: string; deletedAt: string };

export type CloudPreferences = {
  highContrast: boolean;
  language: string;
  notificationsEnabled: boolean;
  defaultHandicap: number | null;
  hasLocalState?: boolean;
  updatedAt?: string;
};

export type CloudDataBundle = {
  version: typeof CLOUD_SYNC_VERSION;
  history: RoundSnapshot[];
  frequentPlayers: FrequentPlayer[];
  frequentGroups: FrequentGroup[];
  rivals: SavedPersonalRival[];
  courses: Course[];
  preferences: CloudPreferences;
  activeDraft: unknown | null;
  activeDraftUpdatedAt?: string;
  tombstones: CloudTombstone[];
};

type ReadableStorage = Pick<Storage, "getItem">;

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function collectLocalCloudData(storage: ReadableStorage, defaultHandicap: number | null = null, hasLocalPreferenceState = storage.getItem(STORAGE_KEYS.contrast) !== null): CloudDataBundle {
  const meta = readStoredJson<{ draftAt?: string; preferencesAt?: string }>(storage, CLOUD_LOCAL_META_KEY, {});
  const draft = readStoredJson<unknown | null>(storage, STORAGE_KEYS.draft, null);
  return {
    version: CLOUD_SYNC_VERSION,
    history: arrayOrEmpty<RoundSnapshot>(readStoredJson<unknown>(storage, STORAGE_KEYS.history, [])),
    frequentPlayers: arrayOrEmpty<FrequentPlayer>(readStoredJson<unknown>(storage, STORAGE_KEYS.frequentPlayers, [])),
    frequentGroups: parseFrequentGroups(storage.getItem(STORAGE_KEYS.frequentGroups)),
    rivals: arrayOrEmpty<SavedPersonalRival>(readStoredJson<unknown>(storage, STORAGE_KEYS.rivals, [])),
    courses: arrayOrEmpty<Course>(readStoredJson<unknown>(storage, STORAGE_KEYS.courses, [])),
    preferences: {
      highContrast: storage.getItem(STORAGE_KEYS.contrast) === "true",
      language: "es-MX",
      notificationsEnabled: false,
      defaultHandicap,
      hasLocalState: hasLocalPreferenceState,
      updatedAt: meta.preferencesAt,
    },
    activeDraft: hasRoundProgress(draft) ? draft : null,
    activeDraftUpdatedAt: meta.draftAt,
    tombstones: arrayOrEmpty<CloudTombstone>(readStoredJson<unknown>(storage, CLOUD_TOMBSTONES_KEY, []))
      .filter((item) => item && typeof item.localId === "string" && typeof item.entityType === "string" && typeof item.deletedAt === "string"),
  };
}

export function recordCloudDeletion(
  storage: Pick<Storage, "getItem" | "setItem">,
  entityType: CloudEntityType,
  localId: string,
  deletedAt = new Date().toISOString(),
) {
  if (!localId) return;
  const current = arrayOrEmpty<CloudTombstone>(readStoredJson<unknown>(storage, CLOUD_TOMBSTONES_KEY, []));
  const key = `${entityType}:${localId}`;
  const next = [...current.filter((item) => `${item.entityType}:${item.localId}` !== key), { entityType, localId, deletedAt }];
  storage.setItem(CLOUD_TOMBSTONES_KEY, JSON.stringify(next));
}

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function cloudDataFingerprint(bundle: CloudDataBundle) {
  const text = JSON.stringify(stableValue(bundle));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v${CLOUD_SYNC_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function timestamp(value: string | undefined) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The clock advances on edits, never on reload, sync or autosave alone. */
export function trackLocalCloudEdits(storage: Pick<Storage, "getItem" | "setItem">, draft: unknown, preferences: Omit<CloudPreferences, "updatedAt">, now = new Date().toISOString()) {
  const meta = readStoredJson<{ draftAt?: string; preferencesAt?: string; draftValue?: string; preferenceValue?: string }>(storage, CLOUD_LOCAL_META_KEY, {});
  const draftValue = JSON.stringify(stableValue(hasRoundProgress(draft) ? draft : null));
  const preferenceValue = JSON.stringify([preferences.highContrast, preferences.language, preferences.notificationsEnabled, preferences.defaultHandicap]);
  const oldDraft = JSON.stringify(stableValue(readStoredJson(storage, STORAGE_KEYS.draft, null)));
  if (meta.draftValue !== draftValue && (meta.draftValue !== undefined || (draftValue !== "null" && oldDraft !== draftValue))) meta.draftAt = now;
  if (meta.preferenceValue !== preferenceValue && meta.preferenceValue !== undefined) meta.preferencesAt = now;
  storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({ ...meta, draftValue, preferenceValue }));
}

export function persistCloudMetadata(storage: Pick<Storage, "setItem">, bundle: CloudDataBundle) {
  storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({ draftAt: bundle.activeDraftUpdatedAt, preferencesAt: bundle.preferences.updatedAt,
    draftValue: JSON.stringify(stableValue(bundle.activeDraft)),
    preferenceValue: JSON.stringify([bundle.preferences.highContrast, bundle.preferences.language, bundle.preferences.notificationsEnabled, bundle.preferences.defaultHandicap]),
  }));
}

export function chooseLocalVersion(localAt?: string, remoteAt?: string, legacyLocal = false) {
  return timestamp(localAt) > timestamp(remoteAt) || (!timestamp(localAt) && !timestamp(remoteAt) && legacyLocal);
}

export function mergeCloudCollection<T>(
  local: T[],
  cloud: T[],
  idOf: (item: T) => string,
  updatedAtOf: (item: T) => string | undefined,
) {
  const merged = new Map<string, T>();
  for (const item of cloud) merged.set(idOf(item), item);
  for (const item of local) {
    const id = idOf(item);
    const current = merged.get(id);
    if (!current || timestamp(updatedAtOf(item)) >= timestamp(updatedAtOf(current))) merged.set(id, item);
  }
  return Array.from(merged.values());
}

export function mergeLocalAndCloud(local: CloudDataBundle, cloud: CloudDataBundle): CloudDataBundle {
  const tombstones = mergeCloudCollection(
    local.tombstones || [],
    cloud.tombstones || [],
    (item) => `${item.entityType}:${item.localId}`,
    (item) => item.deletedAt,
  );
  const deleted = new Set(tombstones.map((item) => `${item.entityType}:${item.localId}`));
  const localDraft = chooseLocalVersion(local.activeDraftUpdatedAt, cloud.activeDraftUpdatedAt, hasRoundProgress(local.activeDraft));
  const localPreferences = chooseLocalVersion(local.preferences.updatedAt, cloud.preferences.updatedAt, local.preferences.hasLocalState);
  return {
    version: CLOUD_SYNC_VERSION,
    history: mergeCloudCollection(local.history, cloud.history, (round) => round.id, (round) => round.updatedAt || round.completedAt || round.date).filter((round) => !deleted.has(`round:${round.id}`)),
    frequentPlayers: mergeCloudCollection(local.frequentPlayers, cloud.frequentPlayers, (player) => player.id, (player) => player.updatedAt).filter((player) => !deleted.has(`frequent_player:${player.id}`)),
    frequentGroups: mergeCloudCollection(local.frequentGroups, cloud.frequentGroups, (group) => group.id, (group) => group.updatedAt).filter((group) => !deleted.has(`frequent_group:${group.id}`)),
    rivals: mergeCloudCollection(local.rivals, cloud.rivals, (rival) => rival.id, (rival) => rival.updatedAt).filter((rival) => !deleted.has(`rival:${rival.id}`)),
    courses: mergeCloudCollection(local.courses, cloud.courses, (course) => course.id, (course) => course.updatedAt).filter((course) => !deleted.has(`course:${course.id}`)),
    preferences: { ...(localPreferences ? local.preferences : cloud.preferences), hasLocalState: true },
    activeDraft: localDraft ? local.activeDraft : cloud.activeDraft,
    activeDraftUpdatedAt: localDraft ? local.activeDraftUpdatedAt : cloud.activeDraftUpdatedAt,
    tombstones,
  };
}

async function parseCloudResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; data?: CloudDataBundle; fingerprint?: string };
  if (!response.ok) throw new Error(payload.error || "No fue posible sincronizar la nube.");
  return payload;
}

export async function uploadCloudData(bundle: CloudDataBundle, accessToken: string) {
  if (!accessToken?.trim()) throw new Error("Inicia sesión para sincronizar con Supabase.");
  const response = await fetchWithTimeout("/api/cloud/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ data: bundle, fingerprint: cloudDataFingerprint(bundle) }),
  });
  const payload = await parseCloudResponse(response);
  if (payload.ok !== true || payload.fingerprint !== cloudDataFingerprint(bundle)) throw new Error("La nube no confirmó todos los datos. Reintenta la sincronización.");
  return payload;
}

export async function downloadCloudData(accessToken: string) {
  if (!accessToken?.trim()) throw new Error("Inicia sesión para sincronizar con Supabase.");
  const response = await fetchWithTimeout("/api/cloud/sync", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await parseCloudResponse(response);
  if (!payload.data) throw new Error("La nube respondió sin datos.");
  return payload.data;
}
