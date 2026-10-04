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

// Account UX only: never used for consent, access, entitlements or betting.
export const FIRST_EXPERIENCE_METADATA_KEY = "backyard_first_experience_v1";
export type FirstExperienceState = {
  version: 1;
  friendDiscovery: "pending" | "opened" | "skipped" | "already_has_friends";
  firstGroup: "pending" | "opened" | "skipped" | "created" | "already_has_group";
  firstRoundGroup: "pending" | "created" | "skipped" | "not_needed";
  timestamps: Partial<Record<FirstExperienceField, string>>;
};
export type FirstExperienceField = "friendDiscovery" | "firstGroup" | "firstRoundGroup";
export const FIRST_EXPERIENCE_VALUES = {
  friendDiscovery: ["pending", "opened", "skipped", "already_has_friends"],
  firstGroup: ["pending", "opened", "skipped", "created", "already_has_group"],
  firstRoundGroup: ["pending", "created", "skipped", "not_needed"],
} as const;

export function firstExperienceState(raw: unknown): FirstExperienceState {
  const state: FirstExperienceState = { version: 1, friendDiscovery: "pending", firstGroup: "pending", firstRoundGroup: "pending", timestamps: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as { version?: unknown }).version !== 1) return state;
  const value = raw as Record<string, unknown>;
  const times = value.timestamps && typeof value.timestamps === "object" ? value.timestamps as Record<string, unknown> : {};
  for (const field of Object.keys(FIRST_EXPERIENCE_VALUES) as FirstExperienceField[]) {
    if ((FIRST_EXPERIENCE_VALUES[field] as readonly unknown[]).includes(value[field])) Object.assign(state, { [field]: value[field] });
    if (typeof times[field] === "string" && Number.isFinite(Date.parse(times[field]))) state.timestamps[field] = times[field] as string;
  }
  return state;
}

export function resolveFirstExperience(state: FirstExperienceState, field: FirstExperienceField, value: string, now: string): FirstExperienceState {
  if (!(FIRST_EXPERIENCE_VALUES[field] as readonly string[]).includes(value) || value === "pending") throw new Error("Invalid first experience decision");
  // A retry or a stale tab cannot put a resolved prompt back in pending/opened.
  if (state[field] === value || (state[field] !== "pending" && value !== "created" && value !== "already_has_group" && value !== "already_has_friends")) return state;
  return { ...state, [field]: value, timestamps: { ...state.timestamps, [field]: now } };
}

export type FirstExperiencePrompt = "friends" | "group" | "roundGroup";
export function firstExperiencePrompt(state: FirstExperienceState, context: { home: boolean; setup: boolean; hasGroup: boolean }) : FirstExperiencePrompt | null {
  if (context.setup && !context.hasGroup && state.firstRoundGroup === "pending") return "roundGroup";
  if (!context.home) return null;
  if (state.friendDiscovery === "pending") return "friends";
  if (!context.hasGroup && state.firstGroup === "pending") return "group";
  return null;
}

/** The caller supplies current visibility/modal predicates; leaving the screen
 * cancels this timer rather than opening a prompt on another screen. */
export function scheduleFirstExperienceNudge(prompt: FirstExperiencePrompt, stillEligible: () => boolean, open: () => void) {
  const timer = setTimeout(() => { if (stillEligible()) open(); }, prompt === "friends" ? 5_000 : 300);
  return () => clearTimeout(timer);
}

export function firstRoundGroupCopy(scoreOnly: boolean) {
  return scoreOnly
    ? "Crea un grupo para guardar a tus jugadores habituales y cargarlos rápidamente en futuras rondas."
    : "Crea un grupo para guardar jugadores y tus apuestas habituales. La próxima vez podrás cargarlo completo en segundos.";
}
