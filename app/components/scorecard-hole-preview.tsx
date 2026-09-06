import type { Hole, Player } from "../../lib/types";
import { scorecardHoleContext, scorecardHolePreview } from "../../lib/scorecard-hole-preview";

export function ScorecardHoleContext({ hole, teeName }: {
  hole: Pick<Hole, "par" | "strokeIndex" | "yards">;
  teeName?: string | null;
}) {
  return <p className="scorecardHoleContext">{scorecardHoleContext(hole, teeName).join(" · ")}</p>;
}

export function ScorecardHoleNetPreview({ player, hole, gross }: {
  player: Pick<Player, "handicap">;
  hole: Pick<Hole, "strokeIndex">;
  gross: number | null | undefined;
}) {
  const preview = scorecardHolePreview(player, hole, gross);
  return <span className={`scorecardNetPreview ${preview.net === null ? "pending" : ""}`}>
    {preview.adjustmentLabel} · {preview.netLabel}
  </span>;
}
