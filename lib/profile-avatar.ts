import emojiRegex from "emoji-regex";

export const PROFILE_EMOJI_AVATARS = [
  "⛳", "🏌️", "🏌️‍♂️", "🏌️‍♀️", "🏆", "🔥", "😎", "🐺", "🐍", "🐫", "🐟", "🦅",
] as const;

export type ProfileEmojiAvatar = string;
export type ProfileAvatarType = "photo" | "emoji" | "generated_avatar" | "none";
export type AvatarCreationRequest =
  | { source: "description"; description: string }
  | { source: "photo"; photo: File; description?: string };

export function profileAvatarGraphemes(value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [];
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(normalized)].map((segment) => segment.segment);
  }
  return Array.from(normalized);
}

export function normalizeProfileEmojiAvatar(value: unknown): ProfileEmojiAvatar | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const normalized = value.trim();
  // The maintained Unicode sequence matcher also works on Safari versions
  // without Intl.Segmenter. Require the entire value to be ONE emoji match.
  const match = emojiRegex().exec(normalized);
  return match?.index === 0 && match[0] === normalized ? normalized : null;
}

export function isProfileEmojiAvatar(value: unknown): boolean {
  return normalizeProfileEmojiAvatar(value) !== null;
}

/** The immutable generated asset path preserves the discriminator across
 * profile/cache/cloud round-trips, without a second independently stored avatar.
 * This is display metadata only, NEVER an authorization or asset ownership check. */
export function isGeneratedProfileAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && /^\/storage\/v1\/object\/public\/[^/]+\/generated-avatar\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:webp|png|jpeg)$/.test(url.pathname);
  } catch { return false; }
}

/** avatarUrl remains the single persisted value used by every existing view. */
export function profileAvatarType(value: string | null | undefined, generated = false): ProfileAvatarType {
  if (!value?.trim()) return "none";
  if (isProfileEmojiAvatar(value)) return "emoji";
  return generated || isGeneratedProfileAvatarUrl(value) ? "generated_avatar" : "photo";
}
