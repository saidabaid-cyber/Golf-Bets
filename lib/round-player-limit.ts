export const MAX_ROUND_PLAYERS = 5;

export const ROUND_PLAYER_LIMIT_MESSAGE = "MÁXIMO 5 JUGADORES POR GRUPO DE SALIDA";

export function roundPlayerLimitExceeded(playerCount: number) {
  return Number.isFinite(playerCount) && playerCount > MAX_ROUND_PLAYERS;
}
