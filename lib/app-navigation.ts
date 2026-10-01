export type AppTab = "welcome" | "career" | "coach" | "play" | "totalScore" | "aiSetup" | "setup" | "round" | "scorecardScan" | "standings" | "personals" | "personalDetail" | "historyDetail" | "results" | "history" | "balances" | "stats" | "courseLibrary" | "courses" | "rules" | "pollaLive" | "account" | "profile" | "groups" | "social";

export const BOTTOM_NAV_TARGETS = {
  Inicio: "welcome",
  Carrera: "career",
  Play: "play",
  "My Coach": "coach",
  Reglas: "rules",
} as const satisfies Record<string, AppTab>;

export type PrimaryAppSection = keyof typeof BOTTOM_NAV_TARGETS;
export type ActiveRoundStatus = "setup" | "live" | "review";

const PLAY_TABS = new Set<AppTab>([
  "play", "aiSetup", "setup", "round", "scorecardScan", "standings", "personals", "personalDetail",
  "results", "balances", "courseLibrary", "courses", "pollaLive", "groups", "totalScore",
]);

export function primarySectionForTab(tab: AppTab): PrimaryAppSection {
  if (tab === "career" || tab === "stats" || tab === "history" || tab === "historyDetail") return "Carrera";
  if (tab === "coach") return "My Coach";
  if (tab === "rules") return "Reglas";
  if (PLAY_TABS.has(tab)) return "Play";
  return "Inicio";
}

export function isPrimaryTab(tab: AppTab) {
  return Object.values(BOTTOM_NAV_TARGETS).some((target) => target === tab);
}

const SCREEN_TABS = new Set<string>([...Object.values(BOTTOM_NAV_TARGETS), ...PLAY_TABS, "stats", "history", "historyDetail", "personals", "profile", "account", "social"]);

/** One URL per view, retaining the existing app instance and round state. */
export function screenHref(tab: AppTab, search = "") {
  const params = new URLSearchParams(search);
  params.delete("screen");
  if (tab !== "welcome") params.set("screen", tab);
  return `/${params.size ? `?${params.toString()}` : ""}`;
}

export function screenFromSearch(search: string): AppTab {
  const screen = new URLSearchParams(search).get("screen");
  return screen && SCREEN_TABS.has(screen) ? screen as AppTab : "welcome";
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
