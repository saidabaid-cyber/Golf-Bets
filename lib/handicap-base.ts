import type { BetConfig, HandicapBaseConfig, Player } from "./types";

export function lowestHandicap(players: Player[]) {
  return players.length ? Math.min(...players.map(player => player.handicap ?? 0)) : 0;
}

/** Missing mode retains each engine's saved behavior; never migrate snapshots implicitly. */
export function handicapBases(config: HandicapBaseConfig, active: Player[], participants: Player[], legacy: Player[] = active) {
  const reference = config.baseMode === "fixed"
    ? config.fixedBaseHandicap ?? lowestHandicap(participants)
    : lowestHandicap(config.baseMode === "moving" ? active : legacy);
  return Object.fromEntries(active.map(player => [player.id, (player.handicap ?? 0) - reference]));
}

/** Freeze once when configuration is confirmed; later pair/rest/participant edits retain it. */
export function freezeHandicapBase<T extends HandicapBaseConfig & { participantIds: string[] }>(config: T, players: Player[]): T {
  if (config.baseMode !== "fixed" || config.fixedBaseHandicap !== undefined) return config;
  const participants = players.filter(player => config.participantIds.includes(player.id));
  if (!participants.length) return config;
  return { ...config, fixedBaseHandicap: lowestHandicap(participants) };
}

export function freezeRoundHandicapBases(bets: BetConfig, players: Player[]): BetConfig {
  return { ...bets, foursome: freezeHandicapBase(bets.foursome, players), ballFriend: freezeHandicapBase(bets.ballFriend, players) };
}
