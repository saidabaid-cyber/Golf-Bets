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
  /** Stable installation id used only for conflict/audit metadata. */
  deviceId?: string;
  history: RoundSnapshot[];
  frequentPlayers: FrequentPlayer[];
  frequentGroups: FrequentGroup[];
  rivals: SavedPersonalRival[];
  courses: Course[];
  preferences: CloudPreferences;
  activeDraft: unknown | null;
  activeDraftUpdatedAt?: string;
  /** Last canonical draft seen by this device. These fields remain local and
   * let us detect two-device edits instead of trusting wall-clock order. */
  baseDraftUpdatedAt?: string;
  baseDraftFingerprint?: string;
  /** Parsed canonical base kept on this device only for a three-way merge. */
  baseDraft?: unknown | null;
  tombstones: CloudTombstone[];
};

export type CloudConflictCollection = "history" | "frequentPlayers" | "frequentGroups" | "rivals" | "courses" | "preferences" | "activeDraft";
export type CloudDataConflict = {
  collection: CloudConflictCollection;
  localId: string;
  localValue: unknown;
  cloudValue: unknown;
  updatedAt?: string;
  fieldPath?: string;
  playerId?: string;
  hole?: number;
  localDeviceId?: string;
  cloudDeviceId?: string;
  localUpdatedAt?: string;
  cloudUpdatedAt?: string;
};

type ReadableStorage = Pick<Storage, "getItem">;

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function stripLocalRoundUi(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...(value as Record<string, unknown>) };
  delete result.currentIndex;
  delete result.activeTab;
  delete result.openModal;
  delete result.scrollPosition;
  delete result.holeSummary;
  delete result.holeSummaryPaused;
  delete result.holeSummaryRemaining;
  delete result.holeSummaryAdvance;
  delete result.selectedTab;
  delete result.modal;
  delete result.navigation;
  return result;
}

export function restoreLocalRoundUi(cloudDraft: unknown, localDraft: unknown) {
  if (!cloudDraft || typeof cloudDraft !== "object" || Array.isArray(cloudDraft)) return cloudDraft;
  if (!localDraft || typeof localDraft !== "object" || Array.isArray(localDraft)) return cloudDraft;
  const local = localDraft as Record<string, unknown>;
  const restored = { ...(cloudDraft as Record<string, unknown>) };
  if (Number.isInteger(local.currentIndex)) restored.currentIndex = local.currentIndex;
  return restored;
}

function parseDraftBase(value: string | undefined) {
  if (!value) return undefined;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}

export function collectLocalCloudData(storage: ReadableStorage, defaultHandicap: number | null = null, hasLocalPreferenceState = storage.getItem(STORAGE_KEYS.contrast) !== null): CloudDataBundle {
  const meta = readStoredJson<{ draftAt?: string; preferencesAt?: string; cloudDraftAt?: string; cloudDraftFingerprint?: string }>(storage, CLOUD_LOCAL_META_KEY, {});
  const draft = stripLocalRoundUi(readStoredJson<unknown | null>(storage, STORAGE_KEYS.draft, null));
  return {
    version: CLOUD_SYNC_VERSION,
    history: arrayOrEmpty<RoundSnapshot>(readStoredJson<unknown>(storage, STORAGE_KEYS.history, [])),
    frequentPlayers: arrayOrEmpty<FrequentPlayer>(readStoredJson<unknown>(storage, STORAGE_KEYS.frequentPlayers, [])),
    frequentGroups: parseFrequentGroups(storage.getItem(STORAGE_KEYS.frequentGroups)),
    rivals: arrayOrEmpty<SavedPersonalRival>(readStoredJson<unknown>(storage, STORAGE_KEYS.rivals, [])),
    courses: arrayOrEmpty<Course>(readStoredJson<unknown>(storage, STORAGE_KEYS.courses, [])),
    preferences: {
      highContrast: storage.getItem(STORAGE_KEYS.contrast) !== "false",
      language: "es-MX",
      notificationsEnabled: false,
      defaultHandicap,
      hasLocalState: hasLocalPreferenceState,
      updatedAt: meta.preferencesAt,
    },
    activeDraft: hasRoundProgress(draft) ? draft : null,
    activeDraftUpdatedAt: meta.draftAt,
    baseDraftUpdatedAt: meta.cloudDraftAt,
    baseDraftFingerprint: meta.cloudDraftFingerprint,
    baseDraft: parseDraftBase(meta.cloudDraftFingerprint),
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

function timestampAfter(left?: string, right?: string) {
  const latest = Math.max(timestamp(left), timestamp(right));
  return new Date(latest ? latest + 1 : Date.now()).toISOString();
}

/** The clock advances on edits, never on reload, sync or autosave alone. */
export function trackLocalCloudEdits(storage: Pick<Storage, "getItem" | "setItem">, draft: unknown, preferences: Omit<CloudPreferences, "updatedAt">, now = new Date().toISOString()) {
  const meta = readStoredJson<{ draftAt?: string; preferencesAt?: string; draftValue?: string; preferenceValue?: string }>(storage, CLOUD_LOCAL_META_KEY, {});
  const cloudDraft = stripLocalRoundUi(draft);
  const draftValue = JSON.stringify(stableValue(hasRoundProgress(cloudDraft) ? cloudDraft : null));
  const preferenceValue = JSON.stringify([preferences.highContrast, preferences.language, preferences.notificationsEnabled, preferences.defaultHandicap]);
  const oldDraft = JSON.stringify(stableValue(stripLocalRoundUi(readStoredJson(storage, STORAGE_KEYS.draft, null))));
  if (meta.draftValue !== draftValue && (meta.draftValue !== undefined || (draftValue !== "null" && oldDraft !== draftValue))) meta.draftAt = now;
  if (meta.preferenceValue !== preferenceValue && meta.preferenceValue !== undefined) meta.preferencesAt = now;
  storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({ ...meta, draftValue, preferenceValue }));
}

export function persistCloudMetadata(storage: Pick<Storage, "setItem">, bundle: CloudDataBundle) {
  const cloudDraft = stripLocalRoundUi(bundle.activeDraft);
  storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({ draftAt: bundle.activeDraftUpdatedAt, preferencesAt: bundle.preferences.updatedAt,
    draftValue: JSON.stringify(stableValue(cloudDraft)),
    cloudDraftAt: bundle.activeDraftUpdatedAt,
    cloudDraftFingerprint: JSON.stringify(stableValue(cloudDraft)),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function idArray(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value) && value.every(item => isRecord(item) && typeof item.id === "string");
}

function pointer(parts: string[]) {
  return `/${parts.map(part => part.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function pointerParts(value: string) {
  return value.split("/").slice(1).map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function scoreConflictDetails(parts: string[]) {
  if (parts[0] !== "scores" || parts.length !== 3) return {};
  const hole = Number(parts[1]);
  return { playerId: parts[2], hole: Number.isInteger(hole) ? hole : undefined };
}

function mergeDraftNode(
  base: unknown,
  local: unknown,
  cloud: unknown,
  parts: string[],
  context: Pick<CloudDataBundle, "deviceId" | "activeDraftUpdatedAt"> & { cloudDeviceId?: string; cloudUpdatedAt?: string },
  conflicts: CloudDataConflict[],
): unknown {
  if (sameValue(local, cloud)) return structuredClone(local);
  if (sameValue(local, base)) return structuredClone(cloud);
  if (sameValue(cloud, base)) return structuredClone(local);

  if (isRecord(local) && isRecord(cloud) && (base === undefined || base === null || isRecord(base))) {
    const baseRecord = isRecord(base) ? base : {};
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(local), ...Object.keys(cloud)])) {
      const merged = mergeDraftNode(baseRecord[key], local[key], cloud[key], [...parts, key], context, conflicts);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }

  if (idArray(local) && idArray(cloud) && (base === undefined || base === null || idArray(base))) {
    const baseRows = idArray(base) ? base : [];
    const baseById = new Map(baseRows.map(item => [item.id, item]));
    const localById = new Map(local.map(item => [item.id, item]));
    const cloudById = new Map(cloud.map(item => [item.id, item]));
    const order = [...cloud.map(item => item.id), ...local.map(item => item.id).filter(id => !cloudById.has(id))];
    return order.map(id => mergeDraftNode(baseById.get(id), localById.get(id), cloudById.get(id), [...parts, `@${id}`], context, conflicts)).filter(item => item !== undefined);
  }

  const fieldPath = pointer(parts);
  conflicts.push({
    collection: "activeDraft",
    localId: fieldPath || "/",
    fieldPath,
    localValue: structuredClone(local),
    cloudValue: structuredClone(cloud),
    updatedAt: context.activeDraftUpdatedAt,
    localUpdatedAt: context.activeDraftUpdatedAt,
    cloudUpdatedAt: context.cloudUpdatedAt,
    localDeviceId: context.deviceId,
    cloudDeviceId: context.cloudDeviceId,
    ...scoreConflictDetails(parts),
  });
  // Nothing is uploaded while conflicts exist; retaining the local value here
  // merely provides the base for resolving this exact field in the dialog.
  return structuredClone(local);
}

export function mergeActiveDraftGranular(local: CloudDataBundle, cloud: CloudDataBundle) {
  const conflicts: CloudDataConflict[] = [];
  const hasBase = local.baseDraftFingerprint !== undefined;
  if (!hasBase) {
    if (sameValue(local.activeDraft, cloud.activeDraft)) return { value: stripLocalRoundUi(local.activeDraft), conflicts };
    if (local.activeDraft === null || cloud.activeDraft === null) {
      const localAt = timestamp(local.activeDraftUpdatedAt);
      const cloudAt = timestamp(cloud.activeDraftUpdatedAt);
      if (localAt || cloudAt) return { value: stripLocalRoundUi(localAt >= cloudAt ? local.activeDraft : cloud.activeDraft), conflicts };
    }
    const localHasProgress = hasRoundProgress(local.activeDraft);
    const cloudHasProgress = hasRoundProgress(cloud.activeDraft);
    if (!localHasProgress || !cloudHasProgress) return { value: stripLocalRoundUi(localHasProgress ? local.activeDraft : cloud.activeDraft), conflicts };
    if (timestamp(local.activeDraftUpdatedAt) !== timestamp(cloud.activeDraftUpdatedAt)) {
      return { value: stripLocalRoundUi(chooseLocalVersion(local.activeDraftUpdatedAt, cloud.activeDraftUpdatedAt, localHasProgress) ? local.activeDraft : cloud.activeDraft), conflicts };
    }
  }
  const base = hasBase ? (local.baseDraft !== undefined ? local.baseDraft : parseDraftBase(local.baseDraftFingerprint)) : undefined;
  return {
    value: mergeDraftNode(base, stripLocalRoundUi(local.activeDraft), stripLocalRoundUi(cloud.activeDraft), [], {
      deviceId: local.deviceId,
      activeDraftUpdatedAt: local.activeDraftUpdatedAt,
      cloudDeviceId: cloud.deviceId,
      cloudUpdatedAt: cloud.activeDraftUpdatedAt,
    }, conflicts),
    conflicts,
  };
}

export function mergeLocalAndCloud(local: CloudDataBundle, cloud: CloudDataBundle): CloudDataBundle {
  const tombstones = mergeCloudCollection(
    local.tombstones || [],
    cloud.tombstones || [],
    (item) => `${item.entityType}:${item.localId}`,
    (item) => item.deletedAt,
  );
  const deleted = new Set(tombstones.map((item) => `${item.entityType}:${item.localId}`));
  const draftMerge = mergeActiveDraftGranular(local, cloud);
  const cloudDraft = stripLocalRoundUi(cloud.activeDraft);
  // A device clock may be behind the server clock. When the three-way merge
  // proves that local fields changed on top of the cloud base, advance the
  // revision beyond both clocks. Reusing the cloud timestamp made the CAS skip
  // a valid score update and caused a repeating empty 409 conflict.
  const draftNeedsWrite = !sameValue(draftMerge.value, cloudDraft);
  const localPreferences = chooseLocalVersion(local.preferences.updatedAt, cloud.preferences.updatedAt, local.preferences.hasLocalState);
  return {
    version: CLOUD_SYNC_VERSION,
    deviceId: local.deviceId || cloud.deviceId,
    history: mergeCloudCollection(local.history, cloud.history, (round) => round.id, (round) => round.updatedAt || round.completedAt || round.date).filter((round) => !deleted.has(`round:${round.id}`)),
    frequentPlayers: mergeCloudCollection(local.frequentPlayers, cloud.frequentPlayers, (player) => player.id, (player) => player.updatedAt).filter((player) => !deleted.has(`frequent_player:${player.id}`)),
    frequentGroups: mergeCloudCollection(local.frequentGroups, cloud.frequentGroups, (group) => group.id, (group) => group.updatedAt).filter((group) => !deleted.has(`frequent_group:${group.id}`)),
    rivals: mergeCloudCollection(local.rivals, cloud.rivals, (rival) => rival.id, (rival) => rival.updatedAt).filter((rival) => !deleted.has(`rival:${rival.id}`)),
    courses: mergeCloudCollection(local.courses, cloud.courses, (course) => course.id, (course) => course.updatedAt).filter((course) => !deleted.has(`course:${course.id}`)),
    preferences: { ...(localPreferences ? local.preferences : cloud.preferences), hasLocalState: true },
    activeDraft: draftMerge.value,
    activeDraftUpdatedAt: draftNeedsWrite ? timestampAfter(local.activeDraftUpdatedAt, cloud.activeDraftUpdatedAt) : cloud.activeDraftUpdatedAt,
    // The canonical cloud draft is the three-way base for the write that
    // follows. Keeping an older local base here caused every later write to be
    // reported as the same 409 conflict again.
    baseDraftUpdatedAt: cloud.activeDraftUpdatedAt,
    baseDraftFingerprint: JSON.stringify(stableValue(stripLocalRoundUi(cloud.activeDraft))),
    baseDraft: stripLocalRoundUi(cloud.activeDraft),
    tombstones,
  };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

/** Equal clocks with different payloads cannot be resolved safely by last-write
 * wins. Surface them instead of silently picking a browser. */
export function findAmbiguousCloudConflicts(local: CloudDataBundle, cloud: CloudDataBundle) {
  const conflicts: CloudDataConflict[] = [];
  const collections = ["history", "frequentPlayers", "frequentGroups", "rivals", "courses"] as const;
  for (const collection of collections) {
    const remote = new Map(cloud[collection].map((item) => [item.id, item]));
    for (const item of local[collection]) {
      const other = remote.get(item.id);
      if (!other) continue;
      const localAt = "updatedAt" in item ? item.updatedAt : undefined;
      const cloudAt = "updatedAt" in other ? other.updatedAt : undefined;
      if (timestamp(localAt) > 0 && timestamp(localAt) === timestamp(cloudAt) && !sameValue(item, other)) {
        conflicts.push({ collection, localId: item.id, localValue: item, cloudValue: other, updatedAt: localAt });
      }
    }
  }
  conflicts.push(...mergeActiveDraftGranular(local, cloud).conflicts);
  if (timestamp(local.preferences.updatedAt) > 0 && timestamp(local.preferences.updatedAt) === timestamp(cloud.preferences.updatedAt) && local.preferences.hasLocalState && cloud.preferences.hasLocalState && !sameValue(local.preferences, cloud.preferences)) {
    conflicts.push({ collection: "preferences", localId: "preferences", localValue: local.preferences, cloudValue: cloud.preferences, updatedAt: local.preferences.updatedAt });
  }
  return conflicts;
}

/** Resolve only after an explicit user choice and advance the clock so the
 * selected copy is unambiguous on the next compare-and-swap cycle. */
export function resolveAmbiguousCloudConflicts(local: CloudDataBundle, cloud: CloudDataBundle, conflicts: CloudDataConflict[], choice: "local" | "cloud", now = new Date().toISOString()) {
  const resolved = mergeLocalAndCloud(local, cloud);
  for (const conflict of conflicts) {
    const selected = structuredClone(choice === "local" ? conflict.localValue : conflict.cloudValue);
    if (conflict.collection === "activeDraft") {
      if (conflict.fieldPath) resolved.activeDraft = setDraftPointer(resolved.activeDraft, conflict.fieldPath, selected);
      else resolved.activeDraft = selected;
      resolved.activeDraftUpdatedAt = now;
    } else if (conflict.collection === "preferences") {
      resolved.preferences = { ...(selected as CloudPreferences), updatedAt: now, hasLocalState: true };
    } else {
      const collection = resolved[conflict.collection] as Array<{ id: string; updatedAt?: string }>;
      const updated = { ...(selected as { id: string }), updatedAt: now };
      const index = collection.findIndex((item) => item.id === conflict.localId);
      if (index >= 0) collection[index] = updated as typeof collection[number];
      else collection.push(updated as typeof collection[number]);
    }
  }
  resolved.baseDraft = stripLocalRoundUi(cloud.activeDraft);
  resolved.baseDraftUpdatedAt = cloud.activeDraftUpdatedAt;
  resolved.baseDraftFingerprint = JSON.stringify(stableValue(resolved.baseDraft));
  return resolved;
}

function setDraftPointer(value: unknown, path: string, selected: unknown) {
  const root = structuredClone(value);
  const parts = pointerParts(path);
  if (!parts.length) return structuredClone(selected);
  let cursor: unknown = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (part.startsWith("@") && Array.isArray(cursor)) cursor = cursor.find(item => isRecord(item) && item.id === part.slice(1));
    else if (isRecord(cursor)) cursor = cursor[part];
    else return root;
  }
  const leaf = parts.at(-1)!;
  if (leaf.startsWith("@") && Array.isArray(cursor)) {
    const index = cursor.findIndex(item => isRecord(item) && item.id === leaf.slice(1));
    if (selected === undefined && index >= 0) cursor.splice(index, 1);
    else if (index >= 0) cursor[index] = structuredClone(selected);
    else if (selected !== undefined) cursor.push(structuredClone(selected));
  } else if (isRecord(cursor)) {
    if (selected === undefined) delete cursor[leaf];
    else cursor[leaf] = structuredClone(selected);
  }
  return root;
}

export class CloudSyncHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly conflicts: CloudDataConflict[];
  constructor(message: string, status: number, code = "", conflicts: CloudDataConflict[] = []) {
    super(message);
    this.name = "CloudSyncHttpError";
    this.status = status;
    this.code = code;
    this.conflicts = conflicts;
  }
}

export function isCloudFieldConflict(error: unknown): error is CloudSyncHttpError {
  return error instanceof CloudSyncHttpError && error.status === 409 && error.code === "CLOUD_FIELD_CONFLICT";
}

/** Retry exactly once with a freshly validated Supabase access token. A 401
 * from the cloud route can be caused by an access token expiring between auth
 * and sync; other failures (schema, RLS, conflict, network) must retain their
 * own classification and never trigger a fake sign-out. */
export async function withCloudAuthRetry<T>(
  operation: (accessToken: string) => Promise<T>,
  accessToken: string,
  recover: () => Promise<string>,
) {
  try {
    return await operation(accessToken);
  } catch (error) {
    if (!(error instanceof CloudSyncHttpError) || error.status !== 401) throw error;
    const refreshedToken = await recover();
    if (!refreshedToken) throw error;
    return operation(refreshedToken);
  }
}

async function parseCloudResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; code?: string; conflicts?: CloudDataConflict[]; data?: CloudDataBundle; fingerprint?: string };
  if (!response.ok) throw new CloudSyncHttpError(payload.error || "No fue posible sincronizar la nube.", response.status, payload.code || "", Array.isArray(payload.conflicts) ? payload.conflicts : []);
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
