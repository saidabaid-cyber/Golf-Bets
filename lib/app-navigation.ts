export type AppTab = "welcome" | "play" | "setup" | "round" | "standings" | "personals" | "personalDetail" | "historyDetail" | "results" | "history" | "stats" | "courseLibrary" | "courses" | "rules" | "pollaLive" | "account" | "profile" | "groups" | "social";

export const BOTTOM_NAV_TARGETS = {
  Inicio: "welcome",
  Jugar: "play",
  Grupos: "groups",
  Social: "social",
  Perfil: "profile",
} as const satisfies Record<string, AppTab>;

export type PrimaryAppSection = keyof typeof BOTTOM_NAV_TARGETS;
export type ActiveRoundStatus = "setup" | "live" | "review";

const PLAY_TABS = new Set<AppTab>([
  "play", "setup", "round", "standings", "personals", "personalDetail",
  "historyDetail", "results", "history", "courseLibrary", "courses", "rules", "pollaLive",
]);

export function primarySectionForTab(tab: AppTab): PrimaryAppSection {
  if (tab === "groups") return "Grupos";
  if (tab === "social") return "Social";
  if (tab === "profile" || tab === "account" || tab === "stats") return "Perfil";
  if (PLAY_TABS.has(tab)) return "Jugar";
  return "Inicio";
}

export function resolveActiveRoundStatus(input: { reviewPending: boolean; courseSelected: boolean; playerCount: number; scoreStarted: boolean }): ActiveRoundStatus {
  if (input.reviewPending) return "review";
  return input.courseSelected && input.playerCount > 0 && input.scoreStarted ? "live" : "setup";
}

export function activeRoundContinueTarget(status: ActiveRoundStatus | null | undefined, courseSelected: boolean): AppTab {
  if (status === "review") return "results";
  if (status === "live" && courseSelected) return "round";
  return "setup";
}

const ACTIVE_BET_RESULT_TABS = new Set<AppTab>(["round", "standings", "personalDetail", "results"]);

/** Keeps malformed active bet drafts away from deterministic live/result views until setup is corrected. */
export function activeBetSafeDestination(next: AppTab, hasConfigurationIssues: boolean): AppTab {
  return hasConfigurationIssues && ACTIVE_BET_RESULT_TABS.has(next) ? "setup" : next;
}

export function contrastToggleLabel(active: boolean) {
  return `${active ? "✓" : "☀"} Alto contraste`;
}

export function rulesContextForRound(hasActiveRound: boolean, courseName: string) {
  return hasActiveRound ? courseName : "";
}
