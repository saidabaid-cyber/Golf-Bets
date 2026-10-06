import type { Course, FrequentGroup, FrequentPlayer, RoundSnapshot, SavedPersonalRival } from "./types";
import { STORAGE_KEYS, hasRoundProgress, readStoredJson } from "./round-utils";
import { parseFrequentGroups } from "./frequent-templates";
import { fetchWithTimeout } from "./network-timeout";
import { normalizeRoundStartedAt, withDerivedRoundLifecycle } from "./round-lifecycle";

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

export function hasLocalCloudPreferenceState(storage: ReadableStorage) {
  // Notification intent is owned by the optional-authorization API/ledger.
  // Its local cache must not make this generic sync believe it owns the
  // unrelated visual/profile preference row.
  return storage.getItem(STORAGE_KEYS.contrast) !== null;
}

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
  // Hole navigation belongs to one round, never to the replacement draft.
  if (!local.roundId || local.roundId !== restored.roundId) return restored;
  if (Number.isInteger(local.currentIndex)) restored.currentIndex = local.currentIndex;
  return restored;
}

function parseDraftBase(value: string | undefined) {
  if (!value) return undefined;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}

export function collectLocalCloudData(storage: ReadableStorage, defaultHandicap: number | null = null, hasLocalPreferenceState = hasLocalCloudPreferenceState(storage)): CloudDataBundle {
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
      // Absence is legacy/unknown, never proof that the owner opted in. The
      // Auth bootstrap persists ON for new accounts and cloud merge restores it.
      notificationsEnabled: storage.getItem(STORAGE_KEYS.notifications) === "true",
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

function fingerprint(value: unknown) {
  const text = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v${CLOUD_SYNC_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function cloudDataFingerprint(bundle: CloudDataBundle) {
  return fingerprint({
    ...bundle,
    // Kept in CloudPreferences as a local runtime/cache value for backwards
    // compatibility, but deliberately excluded from generic cloud ownership.
    preferences: cloudOwnedPreferences(bundle.preferences),
  });
}

function cloudOwnedPreferences(preferences: CloudPreferences) {
  return {
    highContrast: preferences.highContrast,
    language: preferences.language,
    defaultHandicap: preferences.defaultHandicap,
    hasLocalState: preferences.hasLocalState,
    updatedAt: preferences.updatedAt,
  };
}

function cloudOwnedPreferenceValue(preferences: CloudPreferences) {
  return {
    highContrast: preferences.highContrast,
    language: preferences.language,
    defaultHandicap: preferences.defaultHandicap,
  };
}

/** Fingerprint only data that can change the canonical account snapshot.
 * Device and three-way-merge metadata are local coordination details and must
 * never turn an otherwise identical foreground poll into another POST. */
export function cloudSyncPayloadFingerprint(bundle: CloudDataBundle) {
  const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  const preferences = {
    highContrast: bundle.preferences.highContrast,
    language: bundle.preferences.language,
    defaultHandicap: bundle.preferences.defaultHandicap,
    updatedAt: bundle.preferences.updatedAt,
  };
  return fingerprint({
    version: bundle.version,
    history: byId(bundle.history),
    frequentPlayers: byId(bundle.frequentPlayers),
    frequentGroups: byId(bundle.frequentGroups),
    rivals: byId(bundle.rivals),
    courses: byId(bundle.courses),
    preferences,
    activeDraft: stripLocalRoundUi(bundle.activeDraft),
    activeDraftUpdatedAt: bundle.activeDraftUpdatedAt,
    tombstones: [...bundle.tombstones].sort((a, b) => `${a.entityType}:${a.localId}`.localeCompare(`${b.entityType}:${b.localId}`)),
  });
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
  return trackLocalCloudEditValues(storage, draft, preferences, readStoredJson(storage, STORAGE_KEYS.draft, null), now);
}

/** Records metadata after a verified checkpoint while still comparing against
 * the draft that existed before the write. */
export function trackLocalCloudCheckpoint(storage: Pick<Storage, "getItem" | "setItem">, draft: unknown, preferences: Omit<CloudPreferences, "updatedAt">, previousDraft: unknown, now = new Date().toISOString()) {
  return trackLocalCloudEditValues(storage, draft, preferences, previousDraft, now);
}

function trackLocalCloudEditValues(storage: Pick<Storage, "getItem" | "setItem">, draft: unknown, preferences: Omit<CloudPreferences, "updatedAt">, previousDraft: unknown, now: string) {
  const meta = readStoredJson<{ draftAt?: string; preferencesAt?: string; draftValue?: string; preferenceValue?: string }>(storage, CLOUD_LOCAL_META_KEY, {});
  const cloudDraft = stripLocalRoundUi(draft);
  const draftValue = JSON.stringify(stableValue(hasRoundProgress(cloudDraft) ? cloudDraft : null));
  const preferenceValue = JSON.stringify([preferences.highContrast, preferences.language, preferences.defaultHandicap]);
  const oldDraft = JSON.stringify(stableValue(stripLocalRoundUi(previousDraft)));
  if (meta.draftValue !== draftValue && (meta.draftValue !== undefined || (draftValue !== "null" && oldDraft !== draftValue))) meta.draftAt = now;
  if (meta.preferenceValue !== preferenceValue && meta.preferenceValue !== undefined) meta.preferencesAt = now;
  storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({ ...meta, draftValue, preferenceValue }));
}

export function persistCloudMetadata(storage: Pick<Storage, "setItem">, bundle: CloudDataBundle) {
  const cloudDraft = stripLocalRoundUi(bundle.activeDraft);
  const confirmedBase = bundle.baseDraftFingerprint !== undefined
    ? stripLocalRoundUi(bundle.baseDraft)
    : cloudDraft;
  const confirmedAt = bundle.baseDraftFingerprint !== undefined
    ? bundle.baseDraftUpdatedAt
    : bundle.activeDraftUpdatedAt;
  storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({ draftAt: bundle.activeDraftUpdatedAt, preferencesAt: bundle.preferences.updatedAt,
    draftValue: JSON.stringify(stableValue(cloudDraft)),
    cloudDraftAt: confirmedAt,
    cloudDraftFingerprint: JSON.stringify(stableValue(confirmedBase)),
    preferenceValue: JSON.stringify([bundle.preferences.highContrast, bundle.preferences.language, bundle.preferences.defaultHandicap]),
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

function mergeRoundHistory(local: RoundSnapshot[], cloud: RoundSnapshot[]) {
  const localById = new Map(local.map(round => [round.id, round]));
  const cloudById = new Map(cloud.map(round => [round.id, round]));
  // Shared history is a server-owned view. Never resurrect an anonymized name
  // from a newer browser clock, retain revoked access, or import a local copy.
  const ownedLocal = local.filter(round => round.cloudReadOnly !== true && !round.id.startsWith("shared:"));
  return mergeCloudCollection(ownedLocal, cloud, round => round.id, round => round.updatedAt || round.completedAt || round.date)
    .map(round => {
      if (round.cloudReadOnly) return round;
      const startedAt = earliestHistoricalStartedAt(localById.get(round.id), cloudById.get(round.id));
      return startedAt ? { ...round, startedAt } : round;
    });
}

function earliestHistoricalStartedAt(...rounds: Array<RoundSnapshot | undefined>) {
  return rounds
    .map(round => normalizeRoundStartedAt(round?.startedAt))
    .filter((value): value is string => Boolean(value))
    .sort()[0];
}

function reconcileHistoricalStartedAt(local: RoundSnapshot, cloud: RoundSnapshot) {
  const startedAt = earliestHistoricalStartedAt(local, cloud);
  return startedAt
    ? [{ ...local, startedAt }, { ...cloud, startedAt }] as const
    : [local, cloud] as const;
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

function roundIdOf(value: unknown) {
  return isRecord(value) && typeof value.roundId === "string" && value.roundId.trim() ? value.roundId : undefined;
}

function sharedRoundStartedAt(base: unknown, local: unknown, cloud: unknown) {
  const localRoundId = roundIdOf(local);
  const cloudRoundId = roundIdOf(cloud);
  if (!localRoundId || localRoundId !== cloudRoundId) return undefined;
  const candidates = [local, cloud, ...(roundIdOf(base) === localRoundId ? [base] : [])]
    .map(value => isRecord(value) ? normalizeRoundStartedAt(value.startedAt) : undefined)
    .filter((value): value is string => Boolean(value));
  return candidates.sort()[0];
}

function withSharedRoundStartedAt(value: unknown, startedAt: string | undefined) {
  return startedAt && isRecord(value) ? { ...value, startedAt } : value;
}

function mergeDraftNode(
  base: unknown,
  local: unknown,
  cloud: unknown,
  parts: string[],
  context: Pick<CloudDataBundle, "deviceId" | "activeDraftUpdatedAt"> & { cloudDeviceId?: string; cloudUpdatedAt?: string; sharedStartedAt?: string },
  conflicts: CloudDataConflict[],
): unknown {
  if (context.sharedStartedAt && parts.length === 1 && parts[0] === "startedAt") return context.sharedStartedAt;
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
  // A response from an earlier write by this same installation is not a
  // two-device conflict. The local value is the newer edit and will be rebased
  // on the confirmed cloud response by the next acknowledged cycle.
  if (context.deviceId && context.deviceId === context.cloudDeviceId) return structuredClone(local);
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

function hasLifecycleMetadata(value: unknown) {
  return isRecord(value) && (Object.hasOwn(value, "lifecycleState") || Boolean(normalizeRoundStartedAt(value.startedAt)));
}

/** `draft`/`live`/`completed` are projections of durable round facts, not an
 * independently editable field. Remove that projection before a three-way
 * merge and derive it again afterwards. `cancelled` remains an explicit user
 * action and therefore participates in conflict resolution. */
function withoutDerivedLifecycle(value: unknown) {
  const stripped = stripLocalRoundUi(value);
  if (!isRecord(stripped) || stripped.lifecycleState === "cancelled") return stripped;
  const result = { ...stripped };
  delete result.lifecycleState;
  return result;
}

function restoreMergedLifecycle(value: unknown, lifecycleAware: boolean) {
  return lifecycleAware && isRecord(value) ? withDerivedRoundLifecycle(value) : value;
}

export function mergeActiveDraftGranular(local: CloudDataBundle, cloud: CloudDataBundle) {
  const conflicts: CloudDataConflict[] = [];
  const hasBase = local.baseDraftFingerprint !== undefined;
  const base = hasBase ? (local.baseDraft !== undefined ? local.baseDraft : parseDraftBase(local.baseDraftFingerprint)) : undefined;
  const lifecycleAware = [base, local.activeDraft, cloud.activeDraft].some(hasLifecycleMetadata);
  const localDraft = withoutDerivedLifecycle(local.activeDraft);
  const cloudDraft = withoutDerivedLifecycle(cloud.activeDraft);
  const baseDraft = withoutDerivedLifecycle(base);
  // A round can be started independently while two devices are offline. Start
  // is monotonic for one round id, so keep the earliest valid instant. Never
  // carry it across a replacement round with a different id.
  const sharedStartedAt = sharedRoundStartedAt(baseDraft, localDraft, cloudDraft);
  const restore = (value: unknown) => restoreMergedLifecycle(withSharedRoundStartedAt(value, sharedStartedAt), lifecycleAware);
  const localHasProgress = hasRoundProgress(localDraft);
  const cloudHasProgress = hasRoundProgress(cloudDraft);
  const sameInstallation = Boolean(local.deviceId && cloud.deviceId && local.deviceId === cloud.deviceId);
  const differentInstallations = Boolean(local.deviceId && cloud.deviceId && local.deviceId !== cloud.deviceId);

  if (sameValue(localDraft, cloudDraft)) return { value: restore(localDraft), conflicts };

  // A canonical response can carry a server timestamp newer than the edit that
  // triggered it even though its draft payload is older. During active capture,
  // this installation's durable local draft is authoritative and is uploaded on
  // the next acknowledged cycle; never let that response roll scores backward.
  // Without a common base, an older response from this installation cannot be
  // separated safely from a newer local edit, so keep the complete local
  // draft. Once a base exists, the field-level merge is safe and must run:
  // the acknowledged response may also contain compatible edits imported
  // from another device, and replacing it wholesale would discard them.
  if (sameInstallation && localHasProgress && !hasBase) return { value: restore(localDraft), conflicts };

  if (!hasBase) {
    if (localDraft === null || cloudDraft === null) {
      const localAt = timestamp(local.activeDraftUpdatedAt);
      const cloudAt = timestamp(cloud.activeDraftUpdatedAt);
      if (localAt || cloudAt) return { value: restore(localAt >= cloudAt ? localDraft : cloudDraft), conflicts };
    }
    if (!localHasProgress || !cloudHasProgress) return { value: restore(localHasProgress ? localDraft : cloudDraft), conflicts };
    // With two identified installations and no common base, timestamps alone
    // cannot prove that one set of scores contains the other. Merge compatible
    // fields and surface only genuinely divergent fields for explicit choice.
    if (!differentInstallations && timestamp(local.activeDraftUpdatedAt) !== timestamp(cloud.activeDraftUpdatedAt)) {
      return { value: restore(chooseLocalVersion(local.activeDraftUpdatedAt, cloud.activeDraftUpdatedAt, localHasProgress) ? localDraft : cloudDraft), conflicts };
    }
  }
  const value = mergeDraftNode(baseDraft, localDraft, cloudDraft, [], {
    deviceId: local.deviceId,
    activeDraftUpdatedAt: local.activeDraftUpdatedAt,
    cloudDeviceId: cloud.deviceId,
    cloudUpdatedAt: cloud.activeDraftUpdatedAt,
    sharedStartedAt,
  }, conflicts);
  return {
    value: restore(value),
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
    history: mergeRoundHistory(local.history, cloud.history).filter((round) => !deleted.has(`round:${round.id}`)),
    frequentPlayers: mergeCloudCollection(local.frequentPlayers, cloud.frequentPlayers, (player) => player.id, (player) => player.updatedAt).filter((player) => !deleted.has(`frequent_player:${player.id}`)),
    frequentGroups: mergeCloudCollection(local.frequentGroups, cloud.frequentGroups, (group) => group.id, (group) => group.updatedAt).filter((group) => !deleted.has(`frequent_group:${group.id}`)),
    rivals: mergeCloudCollection(local.rivals, cloud.rivals, (rival) => rival.id, (rival) => rival.updatedAt).filter((rival) => !deleted.has(`rival:${rival.id}`)),
    courses: mergeCloudCollection(local.courses, cloud.courses, (course) => course.id, (course) => course.updatedAt).filter((course) => !deleted.has(`course:${course.id}`)),
    preferences: {
      ...(localPreferences ? local.preferences : cloud.preferences),
      // Generic cloud sync never owns notification intent. Preserve the cache
      // hydrated by the canonical optional-authorization API even when an old
      // cloud snapshot has a newer preference timestamp.
      notificationsEnabled: local.preferences.notificationsEnabled,
      hasLocalState: true,
    },
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

/** Describe the UI work required after a conflict-free draft reconciliation.
 * A compatible cloud edit must reach React state even while a round is active;
 * writing only localStorage lets the next state-driven autosave erase it. */
export function cloudDraftApplyPlan(localDraft: unknown, reconciledDraft: unknown) {
  const changed = !sameValue(stripLocalRoundUi(localDraft), stripLocalRoundUi(reconciledDraft));
  return {
    changed,
    preservePrevious: changed && !hasRoundProgress(localDraft),
  };
}

/** During active capture this installation is authoritative for its draft.
 * Other account collections still merge normally, while the cloud draft is
 * retained only as the next compare-and-swap base. */
export function mergeLocalFirstActiveDraft(local: CloudDataBundle, cloud: CloudDataBundle): CloudDataBundle {
  const merged = mergeLocalAndCloud(local, cloud);
  if (!hasRoundProgress(local.activeDraft)) return merged;
  const activeDraft = stripLocalRoundUi(local.activeDraft);
  const cloudDraft = stripLocalRoundUi(cloud.activeDraft);
  const draftNeedsWrite = !sameValue(activeDraft, cloudDraft);
  return {
    ...merged,
    activeDraft,
    activeDraftUpdatedAt: draftNeedsWrite
      ? timestampAfter(local.activeDraftUpdatedAt, cloud.activeDraftUpdatedAt)
      : cloud.activeDraftUpdatedAt,
    baseDraft: cloudDraft,
    baseDraftUpdatedAt: cloud.activeDraftUpdatedAt,
    baseDraftFingerprint: JSON.stringify(stableValue(cloudDraft)),
  };
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
      if (collection === "history" && ((item as RoundSnapshot).cloudReadOnly || (other as RoundSnapshot).cloudReadOnly
        || item.id.startsWith("shared:"))) continue;
      const localAt = "updatedAt" in item ? item.updatedAt : undefined;
      const cloudAt = "updatedAt" in other ? other.updatedAt : undefined;
      const [localValue, cloudValue] = collection === "history"
        ? reconcileHistoricalStartedAt(item as RoundSnapshot, other as RoundSnapshot)
        : [item, other];
      if (timestamp(localAt) > 0 && timestamp(localAt) === timestamp(cloudAt) && !sameValue(localValue, cloudValue)) {
        conflicts.push({ collection, localId: item.id, localValue, cloudValue, updatedAt: localAt, localDeviceId: local.deviceId, cloudDeviceId: cloud.deviceId });
      }
    }
  }
  conflicts.push(...mergeActiveDraftGranular(local, cloud).conflicts);
  if (timestamp(local.preferences.updatedAt) > 0 && timestamp(local.preferences.updatedAt) === timestamp(cloud.preferences.updatedAt) && local.preferences.hasLocalState && cloud.preferences.hasLocalState && !sameValue(cloudOwnedPreferenceValue(local.preferences), cloudOwnedPreferenceValue(cloud.preferences))) {
    conflicts.push({ collection: "preferences", localId: "preferences", localValue: local.preferences, cloudValue: cloud.preferences, updatedAt: local.preferences.updatedAt, localDeviceId: local.deviceId, cloudDeviceId: cloud.deviceId });
  }
  return conflicts;
}

/** Client-only ownership guard. The service keeps its granular merge so
 * compatible account data can converge, but an installation actively
 * capturing a round never accepts a different draft from another device. */
export function findActiveDraftOwnershipConflicts(local: CloudDataBundle, cloud: CloudDataBundle) {
  const localDraftActive = hasRoundProgress(local.activeDraft);
  const differentInstallation = Boolean(local.deviceId && cloud.deviceId && local.deviceId !== cloud.deviceId);
  const cloudDraft = stripLocalRoundUi(cloud.activeDraft);
  const differentDraft = !sameValue(stripLocalRoundUi(local.activeDraft), cloudDraft);
  const cloudChangedSinceLocalBase = local.baseDraftFingerprint === undefined
    || local.baseDraftFingerprint !== JSON.stringify(stableValue(cloudDraft));
  if (localDraftActive && differentInstallation && differentDraft && cloudChangedSinceLocalBase) {
    return [{
      collection: "activeDraft",
      localId: "/",
      localValue: stripLocalRoundUi(local.activeDraft),
      cloudValue: stripLocalRoundUi(cloud.activeDraft),
      localDeviceId: local.deviceId,
      cloudDeviceId: cloud.deviceId,
      localUpdatedAt: local.activeDraftUpdatedAt,
      cloudUpdatedAt: cloud.activeDraftUpdatedAt,
    } satisfies CloudDataConflict];
  }
  return [];
}

export function isSameDeviceCloudConflict(conflict: CloudDataConflict) {
  return Boolean(conflict.localDeviceId && conflict.cloudDeviceId && conflict.localDeviceId === conflict.cloudDeviceId);
}

export function actionableCloudConflicts(conflicts: CloudDataConflict[]) {
  return conflicts.filter(conflict => !isSameDeviceCloudConflict(conflict));
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
      resolved.preferences = {
        ...(selected as CloudPreferences),
        notificationsEnabled: resolved.preferences.notificationsEnabled,
        updatedAt: now,
        hasLocalState: true,
      };
    } else {
      const collection = resolved[conflict.collection] as Array<{ id: string; updatedAt?: string }>;
      const historicalStartedAt = conflict.collection === "history"
        ? earliestHistoricalStartedAt(conflict.localValue as RoundSnapshot, conflict.cloudValue as RoundSnapshot)
        : undefined;
      const updated = { ...(selected as { id: string }), ...(historicalStartedAt ? { startedAt: historicalStartedAt } : {}), updatedAt: now };
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
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; code?: string; conflicts?: CloudDataConflict[]; data?: CloudDataBundle; fingerprint?: string; canonicalFingerprint?: string; unchanged?: boolean };
  if (!response.ok) throw new CloudSyncHttpError(payload.error || "No fue posible sincronizar la nube.", response.status, payload.code || "", Array.isArray(payload.conflicts) ? payload.conflicts : []);
  return payload;
}

/** Omitted unchanged collection rows retain the current server version through
 * the existing merge protocol. Tombstones remain explicit; never omit draft or
 * preference revision/base metadata required for three-way reconciliation. */
export function cloudUploadDelta(bundle: CloudDataBundle, base: CloudDataBundle) {
  const delta = { ...bundle };
  for (const key of ["history", "frequentPlayers", "frequentGroups", "rivals", "courses"] as const) {
    const remote = new Map(base[key].map(item => [item.id, item]));
    // These collections are individually keyed, not ordered gameplay arrays.
    (delta[key] as Array<{ id: string }>) = bundle[key].filter(item => {
      const other = remote.get(item.id);
      if (!other) return true;
      if (JSON.stringify(stableValue(other)) === JSON.stringify(stableValue(item))) return false;
      if (bundle.deviceId && bundle.deviceId === base.deviceId) {
        const localRound = item as RoundSnapshot, cloudRound = other as RoundSnapshot;
        const closing = key === "history" && cloudRound.lifecycleState === "live" && localRound.lifecycleState === "completed" && localRound.scorekeeping?.version === 1;
        // CAS keeps an equal-clock canonical row. Local display defaults are
        // not a new revision. Never omit the special live→completed transition
        // or suppress another device's conflicting material.
        // Match writeVersionedRow's effective clock, including catalog rows
        // whose missing timestamp is stored as the epoch and legacy cards
        // whose revision falls back to completedAt/date. Comparing only the
        // literal updatedAt left normalized catalog defaults dirty on reload.
        const revision = (row: RoundSnapshot) => key === "history"
          ? row.updatedAt || row.completedAt || row.date
          : row.updatedAt;
        if (!closing && timestamp(revision(localRound)) === timestamp(revision(cloudRound))) return false;
      }
      return true;
    });
  }
  return delta;
}

/** Compare the effect of the delta, not local-only display normalization that
 * CAS would retain unchanged. This also keeps reload hydration GET-only. */
export function cloudSyncUploadRequired(bundle: CloudDataBundle, remote: CloudDataBundle) {
  return cloudSyncPayloadFingerprint(mergeLocalAndCloud(cloudUploadDelta(bundle, remote), remote)) !== cloudSyncPayloadFingerprint(remote);
}

export async function uploadCloudData(bundle: CloudDataBundle, accessToken: string, base?: CloudDataBundle,
  trace?: (event: { method: "GET" | "POST"; requestBytes: number; responseBytes: number; durationMs: number; success: boolean }) => void) {
  if (!accessToken?.trim()) throw new Error("Inicia sesión para sincronizar con Supabase.");
  const submitted = base ? cloudUploadDelta(bundle, base) : bundle;
  const body = JSON.stringify({ data: submitted, fingerprint: cloudDataFingerprint(submitted) });
  const started = Date.now();
  const response = await fetchWithTimeout("/api/cloud/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, "x-backyard-sync-canonical": "1" },
    cache: "no-store", body,
  });
  const payload = await parseCloudResponse(response).catch(error => {
    trace?.({ method: "POST", requestBytes: new TextEncoder().encode(body).byteLength,
      responseBytes: Number(response.headers.get("content-length")) || 0, durationMs: Date.now() - started, success: response.ok });
    throw error;
  });
  if (payload.ok !== true || payload.fingerprint !== cloudDataFingerprint(submitted)) throw new Error("La nube no confirmó todos los datos. Reintenta la sincronización.");
  if (payload.data && (!payload.canonicalFingerprint || payload.canonicalFingerprint !== cloudSyncPayloadFingerprint(payload.data)))
    throw new Error("La nube no confirmó la versión canónica. Tu copia local se conserva.");
  trace?.({ method: "POST", requestBytes: new TextEncoder().encode(body).byteLength,
    responseBytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength, durationMs: Date.now() - started, success: true });
  return payload;
}

export async function downloadCloudData(accessToken: string, known?: CloudDataBundle,
  trace?: (event: { method: "GET" | "POST"; requestBytes: number; responseBytes: number; durationMs: number; success: boolean }) => void) {
  if (!accessToken?.trim()) throw new Error("Inicia sesión para sincronizar con Supabase.");
  const started = Date.now();
  const query = known ? `?fingerprint=${encodeURIComponent(cloudSyncPayloadFingerprint(known))}` : "";
  const response = await fetchWithTimeout(`/api/cloud/sync${query}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await parseCloudResponse(response);
  trace?.({ method: "GET", requestBytes: 0, responseBytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength,
    durationMs: Date.now() - started, success: true });
  if (payload.unchanged && known && payload.fingerprint === cloudSyncPayloadFingerprint(known)) return known;
  if (!payload.data) throw new Error("La nube respondió sin datos.");
  return payload.data;
}
