import type { BetConfig, ScoreCaptureMode, SupplementalBet } from "./types";

export type RoundCaptureField = "putts" | "bunker" | "fish";

type CaptureBetContext = Pick<BetConfig, "vipers" | "camels" | "fish">;

function participates(enabled: boolean, participantIds: readonly string[], playerId: string) {
  return enabled && participantIds.includes(playerId);
}

/**
 * The capture screen asks only for facts consumed by an active deterministic
 * game, unless the golfer explicitly selects the optional statistics mode.
 */
export function roundCaptureFieldsForPlayer(input: {
  mode: ScoreCaptureMode;
  playerId: string;
  playedHoleIndex: number;
  bets: CaptureBetContext;
  supplementalBets: readonly SupplementalBet[];
}): RoundCaptureField[] {
  const fields = new Set<RoundCaptureField>();
  const { mode, playerId, playedHoleIndex, bets, supplementalBets } = input;

  const minimumPuttsNeedsPlayer = supplementalBets.some((bet) => (
    bet.enabled !== false
      && bet.type === "minimum_putts"
      && playedHoleIndex < bet.holes
      && bet.participantIds.includes(playerId)
  ));

  if (mode === "advanced" || minimumPuttsNeedsPlayer || participates(bets.vipers.enabled, bets.vipers.participantIds, playerId)) {
    fields.add("putts");
  }
  if (participates(bets.camels.enabled, bets.camels.participantIds, playerId)) fields.add("bunker");
  if (participates(bets.fish.enabled, bets.fish.participantIds, playerId)) fields.add("fish");
  return [...fields];
}

/** Víboras keeps using the existing CounterBetEvent engine representation. */
export function viperQuantityFromPutts(value: number | null) {
  return value !== null && Number.isFinite(value) && value >= 3 ? 1 : 0;
}

export function scoreToParLabel(score: number | null | undefined, par: number) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Sin score";
  const difference = Math.trunc(score) - Math.trunc(par);
  if (difference === 0) return "Par";
  return `${difference > 0 ? "+" : ""}${difference}`;
}
