export type AppTab = "welcome" | "setup" | "round" | "standings" | "personals" | "results" | "history" | "courses" | "rules" | "pollaLive";

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
