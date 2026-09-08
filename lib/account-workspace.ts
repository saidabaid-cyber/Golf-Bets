import { STORAGE_KEYS, readStoredJson } from "./round-utils";
import { CLOUD_LOCAL_META_KEY, CLOUD_TOMBSTONES_KEY } from "./cloud-sync";
import { PHOTO_QUEUE_KEY, roundScorecardPhotoIds } from "./photo-sync-queue";
import { coursePreferenceStorageKey } from "./course-preferences";
import { cloudProfileRevisionKey, forgetProfileWriteClock, pendingProfileWriteKey } from "./profile-sync";
import { internalNotificationStorageKey } from "./internal-notifications";
import { equipmentProfileRecoveryStorageKey, equipmentProfileStorageKey } from "./golf-equipment";
import { ballFitDraftStorageKey } from "./ball-fitting-storage";
import { betaOnboardingDraftStorageKey, betaOnboardingStorageKey } from "./beta-onboarding";
import { deletePersonalAiData, readLearningRecords } from "./backyard-ai/memory/learning-events";
import { bettingConsentPromptStorageKey } from "./account-state";
import { deleteAiProcessingConsents } from "./backyard-ai/processing-consent";

export const WORKSPACE_OWNER_KEY = "backyard-local-workspace-owner-v1";
export const CLOUD_CONFLICTS_KEY = "backyard-cloud-conflicts-v1";
export const CLOUD_DATA_CONFLICTS_KEY = "backyard-cloud-data-conflicts-v1";
const workspaceKeys = [...Object.values(STORAGE_KEYS), CLOUD_LOCAL_META_KEY, CLOUD_TOMBSTONES_KEY, CLOUD_CONFLICTS_KEY, CLOUD_DATA_CONFLICTS_KEY, PHOTO_QUEUE_KEY];
type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const archiveKey = (owner: string) => `backyard-local-workspace-v1:${owner}`;

type SerializedWorkspace = Record<string, string | null | undefined>;
export type AccountOfflinePhotoRecord = { ownerId?: unknown; bundle?: unknown } | null | undefined;
type AccountPhotoStorage = Pick<Storage, "getItem" | "key" | "length">;
const WORKSPACE_ARCHIVE_PREFIX = "backyard-local-workspace-v1:";
const LEARNING_RECORDS_PREFIX = "the-backyard:ai:learning-records:v1:";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parsedJson(value: unknown) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

function addPhotoId(ids: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) ids.add(value);
}

function addRoundPhotoIds(ids: Set<string>, value: unknown) {
  const round = recordValue(value);
  if (!round) return;
  roundScorecardPhotoIds(round).forEach(photoId => ids.add(photoId));
}

function addWorkspacePhotoIds(candidateIds: Set<string>, protectedIds: Set<string>, workspace: SerializedWorkspace, workspaceOwner: string, userId: string) {
  const roundIds = workspaceOwner === userId ? candidateIds : protectedIds;
  const history = parsedJson(workspace[STORAGE_KEYS.history]);
  if (Array.isArray(history)) history.forEach(round => addRoundPhotoIds(roundIds, round));
  addRoundPhotoIds(roundIds, parsedJson(workspace[STORAGE_KEYS.draft]));
  const queue = parsedJson(workspace[PHOTO_QUEUE_KEY]);
  if (!Array.isArray(queue)) return;
  for (const rawJob of queue) {
    const job = recordValue(rawJob);
    if (!job) continue;
    addPhotoId(job.userId === userId ? candidateIds : protectedIds, job.photoId);
  }
}

function addBundlePhotoIds(candidateIds: Set<string>, protectedIds: Set<string>, record: AccountOfflinePhotoRecord, userId: string) {
  const stored = recordValue(record);
  if (typeof stored?.ownerId !== "string") return;
  const bundle = recordValue(stored.bundle);
  if (!bundle) return;
  const ids = stored.ownerId === userId ? candidateIds : protectedIds;
  if (Array.isArray(bundle.history)) bundle.history.forEach(round => addRoundPhotoIds(ids, round));
  addRoundPhotoIds(ids, bundle.activeDraft);
}

function addLearningImageReferences(ids: Set<string>, storage: Pick<Storage, "getItem">, userId: string) {
  const records = readLearningRecords(storage, userId).document.items;
  const pending: unknown[] = [...records];
  // Only normalized, owner-matched personal records enter this walk. Supporting
  // nested imageReference keeps future structured LearningEvent payloads erasable.
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { pending.push(...value); continue; }
    const object = recordValue(value);
    if (!object) continue;
    addPhotoId(ids, object.imageReference);
    pending.push(...Object.entries(object).filter(([key]) => key !== "imageReference").map(([, child]) => child));
  }
}

/** Selects only scorecard blobs attributable to one authenticated account.
 * Round data is accepted solely from that owner's active/archive workspace;
 * queue jobs and offline records additionally require an explicit owner match. */
export function selectAccountScorecardPhotoIds(
  storage: AccountPhotoStorage,
  userId: string,
  offlineRecords: readonly AccountOfflinePhotoRecord[] = [],
  ownedPhotoIds: readonly string[] = [],
) {
  if (!userId || userId === "guest") return [];
  const candidateIds = new Set<string>();
  const ownerIndexedIds = new Set<string>();
  const protectedIds = new Set<string>();
  ownedPhotoIds.forEach((photoId) => { addPhotoId(candidateIds, photoId); addPhotoId(ownerIndexedIds, photoId); });
  const activeOwner = storage.getItem(WORKSPACE_OWNER_KEY) || "guest";
  const active = Object.fromEntries(workspaceKeys.map(key => [key, storage.getItem(key)]));
  addWorkspacePhotoIds(candidateIds, protectedIds, active, activeOwner, userId);

  const learningOwners = new Set<string>([userId]);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    if (key.startsWith(WORKSPACE_ARCHIVE_PREFIX)) {
      const ownerId = key.slice(WORKSPACE_ARCHIVE_PREFIX.length);
      const archived = recordValue(parsedJson(storage.getItem(key)));
      if (ownerId && archived) addWorkspacePhotoIds(candidateIds, protectedIds, archived as SerializedWorkspace, ownerId, userId);
    }
    if (key.startsWith(LEARNING_RECORDS_PREFIX)) {
      const document = recordValue(parsedJson(storage.getItem(key)));
      if (typeof document?.ownerId === "string") learningOwners.add(document.ownerId);
    }
  }
  learningOwners.forEach(ownerId => addLearningImageReferences(ownerId === userId ? candidateIds : protectedIds, storage, ownerId));
  offlineRecords.forEach(record => addBundlePhotoIds(candidateIds, protectedIds, record, userId));
  return [...candidateIds].filter(photoId => ownerIndexedIds.has(photoId) || !protectedIds.has(photoId)).sort();
}

/** Switch the active view, never discard the previous account's offline data.
 * Legacy unscoped data remains guest data. Import still requires the existing
 * explicit guest→account prompt. No token/secret is stored in these archives. */
export function switchAccountWorkspace(storage: WorkspaceStorage, nextOwner: string) {
  const previous = storage.getItem(WORKSPACE_OWNER_KEY) || "guest";
  if (previous === nextOwner) { storage.setItem(WORKSPACE_OWNER_KEY, nextOwner); return; }
  const current = Object.fromEntries(workspaceKeys.map(key => [key, storage.getItem(key)]));
  storage.setItem(archiveKey(previous), JSON.stringify(current)); // Must succeed before switching.
  const saved = readStoredJson<Record<string, string | null> | null>(storage, archiveKey(nextOwner), null);
  const target = saved || (previous === "guest" && nextOwner !== "guest" ? current : {});
  try {
    for (const key of workspaceKeys) {
      if (typeof target[key] === "string") storage.setItem(key, target[key]!);
      else storage.removeItem(key);
    }
    storage.setItem(WORKSPACE_OWNER_KEY, nextOwner);
  } catch (error) {
    for (const key of workspaceKeys) {
      if (current[key] !== null) storage.setItem(key, current[key]!);
      else storage.removeItem(key);
    }
    throw error;
  }
}

export function ownsLocalWorkspace(storage: Pick<Storage, "getItem">, userId: string) {
  return (storage.getItem(WORKSPACE_OWNER_KEY) || "guest") === userId;
}

/** Returns photo ids referenced by the active workspace only. This is used
 * during the explicit guest→account import before any network sync can run. */
export function activeWorkspaceScorecardPhotoIds(storage: Pick<Storage, "getItem">, ownerId: string) {
  if (!ownerId || !ownsLocalWorkspace(storage, ownerId)) return [];
  const ids = new Set<string>();
  const history = parsedJson(storage.getItem(STORAGE_KEYS.history));
  if (Array.isArray(history)) history.forEach(round => addRoundPhotoIds(ids, round));
  addRoundPhotoIds(ids, parsedJson(storage.getItem(STORAGE_KEYS.draft)));
  const queue = parsedJson(storage.getItem(PHOTO_QUEUE_KEY));
  if (Array.isArray(queue)) {
    queue.forEach((rawJob) => addPhotoId(ids, recordValue(rawJob)?.photoId));
  }
  return [...ids].sort();
}

/** Permanently discard only one deleted account's local workspace. Guest data
 * and every other account archive remain untouched. The deletion barrier is
 * intentionally retained so asynchronous writes cannot revive this account. */
export function discardAccountWorkspace(storage: WorkspaceStorage, userId: string) {
  if (!userId || userId === "guest") return;
  if (ownsLocalWorkspace(storage, userId)) switchAccountWorkspace(storage, "guest");
  storage.removeItem(archiveKey(userId));
  storage.removeItem(`backyard-profile-cache-v1:${userId}`);
  storage.removeItem(`backyard-profile-ready-v1:${userId}`);
  storage.removeItem(pendingProfileWriteKey(userId));
  storage.removeItem(cloudProfileRevisionKey(userId));
  forgetProfileWriteClock(userId);
  storage.removeItem(`backyard-last-sync-v1:${userId}`);
  storage.removeItem(`backyard-local-migration-decision-v1:${userId}`);
  storage.removeItem(bettingConsentPromptStorageKey(userId));
  storage.removeItem(coursePreferenceStorageKey("favorites", userId));
  storage.removeItem(coursePreferenceStorageKey("recents", userId));
  storage.removeItem(internalNotificationStorageKey(userId));
  const equipmentKey = equipmentProfileStorageKey(userId);
  const equipmentRecoveryKey = equipmentProfileRecoveryStorageKey(userId);
  const fittingKey = ballFitDraftStorageKey(userId);
  if (equipmentKey) storage.removeItem(equipmentKey);
  if (equipmentRecoveryKey) storage.removeItem(equipmentRecoveryKey);
  if (fittingKey) storage.removeItem(fittingKey);
  storage.removeItem(`the-backyard:equipment-onboarding-ready:v1:${encodeURIComponent(userId)}`);
  storage.removeItem(betaOnboardingStorageKey(userId));
  storage.removeItem(betaOnboardingDraftStorageKey(userId));
  deletePersonalAiData(storage, userId);
  deleteAiProcessingConsents(storage, userId);
}

export function preserveDraftConflict(storage: Pick<Storage, "getItem" | "setItem">, draft: unknown) {
  if (!draft) return false;
  const serialized = JSON.stringify(draft);
  const versions = readStoredJson<unknown[]>(storage, CLOUD_CONFLICTS_KEY, []);
  if (!versions.some(value => JSON.stringify(value) === serialized)) storage.setItem(CLOUD_CONFLICTS_KEY, JSON.stringify([...versions, draft]));
  return readStoredJson<unknown[]>(storage, CLOUD_CONFLICTS_KEY, []).some(value => JSON.stringify(value) === serialized);
}

export function preserveDataConflicts(storage: Pick<Storage, "getItem" | "setItem">, conflicts: unknown[]) {
  if (!conflicts.length) return;
  const prior = readStoredJson<unknown[]>(storage, CLOUD_DATA_CONFLICTS_KEY, []);
  const next = [...prior];
  for (const conflict of conflicts) if (!next.some(value => JSON.stringify(value) === JSON.stringify(conflict))) next.push(conflict);
  storage.setItem(CLOUD_DATA_CONFLICTS_KEY, JSON.stringify(next.slice(-50)));
}
