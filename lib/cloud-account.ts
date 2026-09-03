import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackyardProfile } from "./account-state";

/** Completion is written last: a failed preferences write cannot let a reload
 * bypass onboarding. Every acknowledged write must return its row. */
export async function saveCloudProfile(client: SupabaseClient, userId: string, profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">, updatedAt: string) {
  const preferences = await client.from("user_preferences").upsert({ user_id: userId, default_handicap: profile.defaultHandicap, updated_at: updatedAt }).select("user_id");
  if (preferences.error || !preferences.data?.length) throw preferences.error || new Error("Preferencias no confirmadas");
  const result = await client.from("profiles").upsert({ id: userId, name: profile.displayName, display_name: profile.displayName, default_handicap: profile.defaultHandicap, avatar_url: profile.avatarUrl || null, onboarding_completed_at: updatedAt, updated_at: updatedAt }).select("id");
  if (result.error || !result.data?.length) throw result.error || new Error("Perfil no confirmado");
}
