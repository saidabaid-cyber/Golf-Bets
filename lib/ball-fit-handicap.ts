/** Context for a fitting, never an update to the player's handicap profile. */
export const BALL_FIT_HANDICAP_SOURCES = ["GHIN", "BACKYARD", "MANUAL", "UNKNOWN"] as const;
export type BallFitHandicapSource = (typeof BALL_FIT_HANDICAP_SOURCES)[number];
export const BALL_FIT_EXPERIENCES = ["STARTING", "OCCASIONAL", "REGULAR", "UNKNOWN"] as const;
export type BallFitExperience = (typeof BALL_FIT_EXPERIENCES)[number];

export const BALL_FIT_HANDICAP_LABELS: Record<BallFitHandicapSource, string> = {
  GHIN: "GHIN Index · fuente oficial vinculada",
  BACKYARD: "Backyard Index · local, no oficial",
  MANUAL: "HCP manual · declarado para este fitting",
  UNKNOWN: "Sin hándicap conocido",
};

export function normalizeBallFitHandicap(value: unknown, source: unknown) {
  const handicap = typeof value === "number" && Number.isFinite(value) && value >= -20 && value <= 54 ? value : null;
  const handicapSource: BallFitHandicapSource = source === "UNKNOWN" ? "UNKNOWN"
    : source === "MANUAL" ? "MANUAL"
      : handicap === null ? "UNKNOWN"
        : source === "GHIN" || source === "BACKYARD" ? source : "MANUAL";
  return { handicap: handicapSource === "UNKNOWN" ? null : handicap, handicapSource };
}

export function normalizeBallFitExperience(value: unknown): BallFitExperience {
  return typeof value === "string" && (BALL_FIT_EXPERIENCES as readonly string[]).includes(value)
    ? value as BallFitExperience : "UNKNOWN";
}
