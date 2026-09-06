import type { PersonalActivity } from "./golf-insights";

export const INTERNAL_NOTIFICATION_READ_LIMIT = 100;
const INTERNAL_NOTIFICATION_STORAGE_PREFIX = "backyard-internal-notifications-v1";

export type InternalNotificationReadState = {
  version: 1;
  /** Ordered from the most recent known activity to the oldest. */
  readEventKeys: string[];
};

export type InternalNotification = PersonalActivity & {
  eventKey: string;
  unread: boolean;
};

export type InternalNotificationStorage = Pick<Storage, "getItem" | "setItem">;

export type InternalNotificationReadResult =
  | { ok: true; state: InternalNotificationReadState; recoveredMalformed: boolean }
  | { ok: false; state: InternalNotificationReadState; error: "identity_missing" | "storage_read_failed" };

export type InternalNotificationWriteResult =
  | { ok: true; persisted: true; state: InternalNotificationReadState }
  | { ok: false; persisted: false; state: InternalNotificationReadState; error: "identity_missing" | "storage_write_failed" };

export function emptyInternalNotificationReadState(): InternalNotificationReadState {
  return { version: 1, readEventKeys: [] };
}

function notificationIdentity(identity: string) {
  const normalized = identity.trim();
  return normalized || null;
}

/** A read marker belongs to exactly one account workspace. Blank identities
 * are rejected instead of silently sharing the guest namespace. */
export function internalNotificationStorageKey(identity: string) {
  const normalized = notificationIdentity(identity);
  if (!normalized) throw new Error("notification_identity_missing");
  return `${INTERNAL_NOTIFICATION_STORAGE_PREFIX}:${encodeURIComponent(normalized)}`;
}

/** The timestamp is part of the identity so a later edit to the same group or
 * round becomes a new event rather than inheriting an older read marker. JSON
 * tuple encoding avoids delimiter collisions in user-controlled identifiers. */
export function internalNotificationEventKey(activity: Pick<PersonalActivity, "id" | "occurredAt">) {
  return JSON.stringify([activity.id, activity.occurredAt]);
}

function validReadEventKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}

function uniqueRecentKeys(keys: readonly unknown[], limit = INTERNAL_NOTIFICATION_READ_LIMIT) {
  const result: string[] = [];
  const seen = new Set<string>();
  const boundedLimit = Math.max(0, Math.min(INTERNAL_NOTIFICATION_READ_LIMIT, Math.floor(limit)));
  for (const candidate of keys) {
    if (!validReadEventKey(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= boundedLimit) break;
  }
  return result;
}

export function normalizeInternalNotificationReadState(value: unknown): InternalNotificationReadState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyInternalNotificationReadState();
  const candidate = value as { version?: unknown; readEventKeys?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.readEventKeys)) return emptyInternalNotificationReadState();
  return { version: 1, readEventKeys: uniqueRecentKeys(candidate.readEventKeys) };
}

function newestActivityKeys(activity: readonly PersonalActivity[]) {
  return activity
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const byTime = right.item.occurredAt.localeCompare(left.item.occurredAt);
      return byTime || left.index - right.index;
    })
    .map(({ item }) => internalNotificationEventKey(item));
}

/** Keep only markers that still describe the caller's current activity and
 * retain at most the 100 most recent ones. */
export function pruneInternalNotificationReadState(
  state: InternalNotificationReadState,
  activity: readonly PersonalActivity[],
): InternalNotificationReadState {
  const currentReadKeys = new Set(normalizeInternalNotificationReadState(state).readEventKeys);
  const recentCurrentKeys = newestActivityKeys(activity).filter((key) => currentReadKeys.has(key));
  return { version: 1, readEventKeys: uniqueRecentKeys(recentCurrentKeys) };
}

export function readInternalNotificationReadState(
  storage: Pick<InternalNotificationStorage, "getItem">,
  identity: string,
  activity?: readonly PersonalActivity[],
): InternalNotificationReadResult {
  let key: string;
  try {
    key = internalNotificationStorageKey(identity);
  } catch {
    return { ok: false, state: emptyInternalNotificationReadState(), error: "identity_missing" };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false, state: emptyInternalNotificationReadState(), error: "storage_read_failed" };
  }
  if (raw === null) return { ok: true, state: emptyInternalNotificationReadState(), recoveredMalformed: false };

  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeInternalNotificationReadState(parsed);
    const state = activity ? pruneInternalNotificationReadState(normalized, activity) : normalized;
    const recoveredMalformed = JSON.stringify(parsed) !== JSON.stringify(normalized);
    return { ok: true, state, recoveredMalformed };
  } catch {
    return { ok: true, state: emptyInternalNotificationReadState(), recoveredMalformed: true };
  }
}

export function deriveInternalNotifications(
  activity: readonly PersonalActivity[],
  state: InternalNotificationReadState,
): InternalNotification[] {
  const readKeys = new Set(normalizeInternalNotificationReadState(state).readEventKeys);
  const seenEventKeys = new Set<string>();
  const notifications: InternalNotification[] = [];
  for (const item of activity) {
    const eventKey = internalNotificationEventKey(item);
    // Local recovery or sync can temporarily surface the same snapshot twice.
    // Keep the first occurrence so the badge and React keys never double-count it.
    if (seenEventKeys.has(eventKey)) continue;
    seenEventKeys.add(eventKey);
    notifications.push({ ...item, eventKey, unread: !readKeys.has(eventKey) });
  }
  return notifications;
}

/** Toggle one local event without navigating away. This makes every notice,
 * including a non-openable recovery event, independently dismissible. */
export function setInternalNotificationRead(
  state: InternalNotificationReadState,
  activity: Pick<PersonalActivity, "id" | "occurredAt">,
  read: boolean,
): InternalNotificationReadState {
  const eventKey = internalNotificationEventKey(activity);
  const current = normalizeInternalNotificationReadState(state).readEventKeys;
  return {
    version: 1,
    readEventKeys: read
      ? uniqueRecentKeys([eventKey, ...current])
      : current.filter((key) => key !== eventKey),
  };
}

export function markAllInternalNotificationsRead(activity: readonly PersonalActivity[]): InternalNotificationReadState {
  return { version: 1, readEventKeys: uniqueRecentKeys(newestActivityKeys(activity)) };
}

/** Persist only read markers, never activity content. Failure is returned to
 * the caller so the UI cannot claim that "mark all read" was saved. */
export function persistInternalNotificationReadState(
  storage: Pick<InternalNotificationStorage, "setItem">,
  identity: string,
  state: InternalNotificationReadState,
  activity?: readonly PersonalActivity[],
): InternalNotificationWriteResult {
  const normalized = normalizeInternalNotificationReadState(state);
  const persistedState = activity ? pruneInternalNotificationReadState(normalized, activity) : normalized;
  let key: string;
  try {
    key = internalNotificationStorageKey(identity);
  } catch {
    return { ok: false, persisted: false, state: persistedState, error: "identity_missing" };
  }
  try {
    storage.setItem(key, JSON.stringify(persistedState));
    return { ok: true, persisted: true, state: persistedState };
  } catch {
    return { ok: false, persisted: false, state: persistedState, error: "storage_write_failed" };
  }
}

export function markAllInternalNotificationsReadInStorage(
  storage: Pick<InternalNotificationStorage, "setItem">,
  identity: string,
  activity: readonly PersonalActivity[],
): InternalNotificationWriteResult {
  return persistInternalNotificationReadState(storage, identity, markAllInternalNotificationsRead(activity), activity);
}
