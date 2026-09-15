import type { SupabaseClient } from "@supabase/supabase-js";
import { validateProfileAvatarUrl } from "./account-state";

export type SocialProfileAvatarSyncStatus = "updated" | "absent" | "unavailable";

function tableUnavailable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return code === "42P01" || code === "PGRST205";
}

function requireProfileOwner(userId: string, authenticatedId: unknown): void {
  if (!userId || userId === "guest" || authenticatedId !== userId) {
    throw Object.assign(new Error("La sesión no corresponde al propietario del perfil."), { code: "PROFILE_OWNER_MISMATCH" });
  }
}

/** `profiles.avatar_url` remains canonical. Project it only onto an existing
 * self-owned Social row; never create a Social identity or change its privacy. */
export async function syncExistingSocialProfileAvatar(
  client: SupabaseClient,
  userId: string,
  avatarUrl: string,
): Promise<SocialProfileAvatarSyncStatus> {
  const validated = validateProfileAvatarUrl(avatarUrl);
  if (!validated.ok) throw Object.assign(new Error(validated.message), { code: "PROFILE_AVATAR_INVALID" });

  const auth = await client.auth.getUser();
  if (auth.error) throw auth.error;
  requireProfileOwner(userId, auth.data.user?.id);

  const existing = await client.from("social_profiles").select("user_id,avatar_url").eq("user_id", userId).maybeSingle();
  if (existing.error) {
    if (tableUnavailable(existing.error)) return "unavailable";
    throw existing.error;
  }
  if (!existing.data) return "absent";
  if (existing.data.user_id !== userId) {
    throw Object.assign(new Error("Social devolvió un perfil ajeno."), { code: "PROFILE_OWNER_MISMATCH" });
  }
  if (existing.data.avatar_url === validated.avatarUrl) return "updated"; // confirmed, idempotent retry

  const changed = await client.from("social_profiles")
    .update({ avatar_url: validated.avatarUrl })
    .eq("user_id", userId)
    .select("user_id,avatar_url")
    .maybeSingle();
  if (changed.error) {
    if (tableUnavailable(changed.error)) return "unavailable";
    throw changed.error;
  }
  if (!changed.data || changed.data.user_id !== userId || changed.data.avatar_url !== validated.avatarUrl) {
    throw Object.assign(new Error("Social no confirmó el avatar. Reintenta la sincronización."), { code: "PROFILE_SOCIAL_AVATAR_UNVERIFIED" });
  }
  return "updated";
}
