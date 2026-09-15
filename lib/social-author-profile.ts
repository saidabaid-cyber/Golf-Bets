import type { SocialActivityAuthor } from "./social-activity-contract";

type PublicProfileRow = { name?: unknown; display_name?: unknown; username?: unknown; avatar_url?: unknown };
type SocialProfileRow = { username?: unknown; display_name?: unknown; avatar_url?: unknown };
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/** Canonical profile null avatar is an intentional SIN IMAGEN, never a fallback. */
export function socialActivityAuthor(
  userId: string, profile: PublicProfileRow | null, social: SocialProfileRow | null,
): SocialActivityAuthor {
  return {
    userId,
    username: text(profile?.username) || text(social?.username),
    displayName: text(profile?.display_name) || text(profile?.name)
      || text(social?.display_name) || "Golfista",
    avatarUrl: profile ? text(profile.avatar_url) : text(social?.avatar_url),
  };
}
