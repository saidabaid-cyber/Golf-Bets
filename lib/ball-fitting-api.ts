import {
  BACKYARD_BALL_FIT_DISCLAIMER,
  normalizeBallFitInput,
  type BallFitInput,
  type BallFitRecommendation,
  type BallFitResult,
  type BallFitStatus,
} from "./ball-fitting";
import {
  BALL_PRICE_TIERS,
  QUALITATIVE_LEVELS,
  normalizeGolfBallCatalogEntries,
  type BallPriceTier,
  type GolfBallCatalog,
  type QualitativeLevel,
} from "./golf-equipment";

export const BALL_FIT_CATALOG_MAX_CANDIDATES = 2_000;
export const BALL_FIT_CATALOG_SCOPE_ERROR = "BALL_FIT_CATALOG_SCOPE_INCOMPLETE";
export const BALL_FIT_TRANSPORT_SCOPE_ID = "backyard-ball-fit-stateless";

export type BallFitCatalogScope = {
  complete: true;
  activeCandidateCount: number;
  evaluatedCandidateCount: number;
  maximumCandidates: number;
};

export type BallFitApiSuccess = {
  provider: string;
  scope: BallFitCatalogScope;
  result: BallFitResult;
  catalog: GolfBallCatalog[];
};

type UnknownRecord = Record<string, unknown>;

/** The recommender is stateless. Replace owner identifiers before the request
 * leaves the browser while preserving the local input used to save the fit. */
export function createBallFitTransportInput(value: unknown): BallFitInput | null {
  const input = normalizeBallFitInput(value);
  if (!input) return null;
  return {
    ...input,
    userId: BALL_FIT_TRANSPORT_SCOPE_ID,
    launchMonitorSession: input.launchMonitorSession ? {
      ...input.launchMonitorSession,
      userId: BALL_FIT_TRANSPORT_SCOPE_ID,
    } : null,
  };
}

/** Server boundary: reject future clients that accidentally send account ids. */
export function normalizeBallFitTransportInput(value: unknown): BallFitInput | null {
  const source = value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
  const launchSource = source?.launchMonitorSession !== null && source?.launchMonitorSession !== undefined
    && typeof source.launchMonitorSession === "object" && !Array.isArray(source.launchMonitorSession)
    ? source.launchMonitorSession as UnknownRecord
    : null;
  if (!source || source.userId !== BALL_FIT_TRANSPORT_SCOPE_ID
    || (source.launchMonitorSession !== null && source.launchMonitorSession !== undefined
      && launchSource?.userId !== BALL_FIT_TRANSPORT_SCOPE_ID)) return null;
  const input = normalizeBallFitInput(value);
  if (!input || input.userId !== BALL_FIT_TRANSPORT_SCOPE_ID
    || (launchSource && !input.launchMonitorSession)
    || (input.launchMonitorSession && input.launchMonitorSession.userId !== BALL_FIT_TRANSPORT_SCOPE_ID)) return null;
  return input;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function finiteInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function normalizedLevel(value: unknown): QualitativeLevel | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && (QUALITATIVE_LEVELS as readonly string[]).includes(value)
    ? value as QualitativeLevel
    : undefined;
}

function normalizedPriceTier(value: unknown): BallPriceTier | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && (BALL_PRICE_TIERS as readonly string[]).includes(value)
    ? value as BallPriceTier
    : undefined;
}

function normalizedTextList(value: unknown, maximum = 12): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const normalized = value.map((item) => text(item, 500));
  return normalized.some((item) => item === null) ? null : normalized as string[];
}

function normalizeRecommendation(value: unknown, expectedRank: number): BallFitRecommendation | null {
  const source = record(value);
  const attributes = record(source?.attributes);
  if (!source || !attributes) return null;
  const rank = finiteInteger(source.rank, 1, 3);
  const catalogBallId = text(source.catalogBallId, 200);
  const brand = text(source.brand, 120);
  const model = text(source.model, 200);
  const generation = source.generation === null ? null : text(source.generation, 120);
  const matchScore = finiteInteger(source.matchScore, 0, 100);
  const dataCoverage = finiteInteger(source.dataCoverage, 0, 100);
  const why = normalizedTextList(source.why);
  const comparisonToCurrent = normalizedTextList(source.comparisonToCurrent);
  const flight = normalizedLevel(attributes.flight);
  const feel = normalizedLevel(attributes.feel);
  const driverSpin = normalizedLevel(attributes.driverSpin);
  const ironSpin = normalizedLevel(attributes.ironSpin);
  const shortGameSpin = normalizedLevel(attributes.shortGameSpin);
  const priceTier = normalizedPriceTier(attributes.priceTier);
  if (rank !== expectedRank || !catalogBallId || !brand || !model || generation === undefined
    || matchScore === null || dataCoverage === null || !why || !comparisonToCurrent
    || flight === undefined || feel === undefined || driverSpin === undefined
    || ironSpin === undefined || shortGameSpin === undefined || priceTier === undefined) return null;
  return {
    rank: rank as 1 | 2 | 3,
    catalogBallId,
    brand,
    model,
    generation,
    matchScore,
    dataCoverage,
    why,
    attributes: { flight, feel, driverSpin, ironSpin, shortGameSpin, priceTier },
    comparisonToCurrent,
  };
}

/** Defensive client boundary for the stateless fitting endpoint. The endpoint
 * returns only the current and recommended records, never the full catalog. */
export function normalizeBallFitApiSuccess(value: unknown): BallFitApiSuccess | null {
  const source = record(value);
  const scopeSource = record(source?.scope);
  const resultSource = record(source?.result);
  if (!source || !scopeSource || !resultSource || scopeSource.complete !== true) return null;
  const provider = text(source.provider, 120);
  const activeCandidateCount = finiteInteger(scopeSource.activeCandidateCount, 0, BALL_FIT_CATALOG_MAX_CANDIDATES);
  const evaluatedCandidateCount = finiteInteger(scopeSource.evaluatedCandidateCount, 0, BALL_FIT_CATALOG_MAX_CANDIDATES);
  const maximumCandidates = finiteInteger(scopeSource.maximumCandidates, 1, BALL_FIT_CATALOG_MAX_CANDIDATES);
  const statuses: readonly BallFitStatus[] = ["COMPLETE", "PARTIAL", "INSUFFICIENT_INPUT", "NO_VERIFIED_MATCHES"];
  const status = typeof resultSource.status === "string" && statuses.includes(resultSource.status as BallFitStatus)
    ? resultSource.status as BallFitStatus
    : null;
  const inputCompleteness = finiteInteger(resultSource.inputCompleteness, 0, 100);
  const warnings = normalizedTextList(resultSource.warnings, 20);
  const recommendations = Array.isArray(resultSource.recommendations) && resultSource.recommendations.length <= 3
    ? resultSource.recommendations.map((item, index) => normalizeRecommendation(item, index + 1))
    : null;
  const catalog = normalizeGolfBallCatalogEntries(source.catalog);
  const launchMonitorSummary = resultSource.launchMonitorSummary === null || record(resultSource.launchMonitorSummary)
    ? resultSource.launchMonitorSummary as BallFitResult["launchMonitorSummary"]
    : undefined;
  if (!provider || activeCandidateCount === null || evaluatedCandidateCount === null || maximumCandidates === null
    || evaluatedCandidateCount !== activeCandidateCount || activeCandidateCount > maximumCandidates
    || !status || inputCompleteness === null || !warnings || !recommendations
    || recommendations.some((item) => item === null)
    || resultSource.disclaimer !== BACKYARD_BALL_FIT_DISCLAIMER || launchMonitorSummary === undefined) return null;
  const safeRecommendations = recommendations as BallFitRecommendation[];
  const returnedIds = new Set(catalog.map((ball) => ball.id));
  if (safeRecommendations.some((item) => !returnedIds.has(item.catalogBallId))) return null;
  return {
    provider,
    scope: { complete: true, activeCandidateCount, evaluatedCandidateCount, maximumCandidates },
    result: {
      status,
      inputCompleteness,
      recommendations: safeRecommendations,
      warnings,
      disclaimer: BACKYARD_BALL_FIT_DISCLAIMER,
      launchMonitorSummary,
    },
    catalog,
  };
}
