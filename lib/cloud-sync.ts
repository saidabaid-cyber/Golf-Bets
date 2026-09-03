import type { Course, FrequentGroup, FrequentPlayer, RoundSnapshot, SavedPersonalRival } from "./types";
import { STORAGE_KEYS, readStoredJson } from "./round-utils";
import { parseFrequentGroups } from "./frequent-templates";

export const CLOUD_SYNC_VERSION = 1;
export const CLOUD_TOMBSTONES_KEY = "backyard-cloud-tombstones-v1";

export type CloudEntityType = "round" | "frequent_player" | "frequent_group" | "rival" | "course";
export type CloudTombstone = { entityType: CloudEntityType; localId: string; deletedAt: string };

export type CloudPreferences = {
  highContrast: boolean;
  language: string;
  notificationsEnabled: boolean;
  defaultHandicap: number | null;
  hasLocalState?: boolean;
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
  tombstones: CloudTombstone[];
};

type ReadableStorage = Pick<Storage, "getItem">;

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function collectLocalCloudData(storage: ReadableStorage, defaultHandicap: number | null = null, hasLocalPreferenceState = storage.getItem(STORAGE_KEYS.contrast) !== null): CloudDataBundle {
  return {
    version: CLOUD_SYNC_VERSION,
    history: arrayOrEmpty<RoundSnapshot>(readStoredJson<unknown>(storage, STORAGE_KEYS.history, [])),
    frequentPlayers: arrayOrEmpty<FrequentPlayer>(readStoredJson<unknown>(storage, STORAGE_KEYS.frequentPlayers, [])),
    frequentGroups: parseFrequentGroups(storage.getItem(STORAGE_KEYS.frequentGroups)),
    rivals: arrayOrEmpty<SavedPersonalRival>(readStoredJson<unknown>(storage, STORAGE_KEYS.rivals, [])),
    courses: arrayOrEmpty<Course>(readStoredJson<unknown>(storage, STORAGE_KEYS.courses, [])).filter((course) => !course.builtIn),
    preferences: {
      highContrast: storage.getItem(STORAGE_KEYS.contrast) === "true",
      language: "es-MX",
      notificationsEnabled: false,
      defaultHandicap,
      hasLocalState: hasLocalPreferenceState,
    },
    activeDraft: readStoredJson<unknown | null>(storage, STORAGE_KEYS.draft, null),
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

function stableValue(value: unknown): unknown {
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

function timestamp(value: string | undefined) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
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
  return {
    version: CLOUD_SYNC_VERSION,
    history: mergeCloudCollection(local.history, cloud.history, (round) => round.id, (round) => round.updatedAt || round.completedAt || round.date).filter((round) => !deleted.has(`round:${round.id}`)),
    frequentPlayers: mergeCloudCollection(local.frequentPlayers, cloud.frequentPlayers, (player) => player.id, (player) => player.updatedAt).filter((player) => !deleted.has(`frequent_player:${player.id}`)),
    frequentGroups: mergeCloudCollection(local.frequentGroups, cloud.frequentGroups, (group) => group.id, (group) => group.updatedAt).filter((group) => !deleted.has(`frequent_group:${group.id}`)),
    rivals: mergeCloudCollection(local.rivals, cloud.rivals, (rival) => rival.id, (rival) => rival.updatedAt).filter((rival) => !deleted.has(`rival:${rival.id}`)),
    courses: mergeCloudCollection(local.courses, cloud.courses, (course) => course.id, (course) => course.updatedAt).filter((course) => !deleted.has(`course:${course.id}`)),
    preferences: {
      ...cloud.preferences,
      highContrast: local.preferences.hasLocalState ? local.preferences.highContrast : cloud.preferences.highContrast,
      language: local.preferences.hasLocalState ? local.preferences.language : cloud.preferences.language,
      notificationsEnabled: local.preferences.hasLocalState ? local.preferences.notificationsEnabled : cloud.preferences.notificationsEnabled,
      defaultHandicap: local.preferences.defaultHandicap ?? cloud.preferences.defaultHandicap,
      hasLocalState: true,
    },
    activeDraft: local.activeDraft ?? cloud.activeDraft,
    tombstones,
  };
}

async function parseCloudResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: string; data?: CloudDataBundle; fingerprint?: string };
  if (!response.ok) throw new Error(payload.error || "No fue posible sincronizar la nube.");
  return payload;
}

export async function uploadCloudData(bundle: CloudDataBundle, accessToken: string) {
  const response = await fetch("/api/cloud/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ data: bundle, fingerprint: cloudDataFingerprint(bundle) }),
  });
  return parseCloudResponse(response);
}

export async function downloadCloudData(accessToken: string) {
  const response = await fetch("/api/cloud/sync", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await parseCloudResponse(response);
  if (!payload.data) throw new Error("La nube respondió sin datos.");
  return payload.data;
}
