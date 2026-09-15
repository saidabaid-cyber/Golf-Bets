import type { SupabaseClient } from "@supabase/supabase-js";

// Descriptive owner-only preference, NOT an authorization/official-handicap claim.
export const BACKYARD_INDEX_METADATA_KEY = "backyard_index_preference_v1";
export type BackyardIndexPreference = {
  version: 1;
  userId: string;
  enabled: boolean;
  localPccZeroDeclaredAt: string | null;
  updatedAt: string;
};
export type IndexPreferenceCache = { preference: BackyardIndexPreference; pending: boolean };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export const indexPreferenceKey = (userId: string) => `backyard-index-preference-v1:${userId}`;

function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

export function parseIndexPreference(value: unknown, userId: string): BackyardIndexPreference | null {
  if (!userId || userId === "guest" || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || item.userId !== userId || typeof item.enabled !== "boolean" || !instant(item.updatedAt)
    || !(item.localPccZeroDeclaredAt === null || instant(item.localPccZeroDeclaredAt))) return null;
  return { version: 1, userId, enabled: item.enabled, updatedAt: item.updatedAt, localPccZeroDeclaredAt: item.localPccZeroDeclaredAt };
}

export function readIndexPreference(storage: StorageLike, userId: string): IndexPreferenceCache | null {
  const raw = storage.getItem(indexPreferenceKey(userId));
  if (raw) {
    try {
      const cached = JSON.parse(raw) as IndexPreferenceCache;
      const preference = parseIndexPreference(cached?.preference, userId);
      if (preference) return { preference, pending: cached.pending === true };
    } catch { /* Recover from the previous, boolean-only format below. */ }
  }
  if (userId && userId !== "guest" && storage.getItem(`backyard-index-enabled-v1:${userId}`) === "true") {
    // Old activation did not explain PCC. Never manufacture a declaration.
    return { preference: { version: 1, userId, enabled: true, localPccZeroDeclaredAt: null, updatedAt: "1970-01-01T00:00:00.000Z" }, pending: true };
  }
  return null;
}

export function persistIndexPreference(storage: StorageLike, cache: IndexPreferenceCache): void {
  const preference = parseIndexPreference(cache.preference, cache.preference.userId);
  if (!preference) throw new Error("Preferencia del Índice inválida.");
  const key = indexPreferenceKey(preference.userId);
  const serialized = JSON.stringify({ preference, pending: cache.pending });
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("No se confirmó la preferencia guardada en este dispositivo.");
}

export function chooseIndexPreference(local: IndexPreferenceCache | null, remote: BackyardIndexPreference | null): IndexPreferenceCache | null {
  if (!remote) return local;
  if (!local || Date.parse(remote.updatedAt) >= Date.parse(local.preference.updatedAt)) return { preference: remote, pending: false };
  // A second device can race Auth's last-write-wins metadata update. Repair a
  // newer durable local version on the next sync, including previously synced values.
  return { ...local, pending: true };
}

function assertOwner(userId: string, returnedId: unknown): void {
  if (!userId || userId === "guest" || returnedId !== userId) throw new Error("La sesión no corresponde al propietario del Índice.");
}

export async function readCloudIndexPreference(client: SupabaseClient, userId: string): Promise<BackyardIndexPreference | null> {
  const read = await client.auth.getUser();
  if (read.error) throw read.error;
  assertOwner(userId, read.data.user?.id);
  return parseIndexPreference(read.data.user?.user_metadata?.[BACKYARD_INDEX_METADATA_KEY], userId);
}

export async function saveCloudIndexPreference(client: SupabaseClient, preference: BackyardIndexPreference): Promise<BackyardIndexPreference> {
  const intended = parseIndexPreference(preference, preference.userId);
  if (!intended) throw new Error("Preferencia del Índice inválida.");
  const current = await readCloudIndexPreference(client, intended.userId);
  if (current && Date.parse(current.updatedAt) >= Date.parse(intended.updatedAt)) {
    if (JSON.stringify(current) === JSON.stringify(intended)) return current;
    throw new Error("Otro dispositivo cambió el Índice. Recarga antes de cambiar la preferencia.");
  }
  const write = await client.auth.updateUser({ data: { [BACKYARD_INDEX_METADATA_KEY]: intended } });
  if (write.error) throw write.error;
  assertOwner(intended.userId, write.data.user?.id);
  const verified = parseIndexPreference(write.data.user?.user_metadata?.[BACKYARD_INDEX_METADATA_KEY], intended.userId);
  if (!verified || JSON.stringify(verified) !== JSON.stringify(intended)) throw new Error("No se confirmó la preferencia del Índice en la nube.");
  const readBack = await readCloudIndexPreference(client, intended.userId);
  if (!readBack || JSON.stringify(readBack) !== JSON.stringify(intended)) throw new Error("La preferencia cambió durante el guardado. Reintenta la sincronización.");
  return verified;
}
