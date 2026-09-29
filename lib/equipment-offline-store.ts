import { accountDeletionMarkerKey } from "./account-state";
import {
  equipmentProfileFingerprint,
  normalizeEquipmentProfile,
  type EquipmentProfile,
} from "./golf-equipment";

const EQUIPMENT_SYNC_STATE_VERSION = 1 as const;
const EQUIPMENT_SYNC_STATE_PREFIX = `the-backyard:equipment-sync-state:v${EQUIPMENT_SYNC_STATE_VERSION}:`;

type EquipmentSyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type EquipmentSyncBase = {
  profile: EquipmentProfile;
  version: number;
  lastMutationId: string;
  updatedAt: string;
};

export type EquipmentSyncOutbox = {
  profile: EquipmentProfile;
  fingerprint: string;
  mutationId: string;
  queuedAt: string;
};

export type EquipmentSyncState = {
  base: EquipmentSyncBase | null;
  outbox: EquipmentSyncOutbox | null;
};

type StoredEquipmentSyncState = EquipmentSyncState & {
  schema: "the-backyard-equipment-sync-state";
  version: typeof EQUIPMENT_SYNC_STATE_VERSION;
  userId: string;
};

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validMutationId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200;
}

function normalizeBase(value: unknown, userId: string): EquipmentSyncBase | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<EquipmentSyncBase>;
  const profile = normalizeEquipmentProfile(candidate.profile, userId);
  if (!profile || typeof candidate.version !== "number" || !Number.isSafeInteger(candidate.version)
    || candidate.version <= 0 || !validMutationId(candidate.lastMutationId) || !validTimestamp(candidate.updatedAt)) return null;
  return {
    profile,
    version: candidate.version,
    lastMutationId: candidate.lastMutationId.trim(),
    updatedAt: candidate.updatedAt,
  };
}

function normalizeOutbox(value: unknown, userId: string): EquipmentSyncOutbox | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<EquipmentSyncOutbox>;
  const profile = normalizeEquipmentProfile(candidate.profile, userId);
  const fingerprint = profile ? equipmentProfileFingerprint(profile, userId) : null;
  if (!profile || !fingerprint || candidate.fingerprint !== fingerprint
    || !validMutationId(candidate.mutationId) || !validTimestamp(candidate.queuedAt)) return null;
  return {
    profile,
    fingerprint,
    mutationId: candidate.mutationId.trim(),
    queuedAt: candidate.queuedAt,
  };
}

export function equipmentSyncStateStorageKey(userIdValue: string): string | null {
  const userId = userIdValue.trim();
  return userId ? `${EQUIPMENT_SYNC_STATE_PREFIX}${encodeURIComponent(userId)}` : null;
}

export function readEquipmentSyncState(storage: Pick<Storage, "getItem">, userIdValue: string): EquipmentSyncState {
  const userId = userIdValue.trim();
  const key = equipmentSyncStateStorageKey(userId);
  if (!key) return { base: null, outbox: null };
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { base: null, outbox: null };
    const candidate = parsed as Partial<StoredEquipmentSyncState>;
    if (candidate.schema !== "the-backyard-equipment-sync-state"
      || candidate.version !== EQUIPMENT_SYNC_STATE_VERSION || candidate.userId !== userId) return { base: null, outbox: null };
    return {
      base: normalizeBase(candidate.base, userId),
      outbox: normalizeOutbox(candidate.outbox, userId),
    };
  } catch {
    return { base: null, outbox: null };
  }
}

function writeEquipmentSyncState(storage: EquipmentSyncStorage, userId: string, state: EquipmentSyncState) {
  const key = equipmentSyncStateStorageKey(userId);
  if (!key) throw new Error("equipment_sync_user_invalid");
  if (storage.getItem(accountDeletionMarkerKey(userId)) !== null) throw new Error("account_deletion_in_progress");
  const stored: StoredEquipmentSyncState = {
    schema: "the-backyard-equipment-sync-state",
    version: EQUIPMENT_SYNC_STATE_VERSION,
    userId,
    base: state.base,
    outbox: state.outbox,
  };
  storage.setItem(key, JSON.stringify(stored));
  if (storage.getItem(accountDeletionMarkerKey(userId)) !== null) {
    storage.removeItem(key);
    throw new Error("account_deletion_in_progress");
  }
  return state;
}

export function recordEquipmentSyncBase(
  storage: EquipmentSyncStorage,
  userIdValue: string,
  base: EquipmentSyncBase | null,
) {
  const userId = userIdValue.trim();
  const normalized = base ? normalizeBase(base, userId) : null;
  if (base && !normalized) throw new Error("equipment_sync_base_invalid");
  const current = readEquipmentSyncState(storage, userId);
  return writeEquipmentSyncState(storage, userId, { ...current, base: normalized });
}

export function queueEquipmentSyncOutbox(
  storage: EquipmentSyncStorage,
  userIdValue: string,
  profileValue: EquipmentProfile,
  mutationId: string,
  queuedAt = new Date().toISOString(),
) {
  const userId = userIdValue.trim();
  const profile = normalizeEquipmentProfile(profileValue, userId);
  const fingerprint = profile ? equipmentProfileFingerprint(profile, userId) : null;
  if (!profile || !fingerprint || !validMutationId(mutationId) || !validTimestamp(queuedAt)) {
    throw new Error("equipment_sync_outbox_invalid");
  }
  const current = readEquipmentSyncState(storage, userId);
  if (current.outbox?.fingerprint === fingerprint) return current.outbox;
  const outbox = { profile, fingerprint, mutationId: mutationId.trim(), queuedAt } satisfies EquipmentSyncOutbox;
  writeEquipmentSyncState(storage, userId, { ...current, outbox });
  return outbox;
}

/** Clear only the mutation that was acknowledged. A newer local save remains
 * durable even when an older request finishes afterwards. */
export function acknowledgeEquipmentSyncOutbox(
  storage: EquipmentSyncStorage,
  userIdValue: string,
  fingerprint: string,
  mutationId: string,
) {
  const userId = userIdValue.trim();
  const current = readEquipmentSyncState(storage, userId);
  if (!current.outbox || current.outbox.fingerprint !== fingerprint || current.outbox.mutationId !== mutationId) return false;
  writeEquipmentSyncState(storage, userId, { ...current, outbox: null });
  return true;
}

export function clearEquipmentSyncOutbox(storage: EquipmentSyncStorage, userIdValue: string) {
  const userId = userIdValue.trim();
  const current = readEquipmentSyncState(storage, userId);
  if (!current.outbox) return current;
  return writeEquipmentSyncState(storage, userId, { ...current, outbox: null });
}

export function removeEquipmentSyncState(storage: Pick<Storage, "removeItem">, userIdValue: string) {
  const key = equipmentSyncStateStorageKey(userIdValue);
  if (key) storage.removeItem(key);
}
