import type { BackyardProfile } from "./account-state";

export type CloudProfileFields = Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">;

export type PendingProfileWrite = {
  profile: CloudProfileFields;
  updatedAt: string;
  revision: string;
};

export type ProfileWriteCoordinator = {
  run<T>(operation: () => Promise<T>): Promise<T>;
};

const PROFILE_WRITE_PREFIX = "backyard-profile-write-v1:";
const PROFILE_CLOUD_REVISION_PREFIX = "backyard-profile-cloud-revision-v1:";
const lastProfileWriteAt = new Map<string, number>();

/** Supabase profile upserts are last-write-wins, so writes from one tab must
 * reach the server in the same order in which the golfer made them. */
export function createProfileWriteCoordinator(): ProfileWriteCoordinator {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>) {
      const result = tail.catch(() => undefined).then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export function pendingProfileWriteKey(userId: string) {
  return `${PROFILE_WRITE_PREFIX}${userId}`;
}

export function cloudProfileRevisionKey(userId: string) {
  return `${PROFILE_CLOUD_REVISION_PREFIX}${userId}`;
}

export function readCloudProfileRevision(storage: Pick<Storage, "getItem">, userId: string) {
  const value = storage.getItem(cloudProfileRevisionKey(userId)) || "";
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function recordCloudProfileRevision(storage: Pick<Storage, "getItem" | "setItem">, userId: string, updatedAt: string) {
  if (!Number.isFinite(Date.parse(updatedAt))) return false;
  const current = readCloudProfileRevision(storage, userId);
  if (current && Date.parse(current) >= Date.parse(updatedAt)) return false;
  storage.setItem(cloudProfileRevisionKey(userId), updatedAt);
  return true;
}

export function cloudProfileRevisionIsNewer(storage: Pick<Storage, "getItem">, userId: string, responseUpdatedAt: string | null) {
  const observed = readCloudProfileRevision(storage, userId);
  return Boolean(observed && (!responseUpdatedAt || Date.parse(observed) > Date.parse(responseUpdatedAt)));
}

export function forgetProfileWriteClock(userId: string) {
  lastProfileWriteAt.delete(userId);
}

function nextProfileWriteTimestamp(storage: Pick<Storage, "getItem">, userId: string, requestedAt: string) {
  const requested = Date.parse(requestedAt);
  const pending = readPendingProfileWrite(storage, userId);
  const previous = Math.max(
    lastProfileWriteAt.get(userId) || 0,
    Date.parse(pending?.updatedAt || "") || 0,
  );
  const next = Math.max(Number.isFinite(requested) ? requested : Date.now(), previous + 1);
  lastProfileWriteAt.set(userId, next);
  return new Date(next).toISOString();
}

function createProfileWriteRevision(updatedAt: string) {
  const random = globalThis.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${updatedAt}:${random}`;
}

export function cloudProfileFields(profile: CloudProfileFields): CloudProfileFields {
  return {
    displayName: profile.displayName.trim(),
    defaultHandicap: profile.defaultHandicap === null || (typeof profile.defaultHandicap === "number" && Number.isFinite(profile.defaultHandicap))
      ? profile.defaultHandicap
      : null,
    avatarUrl: profile.avatarUrl.trim(),
  };
}

export function queuePendingProfileWrite(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  profile: CloudProfileFields,
  updatedAt = new Date().toISOString(),
  revision?: string,
): PendingProfileWrite {
  const monotonicUpdatedAt = nextProfileWriteTimestamp(storage, userId, updatedAt);
  const pending = {
    profile: cloudProfileFields(profile),
    updatedAt: monotonicUpdatedAt,
    revision: revision?.trim() || createProfileWriteRevision(monotonicUpdatedAt),
  };
  storage.setItem(pendingProfileWriteKey(userId), JSON.stringify(pending));
  return pending;
}

export function readPendingProfileWrite(storage: Pick<Storage, "getItem">, userId: string): PendingProfileWrite | null {
  try {
    const value = JSON.parse(storage.getItem(pendingProfileWriteKey(userId)) || "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as { profile?: unknown; updatedAt?: unknown; revision?: unknown };
    if (!candidate.profile || typeof candidate.profile !== "object" || Array.isArray(candidate.profile) || typeof candidate.updatedAt !== "string" || !Number.isFinite(Date.parse(candidate.updatedAt))) return null;
    const profile = candidate.profile as Partial<CloudProfileFields>;
    if (typeof profile.displayName !== "string" || !profile.displayName.trim() || typeof profile.avatarUrl !== "string") return null;
    if (profile.defaultHandicap !== null && (typeof profile.defaultHandicap !== "number" || !Number.isFinite(profile.defaultHandicap))) return null;
    const revision = typeof candidate.revision === "string" && candidate.revision.trim()
      ? candidate.revision
      : candidate.updatedAt; // safe recovery for a pending write created before revisions existed
    return { profile: cloudProfileFields(profile as CloudProfileFields), updatedAt: candidate.updatedAt, revision };
  } catch {
    return null;
  }
}

/** An older response must never acknowledge a newer local edit. */
export function acknowledgePendingProfileWrite(
  storage: Pick<Storage, "getItem" | "removeItem">,
  userId: string,
  revision: string,
) {
  const current = readPendingProfileWrite(storage, userId);
  if (!current || current.revision !== revision) return false;
  storage.removeItem(pendingProfileWriteKey(userId));
  return true;
}

/** Preserve the same mutation identity after a server-clock rebase. */
export function retimePendingProfileWrite(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  revision: string,
  updatedAt: string,
) {
  const current = readPendingProfileWrite(storage, userId);
  if (!current || current.revision !== revision || !Number.isFinite(Date.parse(updatedAt))) return false;
  const next = { ...current, updatedAt };
  storage.setItem(pendingProfileWriteKey(userId), JSON.stringify(next));
  lastProfileWriteAt.set(userId, Math.max(lastProfileWriteAt.get(userId) || 0, Date.parse(updatedAt)));
  return true;
}
