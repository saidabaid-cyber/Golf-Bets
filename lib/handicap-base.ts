import type { BetConfig, HandicapBaseConfig, Player, RoundHandicapBasis, SupplementalBet } from "./types";

export const DEFAULT_ROUND_HANDICAP_BASIS: RoundHandicapBasis = "relative";

export function normalizeRoundHandicapBasis(value: unknown): RoundHandicapBasis {
  return value === "course" ? "course" : DEFAULT_ROUND_HANDICAP_BASIS;
}

export function hasValidRoundHandicap<T extends Pick<Player, "handicap">>(player: T): player is T & { handicap: number } {
  return typeof player.handicap === "number" && Number.isFinite(player.handicap);
}

export function playersMissingRoundHandicap(players: Player[]) {
  return players.filter((player) => !hasValidRoundHandicap(player));
}

export function lowestHandicap(players: Player[]) {
  const valid = players.filter(hasValidRoundHandicap);
  return valid.length ? Math.min(...valid.map(player => player.handicap)) : undefined;
}

/** Returns only real, finite HCP values. Callers must not substitute a missing key with zero. */
export function roundHandicapBases(players: Player[], basis: RoundHandicapBasis = DEFAULT_ROUND_HANDICAP_BASIS) {
  if (playersMissingRoundHandicap(players).length) return {} as Record<string, number>;
  const reference = basis === "course" ? 0 : lowestHandicap(players) ?? 0;
  return Object.fromEntries(players.map((player) => [player.id, player.handicap! - reference])) as Record<string, number>;
}

/** Missing mode retains each engine's saved behavior; never migrate snapshots implicitly. */
export function handicapBases(config: HandicapBaseConfig, active: Player[], participants: Player[], legacy: Player[] = active, basis: RoundHandicapBasis = DEFAULT_ROUND_HANDICAP_BASIS) {
  if (playersMissingRoundHandicap(active).length) return {} as Record<string, number>;
  if (basis === "course") return roundHandicapBases(active, basis);
  const reference = config.baseMode === "fixed"
    ? config.fixedBaseHandicap ?? lowestHandicap(participants)
    : lowestHandicap(config.baseMode === "moving" ? active : legacy);
  if (reference === undefined) return {} as Record<string, number>;
  return Object.fromEntries(active.map(player => [player.id, player.handicap! - reference]));
}

/** Freeze once when configuration is confirmed; later pair/rest/participant edits retain it. */
export function freezeHandicapBase<T extends HandicapBaseConfig & { participantIds: string[] }>(config: T, players: Player[]): T {
  if (config.baseMode !== "fixed" || config.fixedBaseHandicap !== undefined) return config;
  const participants = players.filter(player => config.participantIds.includes(player.id));
  const reference = playersMissingRoundHandicap(participants).length ? undefined : lowestHandicap(participants);
  if (reference === undefined) return config;
  return { ...config, fixedBaseHandicap: reference };
}

export function freezeRoundHandicapBases(bets: BetConfig, players: Player[], basis: RoundHandicapBasis = DEFAULT_ROUND_HANDICAP_BASIS): BetConfig {
  if (basis === "course") return bets;
  return { ...bets, foursome: freezeHandicapBase(bets.foursome, players), ballFriend: freezeHandicapBase(bets.ballFriend, players) };
}

/** Players whose original HCP is required by at least one currently active round bet. */
export function missingHandicapsForActiveBets(players: Player[], bets: BetConfig, supplementalBets: SupplementalBet[]) {
  const requiredIds = new Set<string>();
  const add = (enabled: boolean | undefined, participantIds: string[] | undefined) => {
    if (enabled && participantIds) participantIds.forEach((id) => requiredIds.add(id));
  };
  add(bets.rabbits.enabled, bets.rabbits.participantIds);
  add(bets.skins.enabled, bets.skins.participantIds);
  add(bets.monkey?.enabled, bets.monkey?.participantIds);
  add(bets.foursome.enabled, bets.foursome.participantIds);
  add(bets.ballFriend.enabled, bets.ballFriend.participantIds);
  add(bets.polla.first9.enabled, bets.polla.first9.participantIds);
  add(bets.polla.second9.enabled, bets.polla.second9.participantIds);
  add(bets.polla.total18.enabled, bets.polla.total18.participantIds);
  add(bets.miniPolla.enabled, bets.miniPolla.participantIds);
  add(bets.loba.enabled, bets.loba.participantIds);
  for (const bet of supplementalBets) {
    if (!bet.enabled || bet.type === "individual_nassau" || bet.type === "dollar_stroke" || bet.type === "minimum_putts") continue;
    bet.participantIds.forEach((id) => requiredIds.add(id));
  }
  return players.filter((player) => requiredIds.has(player.id) && !hasValidRoundHandicap(player));
}
