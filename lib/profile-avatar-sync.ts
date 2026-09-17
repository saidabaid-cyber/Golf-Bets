import type { SupabaseClient } from "@supabase/supabase-js";
import { validateProfileAvatarUrl } from "./account-state";
import { normalizeProfileUsername } from "./profile-username";

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

/** Canonical avatar/optional public handle project only onto an existing
 * self-owned Social row; never create a Social identity or change its privacy. */
export async function syncExistingSocialProfileAvatar(
  client: SupabaseClient,
  userId: string,
  avatarUrl: string,
  username?: string,
  displayName?: string,
): Promise<SocialProfileAvatarSyncStatus> {
  const handle = normalizeProfileUsername(username);
  const name = displayName?.trim().slice(0, 120);
  const columns = `user_id,avatar_url${handle ? ",username" : ""}${name ? ",display_name" : ""}`;
  const validated = validateProfileAvatarUrl(avatarUrl);
  if (!validated.ok) throw Object.assign(new Error(validated.message), { code: "PROFILE_AVATAR_INVALID" });

  const auth = await client.auth.getUser();
  if (auth.error) throw auth.error;
  requireProfileOwner(userId, auth.data.user?.id);

  const existing = await client.from("social_profiles").select(columns).eq("user_id", userId).maybeSingle();
  if (existing.error) {
    if (!handle && tableUnavailable(existing.error)) return "unavailable";
    throw existing.error;
  }
  const existingRow = existing.data as unknown as { user_id: unknown; avatar_url: unknown; username?: unknown; display_name?: unknown } | null;
  if (!existingRow) return "absent";
  if (existingRow.user_id !== userId) {
    throw Object.assign(new Error("Social devolvió un perfil ajeno."), { code: "PROFILE_OWNER_MISMATCH" });
  }
  if (existingRow.avatar_url === validated.avatarUrl && (!handle || existingRow.username === handle) && (!name || existingRow.display_name === name)) return "updated"; // confirmed, idempotent retry

  const changed = await client.from("social_profiles")
    .update({ avatar_url: validated.avatarUrl, ...(handle ? { username: handle } : {}), ...(name ? { display_name: name } : {}) })
    .eq("user_id", userId)
    .select(columns)
    .maybeSingle();
  if (changed.error) {
    if (!handle && tableUnavailable(changed.error)) return "unavailable";
    throw changed.error;
  }
  const changedRow = changed.data as unknown as { user_id: unknown; avatar_url: unknown; username?: unknown; display_name?: unknown } | null;
  if (!changedRow || changedRow.user_id !== userId || changedRow.avatar_url !== validated.avatarUrl || (handle && changedRow.username !== handle) || (name && changedRow.display_name !== name)) {
    throw Object.assign(new Error("Social no confirmó el avatar. Reintenta la sincronización."), { code: "PROFILE_SOCIAL_AVATAR_UNVERIFIED" });
  }
  return "updated";
}
