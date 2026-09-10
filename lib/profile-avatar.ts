export const PROFILE_EMOJI_AVATARS = [
  "⛳", "🏌️", "🏌️‍♂️", "🏌️‍♀️", "🏆", "🔥", "😎", "🐺", "🐍", "🐫", "🐟", "🦅",
] as const;

export type ProfileEmojiAvatar = (typeof PROFILE_EMOJI_AVATARS)[number];

export function isProfileEmojiAvatar(value: unknown): value is ProfileEmojiAvatar {
  return typeof value === "string" && (PROFILE_EMOJI_AVATARS as readonly string[]).includes(value);
}
