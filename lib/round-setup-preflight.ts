import type { BetConfigurationIssue } from "./bet-config-validation";
import { MAX_ROUND_PLAYERS, ROUND_PLAYER_LIMIT_MESSAGE, roundPlayerLimitExceeded } from "./round-player-limit";

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
  } else {
    if (roundPlayerLimitExceeded(input.players.length)) {
      issues.push({ id: "player-limit", label: "Jugadores", detail: `${ROUND_PLAYER_LIMIT_MESSAGE}. Quita ${input.players.length - MAX_ROUND_PLAYERS} para continuar.`, targetId: "round-players", kind: "players" });
    }
    if (input.players.some((player) => !player.name.trim())) {
      issues.push({ id: "player-names", label: "Nombre de jugadores", detail: "Completa los nombres vacíos.", targetId: "round-players", kind: "players" });
    }
  }
  const seen = new Set<string>();
  for (const issue of input.betIssues) {
    const key = `${issue.sectionId}:${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = /hcp|handicap/i.test(issue.code) ? "HCP"
      : /participant|player/i.test(issue.code) ? "Jugadores"
        : /pair|team|pareja|equipo/i.test(issue.code) ? "Parejas / equipos"
          : /stake|value|price|amount/i.test(issue.code) ? "Precio"
            : "Configuración de apuesta";
    issues.push({ id: `bet:${key}`, label, detail: issue.message, targetId: issue.sectionId || "round-bet-validation", kind: "bets" });
  }
  return issues;
}
