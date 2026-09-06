import { playingHandicap, strokeAllowanceForHole } from "./engine";
import { hasValidRoundHandicap } from "./handicap-base";
import type { Hole, Player } from "./types";

export type ScorecardHolePreview = {
  allowance: number | null;
  net: number | null;
  adjustmentLabel: string;
  netLabel: string;
};

function validGross(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 1;
}

/**
 * Builds the golf-card preview shown while a score is still being edited.
 * It intentionally uses the player's round HCP at 100%, independently from
 * every wager's participant list, percentage and handicap basis.
 */
export function scorecardHolePreview(
  player: Pick<Player, "handicap">,
  hole: Pick<Hole, "strokeIndex">,
  gross: number | null | undefined,
): ScorecardHolePreview {
  if (!hasValidRoundHandicap(player)) {
    return {
      allowance: null,
      net: null,
      adjustmentLabel: "Completa HCP",
      netLabel: "Neto pendiente",
    };
  }

  const allowance = strokeAllowanceForHole(
    playingHandicap(player.handicap, 100, "half_up"),
    hole.strokeIndex,
    "half_up",
  );
  const adjustmentLabel = allowance > 0
    ? `Recibe ${allowance} golpe${allowance === 1 ? "" : "s"}`
    : allowance < 0
      ? `Da ${Math.abs(allowance)} golpe${allowance === -1 ? "" : "s"}`
      : "Sin golpes";

  return {
    allowance,
    net: validGross(gross) ? gross - allowance : null,
    adjustmentLabel,
    netLabel: validGross(gross) ? `Neto al guardar ${gross - allowance}` : "Neto pendiente",
  };
}

export function scorecardHoleContext(
  hole: Pick<Hole, "par" | "strokeIndex" | "yards">,
  teeName: string | null | undefined,
) {
  const labels = [`Par ${hole.par}`, `SI ${hole.strokeIndex}`];
  if (typeof hole.yards === "number" && Number.isFinite(hole.yards) && hole.yards > 0) {
    labels.push(`${Math.round(hole.yards)} yd`);
  }
  const tee = typeof teeName === "string" ? teeName.trim() : "";
  if (tee) labels.push(`Tee ${tee}`);
  return labels;
}
