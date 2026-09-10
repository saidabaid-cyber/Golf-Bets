export const PROFILE_EMOJI_AVATARS = [
  "⛳", "🏌️", "🏌️‍♂️", "🏌️‍♀️", "🏆", "🔥", "😎", "🐺", "🐍", "🐫", "🐟", "🦅",
] as const;

export type ProfileEmojiAvatar = string;

const EMOJI_CLUSTER = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/u;

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
  if (typeof value !== "string" || value.length > 32) return null;
  const graphemes = profileAvatarGraphemes(value);
  if (graphemes.length !== 1 || !EMOJI_CLUSTER.test(graphemes[0])) return null;
  return graphemes[0];
}

export function isProfileEmojiAvatar(value: unknown): boolean {
  return normalizeProfileEmojiAvatar(value) !== null;
}
