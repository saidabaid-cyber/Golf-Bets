import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackyardProfile } from "./account-state";
import { writeVersionedRow } from "./cloud-write";

export type CloudProfileRow = {
  display_name: string | null;
  avatar_url: string | null;
  default_handicap: number | null;
  onboarding_completed_at: string | null;
  updated_at: string | null;
};

type ProfileWriteField = "default_handicap" | "name" | "display_name" | "avatar_url" | "onboarding_completed_at";
type ProfileWriteError = Error & { profileUpdatedAt?: string };

type CloudErrorLike = { code?: string; message?: string; status?: number };

/** Keep Supabase errors useful without exposing a token, query or user data. */
export function cloudAccountErrorMessage(error: unknown, subject = "tu cuenta") {
  const candidate = (error && typeof error === "object" ? error : {}) as CloudErrorLike;
  const code = String(candidate.code || "");
  const message = String(candidate.message || (error instanceof Error ? error.message : ""));
  if (code === "42501" || /permission denied|row-level security/i.test(message)) {
    return `La nube rechazó el acceso a ${subject}. Vuelve a iniciar sesión o reintenta; tus datos locales se conservan.`;
  }
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /schema cache|does not exist|column .* not found/i.test(message)) {
    return `La nube no pudo leer ${subject}. Tus datos locales se conservan; reintenta más tarde.`;
  }
  if (candidate.status === 401 || /jwt|token|session|sesión/i.test(message)) {
    return "La nube pidió renovar la sesión. Tus datos siguen en este dispositivo; reintenta la conexión.";
  }
  if (/fetch|network|timeout|conexión|offline/i.test(message)) {
    return `No pudimos conectar con Supabase para leer ${subject}. Tus datos siguen guardados en este dispositivo.`;
  }
  return `No pudimos leer ${subject} en la nube. Tus datos locales se conservan; reintenta.`;
}

/** A failed signup trigger must not strand an authenticated user forever.
 * RLS only allows inserting auth.uid(), so this repair cannot create another
 * user's profile. Existing rows are never overwritten here. */
export async function ensureCloudProfile(
  client: SupabaseClient,
  userId: string,
  fallback: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">,
): Promise<CloudProfileRow> {
  const columns = "display_name,avatar_url,default_handicap,onboarding_completed_at,updated_at";
  const existing = await client.from("profiles").select(columns).eq("id", userId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as CloudProfileRow;
  const created = await client.from("profiles").insert({
    id: userId,
    name: fallback.displayName || "Jugador",
    display_name: fallback.displayName || "Jugador",
    avatar_url: fallback.avatarUrl || null,
    default_handicap: fallback.defaultHandicap,
  }).select(columns).maybeSingle();
  if (!created.error && created.data) return created.data as CloudProfileRow;
  // A concurrent tab may have created the same row after our first read.
  const retry = await client.from("profiles").select(columns).eq("id", userId).maybeSingle();
  if (retry.error) throw created.error || retry.error;
  if (!retry.data) throw created.error || new Error("Perfil no confirmado por Supabase");
  return retry.data as CloudProfileRow;
}

function equivalentCloudValue(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  if (typeof left === "number" || typeof right === "number") {
    const leftNumber = Number(left), rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
  }
  return left === right;
}

async function writeVerifiedProfileRow(
  client: SupabaseClient,
  table: "profiles" | "user_preferences",
  keys: Record<string, string>,
  row: Record<string, unknown> & { updated_at: string },
  fields: ProfileWriteField[],
) {
  if (await writeVersionedRow(client, table, keys, row)) return;
  let request = client.from(table).select(["updated_at", ...fields].join(","));
  for (const [key, value] of Object.entries(keys)) request = request.eq(key, value);
  const current = await request.maybeSingle();
  if (current.error) throw current.error;
  const currentRow = current.data as Record<string, unknown> | null;
  const matches = currentRow
    && fields.every((field) => equivalentCloudValue(currentRow[field], row[field]));
  if (matches) return; // idempotent retry or the same value from another tab
  throw Object.assign(new Error("Otro dispositivo cambió tu perfil. Revisa los datos antes de volver a guardar."), { code: "CLOUD_FIELD_CONFLICT" });
}

async function latestProfileTimestamp(client: SupabaseClient, userId: string) {
  const [profile, preferences] = await Promise.all([
    client.from("profiles").select("updated_at").eq("id", userId).maybeSingle(),
    client.from("user_preferences").select("updated_at").eq("user_id", userId).maybeSingle(),
  ]);
  if (profile.error) throw profile.error;
  if (preferences.error) throw preferences.error;
  const values = [profile.data?.updated_at, preferences.data?.updated_at]
    .map((value) => Date.parse(typeof value === "string" ? value : ""))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

/** Completion is written last: a failed preferences write cannot let a reload
 * bypass onboarding. Every acknowledged write must return its row. */
export async function saveCloudProfile(
  client: SupabaseClient,
  userId: string,
  profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">,
  updatedAt: string,
  options: { rebaseOnServerClock?: boolean } = {},
) {
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("profile_updated_at_invalid");
  const serverTimestamp = options.rebaseOnServerClock ? await latestProfileTimestamp(client, userId) : 0;
  const writeTimestamp = serverTimestamp
    ? new Date(serverTimestamp + 1).toISOString()
    : updatedAt;
  try {
    const preferenceRow = { user_id: userId, default_handicap: profile.defaultHandicap, updated_at: writeTimestamp };
    await writeVerifiedProfileRow(client, "user_preferences", { user_id: userId }, preferenceRow, ["default_handicap"]);
    const profileRow = { id: userId, name: profile.displayName, display_name: profile.displayName, default_handicap: profile.defaultHandicap, avatar_url: profile.avatarUrl || null, onboarding_completed_at: writeTimestamp, updated_at: writeTimestamp };
    await writeVerifiedProfileRow(client, "profiles", { id: userId }, profileRow, ["name", "display_name", "default_handicap", "avatar_url", "onboarding_completed_at"]);
    return { updatedAt: writeTimestamp };
  } catch (error) {
    if (error && typeof error === "object") (error as ProfileWriteError).profileUpdatedAt = writeTimestamp;
    throw error;
  }
}
