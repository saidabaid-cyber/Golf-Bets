import type { BetConfig, ScoreCaptureMode, SupplementalBet } from "./types";
import { captureRequirementsForPlayer } from "./bets/capture-requirements";

export type RoundCaptureField = "putts" | "bunker" | "fish" | "penalties" | "ob";

type CaptureBetContext = Pick<BetConfig, "vipers" | "camels" | "fish" | "units">;

export type CaptureAnimalVisibility = {
  viper: boolean;
  camel: boolean;
  fish: boolean;
};

function activeForPlayer(config: { enabled: boolean; participantIds: string[] }, playerId: string) {
  return config.enabled === true && config.participantIds.includes(playerId);
}

/** Animal marks are contextual affordances, never standalone inputs. */
export function captureAnimalVisibility(
  bets: Pick<BetConfig, "vipers" | "camels" | "fish">,
  playerId: string,
): CaptureAnimalVisibility {
  return {
    viper: activeForPlayer(bets.vipers, playerId),
    camel: activeForPlayer(bets.camels, playerId),
    fish: activeForPlayer(bets.fish, playerId),
  };
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

  const requirements = captureRequirementsForPlayer({ playerId, playedHoleIndex, bets, supplementalBets });

  if (mode === "advanced" || requirements.required.includes("putts")) {
    fields.add("putts");
  }
  if (mode === "advanced") { fields.add("penalties"); fields.add("ob"); }
  if (requirements.optional.some((field) => field === "green_side_bunker" || field === "fairway_bunker")) fields.add("bunker");
  if (requirements.optional.includes("penalty_area")) fields.add("fish");
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
