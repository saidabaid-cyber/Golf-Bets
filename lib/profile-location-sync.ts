import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeProfileLocation,
  validateProfileLocation,
  type ProfileLocationValue,
} from "./profile-geography";

export const PROFILE_LOCATION_METADATA_KEY = "backyard_profile_location";

export type StoredProfileLocation = ProfileLocationValue & {
  updatedAt: string;
  version: 1;
};

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const canonical = new Date(time).toISOString();
  return canonical.startsWith(value.replace(/(?:\.\d{1,3})?Z$/, "")) ? canonical : null;
}

/** Metadata is descriptive, not an authorization or consent source. */
export function parseStoredProfileLocation(value: unknown): StoredProfileLocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  const updatedAt = isoTimestamp(candidate.updatedAt);
  if (!updatedAt) return null;
  for (const key of ["countryCode", "country", "stateCode", "state"] as const) {
    const text = candidate[key];
    if (typeof text !== "string" || text.length > (key.endsWith("Code") ? 32 : 100) || /data:image|;base64,/i.test(text)) return null;
  }
  const raw = candidate as unknown as ProfileLocationValue;
  if (!validateProfileLocation(raw).valid) return null;
  return { ...normalizeProfileLocation(raw), updatedAt, version: 1 };
}

function requireAuthenticatedUser(userId: string, returnedId: unknown): void {
  if (!userId || userId === "guest" || returnedId !== userId) {
    throw Object.assign(new Error("La sesión no corresponde al propietario del perfil."), { code: "PROFILE_OWNER_MISMATCH" });
  }
}

function locationConflict(): Error {
  return Object.assign(new Error("Otro dispositivo cambió tu ubicación. Revisa los datos antes de volver a guardar."), { code: "CLOUD_FIELD_CONFLICT" });
}

function sameLocation(left: ProfileLocationValue, right: ProfileLocationValue): boolean {
  return left.countryCode === right.countryCode
    && left.country === right.country
    && left.stateCode === right.stateCode
    && left.state === right.state;
}

/** Fetch from Auth, not a locally cached JWT/session, and verify ownership. */
export async function readProfileLocationMetadata(client: SupabaseClient, userId: string): Promise<StoredProfileLocation | null> {
  const result = await client.auth.getUser();
  if (result.error) throw result.error;
  requireAuthenticatedUser(userId, result.data.user?.id);
  return parseStoredProfileLocation(result.data.user?.user_metadata?.[PROFILE_LOCATION_METADATA_KEY]);
}

/** A small, owner-only Auth metadata write. No avatar data enters the JWT. */
export async function saveProfileLocationMetadata(
  client: SupabaseClient,
  userId: string,
  location: ProfileLocationValue,
  updatedAt: string,
): Promise<StoredProfileLocation> {
  const intended = parseStoredProfileLocation({ ...location, updatedAt, version: 1 });
  if (!intended) throw Object.assign(new Error("Selecciona una ubicación válida antes de guardarla."), { code: "PROFILE_LOCATION_INVALID" });

  const read = await client.auth.getUser();
  if (read.error) throw read.error;
  requireAuthenticatedUser(userId, read.data.user?.id);
  const rawExisting = read.data.user?.user_metadata?.[PROFILE_LOCATION_METADATA_KEY];
  const existing = parseStoredProfileLocation(rawExisting);
  const rawExistingAt = rawExisting && typeof rawExisting === "object" && !Array.isArray(rawExisting)
    ? isoTimestamp((rawExisting as Record<string, unknown>).updatedAt)
    : null;
  if (rawExistingAt) {
    const remoteTime = Date.parse(rawExistingAt);
    const localTime = Date.parse(intended.updatedAt);
    if (remoteTime > localTime || (remoteTime === localTime && (!existing || !sameLocation(existing, intended)))) throw locationConflict();
    if (remoteTime === localTime && existing) return existing; // idempotent retry
  }

  const write = await client.auth.updateUser({ data: { [PROFILE_LOCATION_METADATA_KEY]: intended } });
  if (write.error) throw write.error;
  requireAuthenticatedUser(userId, write.data.user?.id);
  const verified = parseStoredProfileLocation(write.data.user?.user_metadata?.[PROFILE_LOCATION_METADATA_KEY]);
  if (!verified || verified.updatedAt !== intended.updatedAt || !sameLocation(verified, intended)) {
    throw Object.assign(new Error("Auth no confirmó la ubicación guardada. Reintenta la sincronización."), { code: "PROFILE_LOCATION_UNVERIFIED" });
  }
  return verified;
}
