import type { ClubCategory, GolfBallCatalog, GolfClubCatalog } from "./golf-equipment";

export type GolfBallBrand = {
  id: string;
  name: string;
  active: boolean;
  officialUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GolfClubBrand = GolfBallBrand;

export const COMPRESSION_TYPES = ["MANUFACTURER", "INDEPENDENT_MEASURED", "ESTIMATED", "UNKNOWN"] as const;
export type CompressionType = (typeof COMPRESSION_TYPES)[number];

export type GolfBallCatalogRecord = GolfBallCatalog & {
  brandId: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  constructionPieces: number | null;
  dimpleCount: number | null;
  compressionType: CompressionType;
  compressionSource: string | null;
  compressionMin: number | null;
  compressionMax: number | null;
  compressionAverage: number | null;
  recommendedSwingSpeedMin: number | null;
  recommendedSwingSpeedMax: number | null;
  targetPlayerDescription: string | null;
  usgaConforming: boolean | null;
};

export type GolfClubCatalogRecord = GolfClubCatalog & {
  brandId: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  construction: string | null;
};

export const GOLF_BALL_TEST_CLUB_TYPES = ["DRIVER", "SEVEN_IRON", "PW", "WEDGE", "OTHER"] as const;
export type GolfBallTestClubType = (typeof GOLF_BALL_TEST_CLUB_TYPES)[number];

export type GolfBallTestResult = {
  id: string;
  golfBallId: string;
  testSource: string;
  sourceUrl: string;
  testYear: number | null;
  clubType: GolfBallTestClubType;
  swingSpeedMph: number | null;
  ballSpeedMph: number | null;
  launchAngleDegrees: number | null;
  spinRateRpm: number | null;
  carryYards: number | null;
  totalDistanceYards: number | null;
  peakHeightYards: number | null;
  descentAngleDegrees: number | null;
  dispersionYards: number | null;
  notes: string | null;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type GolfCatalogSearchInput = {
  query: string;
  cursor?: string | null;
  limit?: number;
  activeOnly?: boolean;
  brandId?: string | null;
  category?: ClubCategory | null;
};

export type GolfCatalogPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function requiredText(value: unknown, maximum = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function optionalText(value: unknown, maximum = 1_000): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, maximum);
}

function optionalNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function requiredIsoDate(value: unknown): string | null {
  const candidate = requiredText(value, 40);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

/**
 * Validates imported test evidence before it can enter a fitting data layer.
 * Missing metrics remain null. A provenance label, source URL and verification
 * date are mandatory so an anonymous or copied dataset cannot silently become
 * product truth.
 */
export function normalizeGolfBallTestResult(value: unknown): GolfBallTestResult | null {
  const source = record(value);
  if (!source) return null;
  const id = requiredText(source.id, 120);
  const golfBallId = requiredText(source.golfBallId, 200);
  const testSource = requiredText(source.testSource, 240);
  const sourceUrl = requiredText(source.sourceUrl, 1_000);
  const verifiedAt = requiredIsoDate(source.verifiedAt);
  const createdAt = requiredIsoDate(source.createdAt);
  const updatedAt = requiredIsoDate(source.updatedAt);
  const clubType = typeof source.clubType === "string" && (GOLF_BALL_TEST_CLUB_TYPES as readonly string[]).includes(source.clubType)
    ? source.clubType as GolfBallTestClubType
    : null;
  if (!id || !golfBallId || !testSource || !sourceUrl || !verifiedAt || !createdAt || !updatedAt || !clubType) return null;
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return {
    id,
    golfBallId,
    testSource,
    sourceUrl,
    testYear: optionalNumber(source.testYear, 1900, 2200),
    clubType,
    swingSpeedMph: optionalNumber(source.swingSpeedMph, 20, 180),
    ballSpeedMph: optionalNumber(source.ballSpeedMph, 20, 250),
    launchAngleDegrees: optionalNumber(source.launchAngleDegrees, -20, 90),
    spinRateRpm: optionalNumber(source.spinRateRpm, 0, 20_000),
    carryYards: optionalNumber(source.carryYards, 0, 500),
    totalDistanceYards: optionalNumber(source.totalDistanceYards, 0, 600),
    peakHeightYards: optionalNumber(source.peakHeightYards, 0, 300),
    descentAngleDegrees: optionalNumber(source.descentAngleDegrees, -20, 90),
    dispersionYards: optionalNumber(source.dispersionYards, 0, 250),
    notes: optionalText(source.notes),
    verifiedAt,
    createdAt,
    updatedAt,
  };
}
