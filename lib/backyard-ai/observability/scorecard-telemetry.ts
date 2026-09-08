import type { ScorecardCellOverride, ScorecardValidationIssue } from "../schemas/scorecard";

export type ScorecardCorrectionEvidence = {
  playerId: string;
  hole: number;
  extractedScore: number | null;
  correctedScore: number;
  confidence: number;
  source: "VISION";
  photoId?: string;
  reason: "LOW_CONFIDENCE" | "TOTAL_MISMATCH" | "DIGITAL_MISMATCH" | "OUT_OF_RANGE" | "OTHER";
};

function correctionReason(issue: ScorecardValidationIssue): ScorecardCorrectionEvidence["reason"] {
  if (issue.code === "low_confidence_score") return "LOW_CONFIDENCE";
  if (issue.code === "digital_score_mismatch") return "DIGITAL_MISMATCH";
  if (issue.code === "score_out_of_range" || issue.code === "score_implausible_for_par") return "OUT_OF_RANGE";
  if (issue.code === "total_mismatch") return "TOTAL_MISMATCH";
  return "OTHER";
}

/** A low-confidence value confirmed unchanged resolves a doubt, but it is not
 * a correction and must not contaminate correction-rate or learning labels. */
export function scorecardCorrectionEvidenceForCell(
  issue: ScorecardValidationIssue | undefined,
  cell: ScorecardCellOverride,
): ScorecardCorrectionEvidence | null {
  if (
    !issue
    || issue.resolution !== "cell_value"
    || issue.playerId !== cell.playerId
    || issue.hole !== cell.hole
  ) return null;
  const extractedScore = typeof issue.candidateValue === "number" ? issue.candidateValue : null;
  if (extractedScore === cell.value) return null;
  const rawConfidence = typeof issue.confidence === "number" && Number.isFinite(issue.confidence) ? issue.confidence : 0;
  return {
    playerId: cell.playerId,
    hole: cell.hole,
    extractedScore,
    correctedScore: cell.value,
    confidence: Math.max(0, Math.min(1, rawConfidence)),
    source: "VISION",
    ...(typeof issue.source?.photoId === "string" && issue.source.photoId.trim() ? { photoId: issue.source.photoId } : {}),
    reason: correctionReason(issue),
  };
}
