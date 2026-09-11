import type { BetConfigurationIssue } from "./bet-config-validation";

export type RoundSetupPreflightIssue = {
  id: string;
  label: string;
  detail: string;
  targetId: string;
  kind: "course" | "players" | "bets";
};

export function collectRoundSetupPreflightIssues(input: {
  courseSelected: boolean;
  players: readonly { id: string; name: string }[];
  betIssues: readonly BetConfigurationIssue[];
}): RoundSetupPreflightIssue[] {
  const issues: RoundSetupPreflightIssue[] = [];
  if (!input.courseSelected) {
    issues.push({ id: "course", label: "Campo", detail: "Selecciona el campo donde jugarán.", targetId: "round-course", kind: "course" });
  }
  if (!input.players.length) {
    issues.push({ id: "players", label: "Jugadores", detail: "Agrega al menos un jugador.", targetId: "round-players", kind: "players" });
  } else if (input.players.some((player) => !player.name.trim())) {
    issues.push({ id: "player-names", label: "Nombre de jugadores", detail: "Completa los nombres vacíos.", targetId: "round-players", kind: "players" });
  }
  const seen = new Set<string>();
  for (const issue of input.betIssues) {
    const key = `${issue.sectionId}:${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ id: `bet:${key}`, label: "Configuración necesaria", detail: issue.message, targetId: issue.sectionId || "round-bet-validation", kind: "bets" });
  }
  return issues;
}
