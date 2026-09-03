export type AppTab = "welcome" | "setup" | "round" | "standings" | "personals" | "personalDetail" | "historyDetail" | "results" | "history" | "courses" | "rules" | "pollaLive" | "account" | "groups";

export const BOTTOM_NAV_TARGETS = {
  Inicio: "welcome",
  Tarjeta: "round",
  Personales: "personals",
  Resultados: "results",
  Histórico: "history",
  Reglas: "rules",
} as const satisfies Record<string, AppTab>;

export function contrastToggleLabel(active: boolean) {
  return `${active ? "✓" : "☀"} Alto contraste`;
}

export function rulesContextForRound(hasActiveRound: boolean, courseName: string) {
  return hasActiveRound ? courseName : "";
}
