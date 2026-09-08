import type { ScorecardConfidencePolicy } from "../schemas/scorecard";

export const DEFAULT_SCORECARD_CONFIDENCE_POLICY: Readonly<ScorecardConfidencePolicy> = Object.freeze({
  cellAutoAccept: 0.9,
  playerAutoMatch: 0.9,
  courseAutoMatch: 0.88,
  totalCheck: 0.75,
  parCheck: 0.75,
});

export type ScorecardConfidenceBand = "low" | "review" | "high";

export function isScorecardConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function scorecardConfidenceBand(value: number, autoAccept = DEFAULT_SCORECARD_CONFIDENCE_POLICY.cellAutoAccept): ScorecardConfidenceBand {
  if (!isScorecardConfidence(value) || value < 0.5) return "low";
  return value >= autoAccept ? "high" : "review";
}

export function scorecardConfidencePolicy(overrides: Partial<ScorecardConfidencePolicy> = {}): ScorecardConfidencePolicy {
  const policy = { ...DEFAULT_SCORECARD_CONFIDENCE_POLICY, ...overrides };
  for (const key of Object.keys(policy) as Array<keyof ScorecardConfidencePolicy>) {
    if (!isScorecardConfidence(policy[key])) policy[key] = DEFAULT_SCORECARD_CONFIDENCE_POLICY[key];
  }
  return policy;
}
