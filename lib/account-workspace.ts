import { STORAGE_KEYS, readStoredJson } from "./round-utils";
import { CLOUD_LOCAL_META_KEY, CLOUD_TOMBSTONES_KEY } from "./cloud-sync";
import { PHOTO_QUEUE_KEY } from "./photo-sync-queue";

export const WORKSPACE_OWNER_KEY = "backyard-local-workspace-owner-v1";
export const CLOUD_CONFLICTS_KEY = "backyard-cloud-conflicts-v1";
const workspaceKeys = [...Object.values(STORAGE_KEYS), CLOUD_LOCAL_META_KEY, CLOUD_TOMBSTONES_KEY, CLOUD_CONFLICTS_KEY, PHOTO_QUEUE_KEY];
type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const archiveKey = (owner: string) => `backyard-local-workspace-v1:${owner}`;

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

export function preserveDraftConflict(storage: Pick<Storage, "getItem" | "setItem">, draft: unknown) {
  if (!draft) return;
  const versions = readStoredJson<unknown[]>(storage, CLOUD_CONFLICTS_KEY, []);
  if (!versions.some(value => JSON.stringify(value) === JSON.stringify(draft))) storage.setItem(CLOUD_CONFLICTS_KEY, JSON.stringify([...versions, draft]));
}
