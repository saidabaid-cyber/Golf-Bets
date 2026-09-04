import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackyardProfile } from "./account-state";

export type CloudProfileRow = {
  display_name: string | null;
  avatar_url: string | null;
  default_handicap: number | null;
  onboarding_completed_at: string | null;
};

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
  const columns = "display_name,avatar_url,default_handicap,onboarding_completed_at";
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

/** Completion is written last: a failed preferences write cannot let a reload
 * bypass onboarding. Every acknowledged write must return its row. */
export async function saveCloudProfile(client: SupabaseClient, userId: string, profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">, updatedAt: string) {
  const preferences = await client.from("user_preferences").upsert({ user_id: userId, default_handicap: profile.defaultHandicap, updated_at: updatedAt }).select("user_id");
  if (preferences.error || !preferences.data?.length) throw preferences.error || new Error("Preferencias no confirmadas");
  const result = await client.from("profiles").upsert({ id: userId, name: profile.displayName, display_name: profile.displayName, default_handicap: profile.defaultHandicap, avatar_url: profile.avatarUrl || null, onboarding_completed_at: updatedAt, updated_at: updatedAt }).select("id");
  if (result.error || !result.data?.length) throw result.error || new Error("Perfil no confirmado");
}
