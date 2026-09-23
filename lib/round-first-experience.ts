const FIRST_ROUND_EXPERIENCE_VERSION = 1;

export function firstRoundExperienceKey(userId: string) {
  return `the-backyard:first-round-experience:v${FIRST_ROUND_EXPERIENCE_VERSION}:${encodeURIComponent(userId || "guest")}`;
}

export function hasSeenFirstRoundExperience(storage: Pick<Storage, "getItem">, userId: string) {
  try { return storage.getItem(firstRoundExperienceKey(userId)) === "seen"; }
  catch { return false; }
}

export function markFirstRoundExperienceSeen(storage: Pick<Storage, "setItem">, userId: string) {
  storage.setItem(firstRoundExperienceKey(userId), "seen");
}
