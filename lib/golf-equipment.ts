/**
 * Provider-neutral golf equipment domain.
 *
 * Catalog facts are never derived here: an unknown technical attribute stays
 * `null`. Player equipment is optional and always scoped to the authenticated
 * account id supplied by the caller.
 */

export const QUALITATIVE_LEVELS = ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"] as const;
export type QualitativeLevel = (typeof QUALITATIVE_LEVELS)[number];

export const CLUB_CATEGORIES = [
  "DRIVER",
  "MINI_DRIVER",
  "FAIRWAY_WOOD",
  "HYBRID",
  "UTILITY_IRON",
  "IRON_SET",
  "WEDGE",
  "PUTTER",
] as const;
export type ClubCategory = (typeof CLUB_CATEGORIES)[number];

export const CLUB_HANDEDNESS = ["RH", "LH"] as const;
export type ClubHandedness = (typeof CLUB_HANDEDNESS)[number];

export const SHAFT_FLEXES = ["LADIES", "SENIOR", "REGULAR", "STIFF", "X_STIFF", "TX", "OTHER"] as const;
export type ShaftFlex = (typeof SHAFT_FLEXES)[number];

export const SHAFT_USAGES = ["WOOD", "FAIRWAY", "HYBRID", "UTILITY", "IRON", "WEDGE", "PUTTER"] as const;
export type ShaftUsage = (typeof SHAFT_USAGES)[number];

export const SHAFT_MARKET_TYPES = ["AFTERMARKET", "OEM_STOCK"] as const;
export type ShaftMarketType = (typeof SHAFT_MARKET_TYPES)[number];

export const SHAFT_PROFILES = [...QUALITATIVE_LEVELS, "VARIABLE"] as const;
export type ShaftProfile = (typeof SHAFT_PROFILES)[number];

export const BALL_PRICE_TIERS = ["ECONOMY", "MID", "PREMIUM"] as const;
export type BallPriceTier = (typeof BALL_PRICE_TIERS)[number];

export const BALL_COMPRESSION_TYPES = ["MANUFACTURER", "INDEPENDENT_MEASURED", "ESTIMATED", "UNKNOWN"] as const;
export type BallCompressionType = (typeof BALL_COMPRESSION_TYPES)[number];

export type EquipmentCatalogProvenance = {
  sourceType: string;
  sourceName: string;
  sourceUrl: string;
  verifiedAt: string;
  license: string | null;
  confidence: string | null;
};

export type GolfBallCatalog = {
  id: string;
  aliases: string[];
  brand: string;
  model: string;
  generation: string | null;
  year: number | null;
  active: boolean;
  bagEligible: boolean;
  fitEligible: boolean;
  coverMaterial: string | null;
  construction: string | null;
  constructionPieces: number | null;
  compression: number | null;
  compressionType: BallCompressionType;
  compressionSource: string | null;
  compressionSourceUrl: string | null;
  flight: QualitativeLevel | null;
  driverSpin: QualitativeLevel | null;
  ironSpin: QualitativeLevel | null;
  shortGameSpin: QualitativeLevel | null;
  feel: QualitativeLevel | null;
  colors: string[];
  priceTier: BallPriceTier | null;
  targetProfile: string[];
  officialUrl: string | null;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: string | null;
  confidence: string | null;
  license: string | null;
  provenance: EquipmentCatalogProvenance[];
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type GolfClubCatalog = {
  id: string;
  aliases: string[];
  externalId: string | null;
  brand: string;
  model: string;
  generation: string | null;
  year: number | null;
  category: ClubCategory;
  subCategory: string | null;
  active: boolean;
  bagEligible: boolean;
  fitEligible: boolean;
  handedness: ClubHandedness[];
  lofts: number[];
  variants: GolfClubCatalogVariant[];
  standardLength: number | null;
  lie: number | null;
  headVolume: number | null;
  setMakeup: string | null;
  stockShafts: string[];
  stockFlexes: ShaftFlex[];
  officialUrl: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceCheckedAt: string | null;
  sourceType: string | null;
  confidence: string | null;
  license: string | null;
  provenance: EquipmentCatalogProvenance[];
  verifiedAt: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GolfClubCatalogVariant = {
  loft: number;
  handedness: ClubHandedness[];
};

export type GolfShaftCatalog = {
  id: string;
  aliases: string[];
  brand: string;
  model: string;
  generation: string | null;
  year: number | null;
  usage: ShaftUsage | null;
  active: boolean;
  bagEligible: boolean;
  fitEligible: boolean;
  oemStockOrAftermarket: ShaftMarketType | null;
  weightOptions: number[];
  /** Manufacturer nomenclature is authoritative: 5.5, F4, M4 and SF505
   * must not be destructively translated to a generic flex. */
  flexOptions: string[];
  weight: number | null;
  /** Legacy coarse flex categories retained for existing consumers. */
  flex: ShaftFlex[];
  launch: ShaftProfile | null;
  spin: ShaftProfile | null;
  material: string | null;
  torqueRange: number[];
  torque: number | null;
  tipDiameter: number | null;
  buttDiameter: number | null;
  officialUrl: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  confidence: string | null;
  license: string | null;
  provenance: EquipmentCatalogProvenance[];
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PlayerClub = {
  id: string;
  userId: string;
  category: ClubCategory;
  catalogClubId: string | null;
  customBrand: string | null;
  customModel: string | null;
  generation: string | null;
  year: number | null;
  loft: number | null;
  handedness: ClubHandedness;
  shaftId: string | null;
  customShaftBrand: string | null;
  customShaftModel: string | null;
  /** Legacy combined field retained so existing v1 profiles remain readable. */
  customShaft: string | null;
  flex: ShaftFlex | null;
  /** Exact manufacturer label selected from the catalog (for example 5.5,
   * F4, M4 or SF505). Optional for backward compatibility with v1/v2 data. */
  shaftFlexLabel?: string | null;
  shaftWeightGrams: number | null;
  lengthInches: number | null;
  lieDegrees: number | null;
  grip: string | null;
  notes: string | null;
  setComposition: string[];
  isCurrent: boolean;
  startedUsingAt: string | null;
  stoppedUsingAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlayerBall = {
  id: string;
  userId: string;
  catalogBallId: string | null;
  ballBrand: string;
  ballModel: string;
  generation: string | null;
  year: number | null;
  color: string | null;
  notes: string | null;
  isCurrent: boolean;
  startedUsingAt: string | null;
  stoppedUsingAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const CLUB_DISTANCE_UNITS = ["YD", "M"] as const;
export type ClubDistanceUnit = (typeof CLUB_DISTANCE_UNITS)[number];

export const CLUB_DISTANCE_SOURCES = ["MANUAL", "ROUND_ESTIMATE", "LAUNCH_MONITOR", "GPS", "IMPORT"] as const;
export type ClubDistanceSource = (typeof CLUB_DISTANCE_SOURCES)[number];

export type PlayerClubDistance = {
  id: string;
  userId: string;
  playerClubId: string;
  carryDistance: number | null;
  totalDistance: number | null;
  unit: ClubDistanceUnit;
  source: ClubDistanceSource;
  sampleCount: number | null;
  /** Confidence is an optional 0–100 score, never inferred for manual input. */
  confidence: number | null;
  updatedAt: string;
};

export type OptionalOnboardingStatus = "NOT_ASKED" | "SKIPPED" | "IN_PROGRESS" | "COMPLETED";
export type BallPreference = "NOT_ASKED" | "FIXED" | "NO_FIXED_BALL" | "SKIPPED";

export type EquipmentBallFitSummary = {
  id: string;
  completedAt: string;
  currentBallId: string | null;
  inputCompleteness: number;
  algorithmVersion: string | null;
  status: "COMPLETE" | "PARTIAL" | null;
  input: EquipmentBallFitInputSnapshot | null;
  recommendations: Array<{
    catalogBallId: string;
    matchScore: number;
    brand: string | null;
    model: string | null;
    generation: string | null;
    dataCoverage: number | null;
    why: string[];
    attributes: {
      flight: QualitativeLevel | null;
      feel: QualitativeLevel | null;
      driverSpin: QualitativeLevel | null;
      ironSpin: QualitativeLevel | null;
      shortGameSpin: QualitativeLevel | null;
      priceTier: BallPriceTier | null;
    } | null;
    comparisonToCurrent: string[];
  }>;
  warnings: string[];
};

/** Versioned, provider-neutral snapshot of the answers that produced the last
 * recommendation. String unions are validated when the equipment profile is
 * decoded so the snapshot can safely travel with the cross-device aggregate. */
export type EquipmentBallFitInputSnapshot = {
  userId: string;
  currentBallId: string | null;
  handicap: number | null;
  typicalScore: number | null;
  driverDistanceYards: number | null;
  swingSpeedBand: string;
  feelPreference: string;
  trajectoryPreference: string;
  greenFirmness: string;
  priorities: string[];
  approachBehavior: string;
  wantsGreensideSpin: string;
  pricePreference: string;
  colorPreference: string;
  launchMonitorSession: LaunchMonitorSession | null;
};

/** The envelope/key version remains stable so existing local profiles are
 * discovered and migrated in place instead of becoming orphaned. */
export const EQUIPMENT_PROFILE_STORAGE_VERSION = 1 as const;
/** Snapshot v2 adds temporal equipment fields, split shaft identity and club
 * distances. Cloud writes accept only this canonical version, while reads
 * migrate v1 snapshots without discarding the original data. */
export const EQUIPMENT_PROFILE_SCHEMA_VERSION = 2 as const;

export type EquipmentProfile = {
  schemaVersion: typeof EQUIPMENT_PROFILE_SCHEMA_VERSION;
  userId: string;
  equipmentOnboarding: OptionalOnboardingStatus;
  ballOnboarding: OptionalOnboardingStatus;
  ballPreference: BallPreference;
  clubs: PlayerClub[];
  balls: PlayerBall[];
  distances: PlayerClubDistance[];
  lastBallFit: EquipmentBallFitSummary | null;
  createdAt: string;
  updatedAt: string;
};

export const LAUNCH_MONITOR_CLUBS = ["DRIVER", "IRON_7", "PITCHING_WEDGE", "HALF_WEDGE"] as const;
export type LaunchMonitorClub = (typeof LAUNCH_MONITOR_CLUBS)[number];
export const MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB = 30;

export const LAUNCH_MONITOR_METRICS = [
  "clubSpeedMph",
  "ballSpeedMph",
  "launchAngleDegrees",
  "spinRpm",
  "carryYards",
  "totalYards",
  "peakHeightYards",
  "landingAngleDegrees",
] as const;
export type LaunchMonitorMetric = (typeof LAUNCH_MONITOR_METRICS)[number];

export type LaunchMonitorShot = {
  id: string;
  club: LaunchMonitorClub;
  excluded: boolean;
  capturedAt: string | null;
  note: string | null;
  clubSpeedMph: number | null;
  ballSpeedMph: number | null;
  launchAngleDegrees: number | null;
  spinRpm: number | null;
  carryYards: number | null;
  totalYards: number | null;
  peakHeightYards: number | null;
  landingAngleDegrees: number | null;
};

export type LaunchMonitorSession = {
  id: string;
  userId: string;
  source: string | null;
  startedAt: string;
  completedAt: string | null;
  shots: LaunchMonitorShot[];
};

export type LaunchMetricSummary = {
  sampleCount: number;
  median: number;
  resistantAverage: number;
};

export type LaunchMonitorClubSummary = {
  club: LaunchMonitorClub;
  includedShots: number;
  excludedShots: number;
  metrics: Partial<Record<LaunchMonitorMetric, LaunchMetricSummary>>;
};

export type LaunchMonitorSummary = {
  sessionId: string;
  includedShots: number;
  excludedShots: number;
  byClub: LaunchMonitorClubSummary[];
};

export type LaunchMonitorProtocolProgress = {
  complete: boolean;
  requiredPerClub: 3;
  counts: Record<LaunchMonitorClub, number>;
  missing: Record<LaunchMonitorClub, number>;
};

export type EquipmentStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type EquipmentStorageResult =
  | { ok: true; profile: EquipmentProfile | null }
  | { ok: false; code: "INVALID_USER" | "INVALID_PROFILE" | "READ_FAILED" | "WRITE_FAILED"; message: string };

type UnknownRecord = Record<string, unknown>;

const SET_COMPOSITION = new Set([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "P", "PW", "UW", "GW", "AW", "SW", "LW",
  "46°", "48°", "50°", "52°", "54°", "56°", "58°", "60°", "62°", "64°",
]);

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown, maximum = 180): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function identifier(value: unknown): string | null {
  return text(value, 240);
}

function isoDate(value: unknown): string | null {
  const cleaned = text(value, 80);
  return cleaned && !Number.isNaN(Date.parse(cleaned)) ? cleaned : null;
}

function nullableNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function nullableInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : null;
}

function memberOf<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T[number] : null;
}

function uniqueTextArray(value: unknown, maximumItems = 30): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    const cleaned = text(candidate, 100);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase("es-MX");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function normalizeCatalogProvenance(value: unknown): EquipmentCatalogProvenance[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((candidate) => {
    const source = record(candidate);
    const sourceType = source ? text(source.sourceType, 80) : null;
    const sourceName = source ? text(source.sourceName, 300) : null;
    const sourceUrl = source ? httpsUrl(source.sourceUrl) : null;
    const verifiedAt = source ? isoDate(source.verifiedAt) : null;
    if (!sourceType || !sourceName || !sourceUrl || !verifiedAt) return [];
    return [{
      sourceType,
      sourceName,
      sourceUrl,
      verifiedAt,
      license: text(source?.license, 100),
      confidence: text(source?.confidence, 40),
    }];
  });
  return [...new Map(normalized.map((source) => [`${source.sourceType}:${source.sourceUrl}:${source.verifiedAt}`, source])).values()];
}

function catalogProvenanceOrFallback(source: UnknownRecord, sourceName: string, verifiedAt: string, officialUrl: string | null) {
  const normalized = normalizeCatalogProvenance(source.provenance);
  if (normalized.length) return normalized;
  const sourceUrl = httpsUrl(source.sourceUrl) || officialUrl;
  if (!sourceUrl) return [];
  return [{
    sourceType: text(source.sourceType, 80) || "OEM_OFFICIAL",
    sourceName,
    sourceUrl,
    verifiedAt,
    license: text(source.license, 100),
    confidence: text(source.confidence, 40),
  }];
}

function httpsUrl(value: unknown): string | null {
  const cleaned = text(value, 2_048);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalTimestampFields(value: UnknownRecord) {
  return {
    createdAt: isoDate(value.createdAt),
    updatedAt: isoDate(value.updatedAt),
  };
}

export function normalizeGolfBallCatalog(value: unknown): GolfBallCatalog | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const brand = text(source.brand);
  const model = text(source.model);
  const active = boolean(source.active);
  const sourceName = text(source.sourceName);
  const verifiedAt = isoDate(source.verifiedAt);
  const createdAt = isoDate(source.createdAt);
  const updatedAt = isoDate(source.updatedAt);
  const compression = nullableNumber(source.compression, 1, 200);
  const compressionType = memberOf(source.compressionType, BALL_COMPRESSION_TYPES);
  const compressionSource = text(source.compressionSource, 300);
  const compressionSourceUrl = httpsUrl(source.compressionSourceUrl);
  const compressionIsSourced = compression === null
    ? compressionType === "UNKNOWN" && compressionSource === null && compressionSourceUrl === null
    : compressionType !== null && compressionType !== "UNKNOWN" && compressionSource !== null && compressionSourceUrl !== null;
  if (!id || !brand || !model || active === null || !sourceName || !verifiedAt || !createdAt || !updatedAt || !compressionType || !compressionIsSourced) return null;

  const technicalFacts = [source.flight, source.feel, source.driverSpin, source.ironSpin, source.shortGameSpin, source.coverMaterial, source.construction]
    .filter((candidate) => candidate !== null && candidate !== undefined && candidate !== "").length;
  const explicitFitEligible = boolean(source.fitEligible);
  const officialUrl = httpsUrl(source.officialUrl);

  return {
    id,
    aliases: uniqueTextArray(source.aliases, 50),
    brand,
    model,
    generation: text(source.generation),
    year: nullableInteger(source.year, 1900, 2200),
    active,
    bagEligible: boolean(source.bagEligible) ?? true,
    fitEligible: explicitFitEligible === null ? technicalFacts >= 3 : explicitFitEligible && technicalFacts >= 3,
    coverMaterial: text(source.coverMaterial),
    construction: text(source.construction),
    constructionPieces: nullableInteger(source.constructionPieces, 1, 8),
    compression,
    compressionType,
    compressionSource,
    compressionSourceUrl,
    flight: memberOf(source.flight, QUALITATIVE_LEVELS),
    driverSpin: memberOf(source.driverSpin, QUALITATIVE_LEVELS),
    ironSpin: memberOf(source.ironSpin, QUALITATIVE_LEVELS),
    shortGameSpin: memberOf(source.shortGameSpin, QUALITATIVE_LEVELS),
    feel: memberOf(source.feel, QUALITATIVE_LEVELS),
    colors: uniqueTextArray(source.colors, 12),
    priceTier: memberOf(source.priceTier, BALL_PRICE_TIERS),
    targetProfile: uniqueTextArray(source.targetProfile),
    officialUrl,
    sourceName,
    sourceUrl: httpsUrl(source.sourceUrl) || httpsUrl(source.officialUrl),
    sourceType: text(source.sourceType, 80),
    confidence: text(source.confidence, 40),
    license: text(source.license, 100),
    provenance: catalogProvenanceOrFallback(source, sourceName, verifiedAt, officialUrl),
    verifiedAt,
    createdAt,
    updatedAt,
  };
}

function catalogModels(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const source = record(value);
  return source && Array.isArray(source.models) ? source.models : [];
}

export function normalizeGolfBallCatalogEntries(value: unknown): GolfBallCatalog[] {
  return catalogModels(value).flatMap((candidate) => {
    const ball = normalizeGolfBallCatalog(candidate);
    return ball ? [ball] : [];
  });
}

function normalizeHandednessList(value: unknown): ClubHandedness[] {
  if (value === "BOTH") return ["RH", "LH"];
  const values = Array.isArray(value) ? value : [value];
  return CLUB_HANDEDNESS.filter((hand) => values.includes(hand));
}

function uniqueNumbers(value: unknown, minimum: number, maximum: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((candidate) => nullableNumber(candidate, minimum, maximum)).filter((candidate): candidate is number => candidate !== null))]
    .sort((left, right) => left - right);
}

function normalizeGolfClubVariants(value: unknown): GolfClubCatalogVariant[] {
  if (!Array.isArray(value)) return [];
  const variants = value.flatMap((candidate) => {
    const source = record(candidate);
    const loft = source ? nullableNumber(source.loft, 0, 90) : null;
    const handedness = source ? normalizeHandednessList(source.handedness) : [];
    return loft !== null && handedness.length ? [{ loft, handedness }] : [];
  });
  return [...new Map(variants.map((variant) => [`${variant.loft}:${variant.handedness.join(",")}`, variant])).values()];
}

export function normalizeGolfClubCatalog(value: unknown): GolfClubCatalog | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const brand = text(source.brand);
  const model = text(source.model);
  const category = memberOf(source.category, CLUB_CATEGORIES);
  const active = boolean(source.active);
  const handedness = normalizeHandednessList(source.handedness);
  const verifiedAt = isoDate(source.verifiedAt);
  if (!id || !brand || !model || !category || active === null || !verifiedAt) return null;

  const officialUrl = httpsUrl(source.officialUrl);
  const sourceName = text(source.sourceName) || "Fuente de catálogo verificada";
  return {
    id,
    aliases: uniqueTextArray(source.aliases, 50),
    externalId: identifier(source.externalId),
    brand,
    model,
    generation: text(source.generation),
    year: nullableInteger(source.year, 1900, 2200),
    category,
    subCategory: text(source.subCategory),
    active,
    bagEligible: boolean(source.bagEligible) ?? true,
    fitEligible: boolean(source.fitEligible) ?? false,
    handedness,
    lofts: uniqueNumbers(source.lofts, 0, 90),
    variants: normalizeGolfClubVariants(source.variants),
    standardLength: nullableNumber(source.standardLength, 10, 60),
    lie: nullableNumber(source.lie, 30, 90),
    headVolume: nullableNumber(source.headVolume, 1, 1_000),
    setMakeup: text(source.setMakeup, 500),
    stockShafts: uniqueTextArray(source.stockShafts, 50),
    stockFlexes: SHAFT_FLEXES.filter((candidate) => Array.isArray(source.stockFlexes) && source.stockFlexes.includes(candidate)),
    officialUrl,
    sourceName: text(source.sourceName),
    sourceUrl: httpsUrl(source.sourceUrl),
    sourceCheckedAt: isoDate(source.sourceCheckedAt),
    sourceType: text(source.sourceType, 80),
    confidence: text(source.confidence, 40),
    license: text(source.license, 100),
    provenance: catalogProvenanceOrFallback(source, sourceName, verifiedAt, officialUrl),
    verifiedAt,
    ...optionalTimestampFields(source),
  };
}

export function normalizeGolfClubCatalogEntries(value: unknown): GolfClubCatalog[] {
  return catalogModels(value).flatMap((candidate) => {
    const club = normalizeGolfClubCatalog(candidate);
    return club ? [club] : [];
  });
}

export function normalizeGolfShaftCatalog(value: unknown): GolfShaftCatalog | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const brand = text(source.brand);
  const model = text(source.model);
  const active = boolean(source.active);
  if (!id || !brand || !model || active === null) return null;
  const aliases = uniqueTextArray(source.aliases, 50);
  const year = nullableInteger(source.year, 1900, 2200);
  const usage = memberOf(source.usage, SHAFT_USAGES);
  const oemStockOrAftermarket = memberOf(source.oemStockOrAftermarket, SHAFT_MARKET_TYPES);
  const weightOptions = uniqueNumbers(source.weightOptions, 1, 300);
  const flexOptions = uniqueTextArray(source.flexOptions, 40);
  const rawFlex = Array.isArray(source.flex) ? source.flex : [source.flex];
  const flexFromManufacturerLabels: Partial<Record<string, ShaftFlex>> = {
    L: "LADIES", A: "SENIOR", SR: "SENIOR", R2: "SENIOR", R1: "REGULAR",
    R: "REGULAR", S: "STIFF", X: "X_STIFF", TX: "TX",
  };
  const flex = SHAFT_FLEXES.filter((candidate) => rawFlex.includes(candidate)
    || flexOptions.some((label) => flexFromManufacturerLabels[label.toUpperCase()] === candidate));
  const legacyFlexOptions: Partial<Record<ShaftFlex, string>> = {
    LADIES: "L", SENIOR: "A", REGULAR: "R", STIFF: "S", X_STIFF: "X", TX: "TX",
  };
  const exactFlexOptions = flexOptions.length
    ? flexOptions
    : flex.flatMap((candidate) => legacyFlexOptions[candidate] ? [legacyFlexOptions[candidate] as string] : []);
  const launch = memberOf(source.launch, SHAFT_PROFILES);
  const spin = memberOf(source.spin, SHAFT_PROFILES);
  const torqueRange = uniqueNumbers(source.torqueRange, 0, 30).slice(0, 2);
  const weight = nullableNumber(source.weight, 1, 250) ?? (weightOptions.length === 1 ? weightOptions[0] : null);
  const torque = nullableNumber(source.torque, 0, 30) ?? (torqueRange.length === 1 ? torqueRange[0] : null);
  const officialUrl = httpsUrl(source.officialUrl);
  const sourceName = text(source.sourceName);
  const verifiedAt = isoDate(source.verifiedAt);
  const provenance = sourceName && verifiedAt
    ? catalogProvenanceOrFallback(source, sourceName, verifiedAt, officialUrl)
    : normalizeCatalogProvenance(source.provenance);
  const explicitFitEligible = boolean(source.fitEligible);
  const technicallyTraceable = weightOptions.length > 0
    && exactFlexOptions.length > 0
    && launch !== null
    && spin !== null
    && provenance.length > 0;

  return {
    id,
    aliases,
    brand,
    model,
    generation: text(source.generation),
    year,
    usage,
    active,
    bagEligible: boolean(source.bagEligible) ?? true,
    fitEligible: explicitFitEligible === true && technicallyTraceable,
    oemStockOrAftermarket,
    weightOptions: weightOptions.length ? weightOptions : weight === null ? [] : [weight],
    flexOptions: exactFlexOptions,
    weight,
    flex,
    launch,
    spin,
    material: text(source.material),
    torqueRange: torqueRange.length ? torqueRange : torque === null ? [] : [torque],
    torque,
    tipDiameter: nullableNumber(source.tipDiameter, 0.1, 2),
    buttDiameter: nullableNumber(source.buttDiameter, 0.1, 2),
    officialUrl,
    sourceName,
    sourceUrl: httpsUrl(source.sourceUrl) || officialUrl,
    sourceType: text(source.sourceType, 80),
    confidence: text(source.confidence, 40),
    license: text(source.license, 100),
    provenance,
    verifiedAt,
    ...optionalTimestampFields(source),
  };
}

export function normalizeGolfShaftCatalogEntries(value: unknown): GolfShaftCatalog[] {
  return catalogModels(value).flatMap((candidate) => {
    const shaft = normalizeGolfShaftCatalog(candidate);
    return shaft ? [shaft] : [];
  });
}

function normalizeSetComposition(value: unknown): string[] {
  const normalized = uniqueTextArray(value, 20).map((club) => club.toUpperCase());
  return normalized.filter((club) => SET_COMPOSITION.has(club));
}

export function normalizePlayerClub(value: unknown, expectedUserId?: string): PlayerClub | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const userId = identifier(source.userId);
  const category = memberOf(source.category, CLUB_CATEGORIES);
  const catalogClubId = identifier(source.catalogClubId);
  const customBrand = text(source.customBrand);
  const customModel = text(source.customModel);
  const handedness = memberOf(source.handedness, CLUB_HANDEDNESS);
  const createdAt = isoDate(source.createdAt);
  const updatedAt = isoDate(source.updatedAt);
  const isCurrent = boolean(source.isCurrent);
  const hasClubIdentity = Boolean(catalogClubId || (customBrand && customModel));
  if (!id || !userId || (expectedUserId && userId !== expectedUserId) || !category || !handedness || !createdAt || !updatedAt || isCurrent === null || !hasClubIdentity) return null;

  return {
    id,
    userId,
    category,
    catalogClubId,
    customBrand,
    customModel,
    generation: text(source.generation),
    year: nullableInteger(source.year, 1900, 2200),
    loft: nullableNumber(source.loft, 0, 90),
    handedness,
    shaftId: identifier(source.shaftId),
    customShaftBrand: text(source.customShaftBrand),
    customShaftModel: text(source.customShaftModel),
    customShaft: text(source.customShaft),
    flex: memberOf(source.flex, SHAFT_FLEXES),
    shaftFlexLabel: text(source.shaftFlexLabel, 40),
    shaftWeightGrams: nullableNumber(source.shaftWeightGrams, 1, 300),
    lengthInches: nullableNumber(source.lengthInches, 10, 60),
    lieDegrees: nullableNumber(source.lieDegrees, 30, 90),
    grip: text(source.grip),
    notes: text(source.notes, 1_000),
    setComposition: category === "IRON_SET" ? normalizeSetComposition(source.setComposition) : [],
    isCurrent,
    startedUsingAt: isoDate(source.startedUsingAt),
    stoppedUsingAt: isCurrent ? null : isoDate(source.stoppedUsingAt),
    createdAt,
    updatedAt,
  };
}

export function normalizePlayerBall(value: unknown, expectedUserId?: string): PlayerBall | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const userId = identifier(source.userId);
  const ballBrand = text(source.ballBrand);
  const ballModel = text(source.ballModel);
  const isCurrent = boolean(source.isCurrent);
  const createdAt = isoDate(source.createdAt);
  const updatedAt = isoDate(source.updatedAt);
  if (!id || !userId || (expectedUserId && userId !== expectedUserId) || !ballBrand || !ballModel || isCurrent === null || !createdAt || !updatedAt) return null;

  return {
    id,
    userId,
    catalogBallId: identifier(source.catalogBallId),
    ballBrand,
    ballModel,
    generation: text(source.generation),
    year: nullableInteger(source.year, 1900, 2200),
    color: text(source.color),
    notes: text(source.notes, 1_000),
    isCurrent,
    startedUsingAt: isoDate(source.startedUsingAt),
    stoppedUsingAt: isCurrent ? null : isoDate(source.stoppedUsingAt),
    createdAt,
    updatedAt,
  };
}

export function normalizePlayerClubDistance(value: unknown, expectedUserId?: string): PlayerClubDistance | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const userId = identifier(source.userId);
  const playerClubId = identifier(source.playerClubId);
  const carryDistance = nullableNumber(source.carryDistance, 0, 800);
  const totalDistance = nullableNumber(source.totalDistance, 0, 800);
  const carryWasProvided = source.carryDistance !== null && source.carryDistance !== undefined;
  const totalWasProvided = source.totalDistance !== null && source.totalDistance !== undefined;
  const unit = memberOf(source.unit, CLUB_DISTANCE_UNITS);
  const distanceSource = memberOf(source.source, CLUB_DISTANCE_SOURCES);
  const sampleCount = source.sampleCount === null || source.sampleCount === undefined
    ? null
    : nullableInteger(source.sampleCount, 1, 1_000_000);
  const confidence = source.confidence === null || source.confidence === undefined
    ? null
    : nullableNumber(source.confidence, 0, 100);
  const updatedAt = isoDate(source.updatedAt);
  if (!id || !userId || (expectedUserId && userId !== expectedUserId) || !playerClubId
    || (carryDistance === null && totalDistance === null) || !unit || !distanceSource
    || (carryWasProvided && carryDistance === null) || (totalWasProvided && totalDistance === null)
    || (carryDistance !== null && totalDistance !== null && totalDistance < carryDistance)
    || (source.sampleCount !== null && source.sampleCount !== undefined && sampleCount === null)
    || (source.confidence !== null && source.confidence !== undefined && confidence === null)
    || !updatedAt) return null;
  return {
    id,
    userId,
    playerClubId,
    carryDistance,
    totalDistance,
    unit,
    source: distanceSource,
    sampleCount,
    confidence,
    updatedAt,
  };
}

const SAVED_FIT_SWING_SPEEDS = ["UNDER_85", "FROM_85_TO_95", "FROM_95_TO_105", "OVER_105", "UNKNOWN"] as const;
const SAVED_FIT_FEELS = ["VERY_SOFT", "SOFT", "MEDIUM", "FIRM", "VERY_FIRM", "ANY"] as const;
const SAVED_FIT_TRAJECTORIES = ["LOW", "MID", "HIGH", "UNKNOWN"] as const;
const SAVED_FIT_GREENS = ["SOFT", "MEDIUM", "FIRM", "VARIES_UNKNOWN"] as const;
const SAVED_FIT_PRIORITIES = ["DRIVER_DISTANCE", "LESS_DRIVER_SPIN", "STABILITY_CONTROL", "HEIGHT", "IRON_CONTROL", "STOP_ON_GREEN", "WEDGE_SPIN", "GREENSIDE_FEEL", "PUTTER_FEEL"] as const;
const SAVED_FIT_APPROACH = ["ROLLS_TOO_MUCH", "STOPS_WELL", "TOO_MUCH_BACKSPIN", "UNKNOWN"] as const;
const SAVED_FIT_YES_NO = ["YES", "NO", "UNKNOWN"] as const;
const SAVED_FIT_PRICE = ["BEST_FIT", "PREMIUM", "MID", "ECONOMY"] as const;
const SAVED_FIT_COLORS = ["WHITE", "YELLOW", "OTHER", "ANY"] as const;

function normalizeBallFitInputSnapshot(value: unknown, expectedUserId: string): EquipmentBallFitInputSnapshot | null {
  const source = record(value);
  const userId = source ? identifier(source.userId) : null;
  const swingSpeedBand = source ? memberOf(source.swingSpeedBand, SAVED_FIT_SWING_SPEEDS) : null;
  const feelPreference = source ? memberOf(source.feelPreference, SAVED_FIT_FEELS) : null;
  const trajectoryPreference = source ? memberOf(source.trajectoryPreference, SAVED_FIT_TRAJECTORIES) : null;
  const greenFirmness = source ? memberOf(source.greenFirmness, SAVED_FIT_GREENS) : null;
  const approachBehavior = source ? memberOf(source.approachBehavior, SAVED_FIT_APPROACH) : null;
  const wantsGreensideSpin = source ? memberOf(source.wantsGreensideSpin, SAVED_FIT_YES_NO) : null;
  const pricePreference = source ? memberOf(source.pricePreference, SAVED_FIT_PRICE) : null;
  const colorPreference = source ? memberOf(source.colorPreference, SAVED_FIT_COLORS) : null;
  if (!source || userId !== expectedUserId || !swingSpeedBand || !feelPreference || !trajectoryPreference || !greenFirmness || !approachBehavior || !wantsGreensideSpin || !pricePreference || !colorPreference) return null;
  const launchMonitorSession = source.launchMonitorSession === null || source.launchMonitorSession === undefined
    ? null
    : normalizeLaunchMonitorSession(source.launchMonitorSession, expectedUserId);
  if (source.launchMonitorSession !== null && source.launchMonitorSession !== undefined && !launchMonitorSession) return null;
  const rawPriorities: unknown[] = Array.isArray(source.priorities) ? source.priorities : [];
  const priorities = SAVED_FIT_PRIORITIES.filter((priority) => rawPriorities.includes(priority));
  return {
    userId,
    currentBallId: identifier(source.currentBallId),
    handicap: nullableNumber(source.handicap, -20, 54),
    typicalScore: nullableNumber(source.typicalScore, 40, 200),
    driverDistanceYards: nullableNumber(source.driverDistanceYards, 50, 500),
    swingSpeedBand,
    feelPreference,
    trajectoryPreference,
    greenFirmness,
    priorities,
    approachBehavior,
    wantsGreensideSpin,
    pricePreference,
    colorPreference,
    launchMonitorSession,
  };
}

function normalizeBallFitSummary(value: unknown, expectedUserId: string): EquipmentBallFitSummary | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const completedAt = isoDate(source.completedAt);
  const inputCompleteness = nullableNumber(source.inputCompleteness, 0, 100);
  if (!id || !completedAt || inputCompleteness === null || !Array.isArray(source.recommendations)) return null;
  const recommendations = source.recommendations.slice(0, 3).flatMap((candidate) => {
    const item = record(candidate);
    const catalogBallId = item ? identifier(item.catalogBallId) : null;
    const matchScore = item ? nullableNumber(item.matchScore, 0, 100) : null;
    if (!item || !catalogBallId || matchScore === null) return [];
    const attributes = record(item.attributes);
    return [{
      catalogBallId,
      matchScore: Math.round(matchScore),
      brand: text(item.brand),
      model: text(item.model),
      generation: text(item.generation),
      dataCoverage: nullableNumber(item.dataCoverage, 0, 100),
      why: uniqueTextArray(item.why, 8),
      attributes: attributes ? {
        flight: memberOf(attributes.flight, QUALITATIVE_LEVELS),
        feel: memberOf(attributes.feel, QUALITATIVE_LEVELS),
        driverSpin: memberOf(attributes.driverSpin, QUALITATIVE_LEVELS),
        ironSpin: memberOf(attributes.ironSpin, QUALITATIVE_LEVELS),
        shortGameSpin: memberOf(attributes.shortGameSpin, QUALITATIVE_LEVELS),
        priceTier: memberOf(attributes.priceTier, BALL_PRICE_TIERS),
      } : null,
      comparisonToCurrent: uniqueTextArray(item.comparisonToCurrent, 6),
    }];
  });
  return {
    id,
    completedAt,
    currentBallId: identifier(source.currentBallId),
    inputCompleteness,
    algorithmVersion: text(source.algorithmVersion, 80),
    status: memberOf(source.status, ["COMPLETE", "PARTIAL"] as const),
    input: normalizeBallFitInputSnapshot(source.input, expectedUserId),
    recommendations,
    warnings: uniqueTextArray(source.warnings, 12),
  };
}

function latestFirst<T extends { id: string; updatedAt: string }>(items: T[]): T[] {
  const newest = new Map<string, T>();
  for (const item of items) {
    const existing = newest.get(item.id);
    if (!existing || Date.parse(item.updatedAt) >= Date.parse(existing.updatedAt)) newest.set(item.id, item);
  }
  return [...newest.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function normalizeEquipmentProfile(value: unknown, expectedUserId?: string): EquipmentProfile | null {
  const source = record(value);
  if (!source || (source.schemaVersion !== 1 && source.schemaVersion !== EQUIPMENT_PROFILE_SCHEMA_VERSION)) return null;
  const userId = identifier(source.userId);
  const equipmentOnboarding = memberOf(source.equipmentOnboarding, ["NOT_ASKED", "SKIPPED", "IN_PROGRESS", "COMPLETED"] as const);
  const ballOnboarding = memberOf(source.ballOnboarding, ["NOT_ASKED", "SKIPPED", "IN_PROGRESS", "COMPLETED"] as const);
  let ballPreference = memberOf(source.ballPreference, ["NOT_ASKED", "FIXED", "NO_FIXED_BALL", "SKIPPED"] as const);
  const createdAt = isoDate(source.createdAt);
  const updatedAt = isoDate(source.updatedAt);
  if (!userId || (expectedUserId && userId !== expectedUserId) || !equipmentOnboarding || !ballOnboarding || !ballPreference || !createdAt || !updatedAt) return null;

  const clubs = latestFirst((Array.isArray(source.clubs) ? source.clubs : []).flatMap((candidate) => {
    const club = normalizePlayerClub(candidate, userId);
    return club ? [club] : [];
  }));
  let balls = latestFirst((Array.isArray(source.balls) ? source.balls : []).flatMap((candidate) => {
    const ball = normalizePlayerBall(candidate, userId);
    return ball ? [ball] : [];
  }));
  const clubIds = new Set(clubs.map((club) => club.id));
  const distances = latestFirst((Array.isArray(source.distances) ? source.distances : []).flatMap((candidate) => {
    const distance = normalizePlayerClubDistance(candidate, userId);
    return distance && clubIds.has(distance.playerClubId) ? [distance] : [];
  }));

  if (ballPreference === "FIXED") {
    const current = balls.find((ball) => ball.isCurrent);
    if (!current) ballPreference = "NOT_ASKED";
    else balls = balls.map((ball) => ({ ...ball, isCurrent: ball.id === current.id }));
  } else {
    balls = balls.map((ball) => ball.isCurrent ? { ...ball, isCurrent: false } : ball);
  }

  return {
    schemaVersion: EQUIPMENT_PROFILE_SCHEMA_VERSION,
    userId,
    equipmentOnboarding,
    ballOnboarding,
    ballPreference,
    clubs,
    balls,
    distances,
    lastBallFit: normalizeBallFitSummary(source.lastBallFit, userId),
    createdAt,
    updatedAt,
  };
}

/** Cloud writes reject lossy normalization. Local reads remain tolerant so a
 * newer optional field never bricks an older PWA, while the server boundary
 * refuses malformed, duplicated or oversized entity collections. */
export function normalizeEquipmentProfileStrict(value: unknown, expectedUserId: string): EquipmentProfile | null {
  const source = record(value);
  const normalized = normalizeEquipmentProfile(value, expectedUserId);
  if (!source || source.schemaVersion !== EQUIPMENT_PROFILE_SCHEMA_VERSION || !normalized
    || !Array.isArray(source.clubs) || !Array.isArray(source.balls) || !Array.isArray(source.distances)) return null;
  if (source.clubs.length !== normalized.clubs.length || source.balls.length !== normalized.balls.length
    || source.distances.length !== normalized.distances.length) return null;
  if (source.lastBallFit !== null && source.lastBallFit !== undefined) {
    const rawFit = record(source.lastBallFit);
    if (!rawFit || !normalized.lastBallFit?.input || !Array.isArray(rawFit.recommendations)
      || rawFit.recommendations.length !== normalized.lastBallFit.recommendations.length) return null;
    const rawInput = record(rawFit.input);
    const rawLaunch = rawInput ? record(rawInput.launchMonitorSession) : null;
    const rawShots = rawLaunch && Array.isArray(rawLaunch.shots) ? rawLaunch.shots : [];
    const normalizedShots = normalized.lastBallFit.input.launchMonitorSession?.shots || [];
    if (rawShots.length !== normalizedShots.length) return null;
  }
  // The cloud boundary accepts only the canonical contract produced by this
  // module. Sorting object keys avoids rejecting harmless JSON key order while
  // still rejecting truncation, coerced enums, unknown fields or inserted
  // defaults that could otherwise make a write silently lossy.
  const canonicalJson = (candidate: unknown): string => {
    const visit = (entry: unknown): unknown => {
      if (Array.isArray(entry)) return entry.map(visit);
      const object = record(entry);
      if (!object) return entry;
      return Object.fromEntries(Object.keys(object).sort().flatMap((key) => (
        object[key] === undefined ? [] : [[key, visit(object[key])]]
      )));
    };
    return JSON.stringify(visit(candidate));
  };
  return canonicalJson(source) === canonicalJson(normalized) ? normalized : null;
}

export function createEmptyEquipmentProfile(userIdValue: string, now = new Date().toISOString()): EquipmentProfile | null {
  const userId = identifier(userIdValue);
  const timestamp = isoDate(now);
  if (!userId || !timestamp) return null;
  return {
    schemaVersion: EQUIPMENT_PROFILE_SCHEMA_VERSION,
    userId,
    equipmentOnboarding: "NOT_ASKED",
    ballOnboarding: "NOT_ASKED",
    ballPreference: "NOT_ASKED",
    clubs: [],
    balls: [],
    distances: [],
    lastBallFit: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Stable semantic identity for the local-first aggregate. Audit-only
 * `updatedAt` changes are intentionally ignored so React re-renders and
 * equivalent editor submissions cannot enqueue duplicate cloud mutations.
 */
export function equipmentProfileFingerprint(value: unknown, expectedUserId?: string): string | null {
  const profile = normalizeEquipmentProfile(value, expectedUserId);
  if (!profile) return null;
  const canonicalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonicalize);
    const source = record(candidate);
    if (!source) return candidate;
    return Object.fromEntries(Object.keys(source)
      .filter((key) => key !== "updatedAt")
      .sort()
      .map((key) => [key, canonicalize(source[key])]));
  };
  return JSON.stringify(canonicalize({
    ...profile,
    clubs: [...profile.clubs].sort((left, right) => left.id.localeCompare(right.id)),
    balls: [...profile.balls].sort((left, right) => left.id.localeCompare(right.id)),
    distances: [...profile.distances].sort((left, right) => left.id.localeCompare(right.id)),
  }));
}

function sameEquipmentProfile(left: EquipmentProfile, right: EquipmentProfile) {
  return equipmentProfileFingerprint(left, left.userId) === equipmentProfileFingerprint(right, left.userId);
}

export function setEquipmentOnboardingStatus(profile: EquipmentProfile, status: OptionalOnboardingStatus, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  if (!validProfile || !memberOf(status, ["NOT_ASKED", "SKIPPED", "IN_PROGRESS", "COMPLETED"] as const)) return null;
  if (validProfile.equipmentOnboarding === status) return validProfile;
  return withUpdatedAt({ ...validProfile, equipmentOnboarding: status }, now);
}

export function setBallOnboardingStatus(profile: EquipmentProfile, status: OptionalOnboardingStatus, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  if (!validProfile || !memberOf(status, ["NOT_ASKED", "SKIPPED", "IN_PROGRESS", "COMPLETED"] as const)) return null;
  if (validProfile.ballOnboarding === status) return validProfile;
  return withUpdatedAt({ ...validProfile, ballOnboarding: status }, now);
}

export function setLastBallFit(profile: EquipmentProfile, summaryValue: unknown, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const summary = normalizeBallFitSummary(summaryValue, profile.userId);
  if (!validProfile || !summary) return null;
  const next = { ...validProfile, lastBallFit: summary };
  return sameEquipmentProfile(validProfile, next) ? validProfile : withUpdatedAt(next, now);
}

export function clearLastBallFit(profile: EquipmentProfile, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  if (!validProfile || validProfile.lastBallFit === null) return validProfile;
  return withUpdatedAt({ ...validProfile, lastBallFit: null }, now);
}

function withUpdatedAt(profile: EquipmentProfile, now: string): EquipmentProfile | null {
  const updatedAt = isoDate(now);
  return updatedAt ? { ...profile, updatedAt } : null;
}

export function upsertPlayerClub(profile: EquipmentProfile, value: unknown, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const normalizedClub = normalizePlayerClub(value, profile.userId);
  const timestamp = isoDate(now);
  if (!validProfile || !normalizedClub || !timestamp) return null;
  const existing = validProfile.clubs.find((item) => item.id === normalizedClub.id);
  const club: PlayerClub = {
    ...normalizedClub,
    startedUsingAt: normalizedClub.isCurrent
      ? normalizedClub.startedUsingAt || existing?.startedUsingAt || normalizedClub.createdAt
      : normalizedClub.startedUsingAt || existing?.startedUsingAt || null,
    stoppedUsingAt: normalizedClub.isCurrent
      ? null
      : normalizedClub.stoppedUsingAt || existing?.stoppedUsingAt || timestamp,
  };
  const next = { ...validProfile, clubs: latestFirst([...validProfile.clubs.filter((item) => item.id !== club.id), club]) };
  return sameEquipmentProfile(validProfile, next) ? validProfile : withUpdatedAt(next, timestamp);
}

export function removePlayerClub(profile: EquipmentProfile, clubIdValue: string, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const clubId = identifier(clubIdValue);
  if (!validProfile || !clubId) return null;
  if (!validProfile.clubs.some((club) => club.id === clubId)) return validProfile;
  return withUpdatedAt({
    ...validProfile,
    clubs: validProfile.clubs.filter((club) => club.id !== clubId),
    distances: validProfile.distances.filter((distance) => distance.playerClubId !== clubId),
  }, now);
}

export function setPlayerClubCurrent(profile: EquipmentProfile, clubIdValue: string, isCurrent: boolean, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const clubId = identifier(clubIdValue);
  if (!validProfile || !clubId || !validProfile.clubs.some((club) => club.id === clubId)) return null;
  const timestamp = isoDate(now);
  if (!timestamp) return null;
  const selected = validProfile.clubs.find((club) => club.id === clubId)!;
  if (selected.isCurrent === isCurrent) return validProfile;
  return withUpdatedAt({
    ...validProfile,
    clubs: validProfile.clubs.map((club) => club.id === clubId ? {
      ...club,
      isCurrent,
      startedUsingAt: isCurrent ? club.startedUsingAt || timestamp : club.startedUsingAt,
      stoppedUsingAt: isCurrent ? null : timestamp,
      updatedAt: timestamp,
    } : club),
  }, timestamp);
}

/** Archives the current physical club before adding a different model. Specs,
 * shaft and notes for the same model continue to update the existing row. */
export function replaceCurrentPlayerClub(
  profile: EquipmentProfile,
  previousClubIdValue: string,
  replacementValue: unknown,
  now = new Date().toISOString(),
): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const previousClubId = identifier(previousClubIdValue);
  const replacement = normalizePlayerClub(replacementValue, profile.userId);
  const timestamp = isoDate(now);
  const previous = validProfile?.clubs.find((club) => club.id === previousClubId);
  if (!validProfile || !previousClubId || !replacement || !timestamp || !previous?.isCurrent
    || replacement.id === previous.id || !replacement.isCurrent) return null;
  const archived = setPlayerClubCurrent(validProfile, previous.id, false, timestamp);
  return archived ? upsertPlayerClub(archived, {
    ...replacement,
    startedUsingAt: timestamp,
    stoppedUsingAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }, timestamp) : null;
}

export function upsertPlayerBall(profile: EquipmentProfile, value: unknown, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const normalizedBall = normalizePlayerBall(value, profile.userId);
  const timestamp = isoDate(now);
  if (!validProfile || !normalizedBall || !timestamp) return null;
  const existing = validProfile.balls.find((item) => item.id === normalizedBall.id);
  const ball: PlayerBall = {
    ...normalizedBall,
    startedUsingAt: normalizedBall.isCurrent
      ? normalizedBall.startedUsingAt || existing?.startedUsingAt || normalizedBall.createdAt
      : normalizedBall.startedUsingAt || existing?.startedUsingAt || null,
    stoppedUsingAt: normalizedBall.isCurrent
      ? null
      : normalizedBall.stoppedUsingAt || existing?.stoppedUsingAt || timestamp,
  };
  let balls = latestFirst([...validProfile.balls.filter((item) => item.id !== ball.id), ball]);
  if (ball.isCurrent) balls = balls.map((item) => item.id === ball.id ? item : item.isCurrent ? {
    ...item,
    isCurrent: false,
    stoppedUsingAt: timestamp,
    updatedAt: timestamp,
  } : item);
  const ballPreference = ball.isCurrent
    ? "FIXED"
    : validProfile.ballPreference === "FIXED" && !balls.some((item) => item.isCurrent)
      ? "NOT_ASKED"
      : validProfile.ballPreference;
  const next = { ...validProfile, balls, ballPreference };
  return sameEquipmentProfile(validProfile, next) ? validProfile : withUpdatedAt(next, timestamp);
}

/** Preserves ball history when an edit selects a different catalog/manual
 * model. A color or notes-only edit keeps the original player-ball identity. */
export function replaceCurrentPlayerBall(
  profile: EquipmentProfile,
  previousBallIdValue: string,
  replacementValue: unknown,
  now = new Date().toISOString(),
): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const previousBallId = identifier(previousBallIdValue);
  const replacement = normalizePlayerBall(replacementValue, profile.userId);
  const timestamp = isoDate(now);
  const previous = validProfile?.balls.find((ball) => ball.id === previousBallId);
  if (!validProfile || !previousBallId || !replacement || !timestamp || !previous?.isCurrent
    || replacement.id === previous.id || !replacement.isCurrent) return null;
  return upsertPlayerBall(validProfile, {
    ...replacement,
    startedUsingAt: timestamp,
    stoppedUsingAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }, timestamp);
}

export function removePlayerBall(profile: EquipmentProfile, ballIdValue: string, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const ballId = identifier(ballIdValue);
  if (!validProfile || !ballId) return null;
  if (!validProfile.balls.some((ball) => ball.id === ballId)) return validProfile;
  const balls = validProfile.balls.filter((ball) => ball.id !== ballId);
  const ballPreference = validProfile.ballPreference === "FIXED" && !balls.some((ball) => ball.isCurrent)
    ? "NOT_ASKED"
    : validProfile.ballPreference;
  return withUpdatedAt({ ...validProfile, balls, ballPreference }, now);
}

export function setCurrentPlayerBall(profile: EquipmentProfile, ballIdValue: string, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const ballId = identifier(ballIdValue);
  if (!validProfile || !ballId || !validProfile.balls.some((ball) => ball.id === ballId)) return null;
  const updatedAt = isoDate(now);
  if (!updatedAt) return null;
  const current = validProfile.balls.find((ball) => ball.isCurrent);
  if (current?.id === ballId && validProfile.ballPreference === "FIXED") return validProfile;
  return {
    ...validProfile,
    balls: validProfile.balls.map((ball) => ball.id === ballId ? {
      ...ball,
      isCurrent: true,
      startedUsingAt: ball.startedUsingAt || updatedAt,
      stoppedUsingAt: null,
      updatedAt,
    } : ball.isCurrent ? {
      ...ball,
      isCurrent: false,
      stoppedUsingAt: updatedAt,
      updatedAt,
    } : ball),
    ballPreference: "FIXED",
    updatedAt,
  };
}

export function setBallPreference(profile: EquipmentProfile, preference: BallPreference, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  if (!validProfile || !memberOf(preference, ["NOT_ASKED", "FIXED", "NO_FIXED_BALL", "SKIPPED"] as const)) return null;
  if (preference === "FIXED" && !validProfile.balls.some((ball) => ball.isCurrent)) return null;
  if (validProfile.ballPreference === preference
    && (preference === "FIXED" || !validProfile.balls.some((ball) => ball.isCurrent))) return validProfile;
  const timestamp = isoDate(now);
  if (!timestamp) return null;
  return withUpdatedAt({
    ...validProfile,
    ballPreference: preference,
    balls: preference === "FIXED" ? validProfile.balls : validProfile.balls.map((ball) => ball.isCurrent ? {
      ...ball,
      isCurrent: false,
      stoppedUsingAt: timestamp,
      updatedAt: timestamp,
    } : ball),
  }, timestamp);
}

export function upsertPlayerClubDistance(profile: EquipmentProfile, value: unknown, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const distance = normalizePlayerClubDistance(value, profile.userId);
  if (!validProfile || !distance || !validProfile.clubs.some((club) => club.id === distance.playerClubId)) return null;
  const next = {
    ...validProfile,
    distances: latestFirst([...validProfile.distances.filter((item) => item.id !== distance.id), distance]),
  };
  return sameEquipmentProfile(validProfile, next) ? validProfile : withUpdatedAt(next, now);
}

export function removePlayerClubDistance(profile: EquipmentProfile, distanceIdValue: string, now = new Date().toISOString()): EquipmentProfile | null {
  const validProfile = normalizeEquipmentProfile(profile, profile.userId);
  const distanceId = identifier(distanceIdValue);
  if (!validProfile || !distanceId) return null;
  if (!validProfile.distances.some((distance) => distance.id === distanceId)) return validProfile;
  return withUpdatedAt({
    ...validProfile,
    distances: validProfile.distances.filter((distance) => distance.id !== distanceId),
  }, now);
}

export function equipmentProfileStorageKey(userIdValue: string): string | null {
  const userId = identifier(userIdValue);
  return userId ? `the-backyard:equipment-profile:v${EQUIPMENT_PROFILE_STORAGE_VERSION}:${encodeURIComponent(userId)}` : null;
}

export function equipmentProfileRecoveryStorageKey(userIdValue: string): string | null {
  const profileKey = equipmentProfileStorageKey(userIdValue);
  return profileKey ? `${profileKey}:recovery` : null;
}

export function encodeEquipmentProfile(profile: EquipmentProfile, savedAt = new Date().toISOString()): string | null {
  const normalized = normalizeEquipmentProfile(profile, profile.userId);
  const timestamp = isoDate(savedAt);
  if (!normalized || !timestamp) return null;
  return JSON.stringify({
    schema: "the-backyard-equipment-profile",
    version: EQUIPMENT_PROFILE_STORAGE_VERSION,
    userId: normalized.userId,
    savedAt: timestamp,
    profile: normalized,
  });
}

export function decodeEquipmentProfile(serialized: string, expectedUserId: string): EquipmentProfile | null {
  const userId = identifier(expectedUserId);
  if (!userId || typeof serialized !== "string" || !serialized.trim()) return null;
  try {
    const envelope = record(JSON.parse(serialized));
    if (!envelope
      || envelope.schema !== "the-backyard-equipment-profile"
      || envelope.version !== EQUIPMENT_PROFILE_STORAGE_VERSION
      || envelope.userId !== userId
      || !isoDate(envelope.savedAt)) return null;
    return normalizeEquipmentProfile(envelope.profile, userId);
  } catch {
    return null;
  }
}

export function loadEquipmentProfile(storage: EquipmentStorageLike, userIdValue: string): EquipmentStorageResult {
  const key = equipmentProfileStorageKey(userIdValue);
  if (!key) return { ok: false, code: "INVALID_USER", message: "La identidad de la cuenta no es válida." };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { ok: true, profile: null };
    const profile = decodeEquipmentProfile(raw, userIdValue);
    return profile
      ? { ok: true, profile }
      : { ok: false, code: "INVALID_PROFILE", message: "El perfil de equipo guardado no es válido." };
  } catch {
    return { ok: false, code: "READ_FAILED", message: "No pudimos leer el perfil de equipo en este dispositivo." };
  }
}

export function saveEquipmentProfile(storage: EquipmentStorageLike, profile: EquipmentProfile, savedAt = new Date().toISOString()): EquipmentStorageResult {
  const key = equipmentProfileStorageKey(profile.userId);
  const serialized = encodeEquipmentProfile(profile, savedAt);
  if (!key || !serialized) return { ok: false, code: "INVALID_PROFILE", message: "El perfil de equipo no es válido." };
  try {
    storage.setItem(key, serialized);
    return { ok: true, profile: normalizeEquipmentProfile(profile, profile.userId) };
  } catch {
    return { ok: false, code: "WRITE_FAILED", message: "No pudimos guardar el perfil de equipo en este dispositivo." };
  }
}

export function removeEquipmentProfile(storage: EquipmentStorageLike, userIdValue: string): EquipmentStorageResult {
  const key = equipmentProfileStorageKey(userIdValue);
  if (!key) return { ok: false, code: "INVALID_USER", message: "La identidad de la cuenta no es válida." };
  try {
    storage.removeItem(key);
    return { ok: true, profile: null };
  } catch {
    return { ok: false, code: "WRITE_FAILED", message: "No pudimos borrar el perfil de equipo en este dispositivo." };
  }
}

const METRIC_RANGES: Record<LaunchMonitorMetric, readonly [number, number]> = {
  clubSpeedMph: [0, 250],
  ballSpeedMph: [0, 300],
  launchAngleDegrees: [-30, 90],
  spinRpm: [0, 25_000],
  carryYards: [0, 700],
  totalYards: [0, 800],
  peakHeightYards: [0, 250],
  landingAngleDegrees: [-30, 90],
};

export function normalizeLaunchMonitorShot(value: unknown): LaunchMonitorShot | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const club = memberOf(source.club, LAUNCH_MONITOR_CLUBS);
  const excluded = boolean(source.excluded);
  if (!id || !club || excluded === null) return null;
  const metrics = Object.fromEntries(LAUNCH_MONITOR_METRICS.map((metric) => {
    const [minimum, maximum] = METRIC_RANGES[metric];
    return [metric, nullableNumber(source[metric], minimum, maximum)];
  })) as Record<LaunchMonitorMetric, number | null>;
  if (LAUNCH_MONITOR_METRICS.every((metric) => metrics[metric] === null)) return null;
  return {
    id,
    club,
    excluded,
    capturedAt: isoDate(source.capturedAt),
    note: text(source.note, 500),
    ...metrics,
  };
}

export function normalizeLaunchMonitorSession(value: unknown, expectedUserId?: string): LaunchMonitorSession | null {
  const source = record(value);
  if (!source) return null;
  const id = identifier(source.id);
  const userId = identifier(source.userId);
  const startedAt = isoDate(source.startedAt);
  if (!id || !userId || (expectedUserId && userId !== expectedUserId) || !startedAt) return null;
  const candidates = Array.isArray(source.shots)
    ? source.shots.slice(0, MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB * LAUNCH_MONITOR_CLUBS.length)
    : [];
  const counts = new Map<LaunchMonitorClub, number>();
  const shots = candidates.flatMap((candidate) => {
    const shot = normalizeLaunchMonitorShot(candidate);
    if (!shot) return [];
    const count = counts.get(shot.club) || 0;
    if (count >= MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB) return [];
    counts.set(shot.club, count + 1);
    return [shot];
  });
  const uniqueShots = [...new Map(shots.map((shot) => [shot.id, shot])).values()];
  return {
    id,
    userId,
    source: text(source.source),
    startedAt,
    completedAt: isoDate(source.completedAt),
    shots: uniqueShots,
  };
}

export function median(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) return null;
  const midpoint = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[midpoint - 1] + finite[midpoint]) / 2 : finite[midpoint];
}

/** A trimmed mean; for 1-3 shots the median is the safer estimate. */
export function robustAverage(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finite.length === 0) return null;
  if (finite.length <= 3) return median(finite);
  const trim = Math.max(1, Math.floor(finite.length * 0.2));
  const retained = finite.slice(trim, finite.length - trim);
  return retained.reduce((sum, value) => sum + value, 0) / retained.length;
}

export function summarizeLaunchMonitorSession(sessionValue: unknown): LaunchMonitorSummary | null {
  const session = normalizeLaunchMonitorSession(sessionValue);
  if (!session) return null;
  const includedShots = session.shots.filter((shot) => !shot.excluded);
  const excludedShots = session.shots.filter((shot) => shot.excluded);
  const byClub = LAUNCH_MONITOR_CLUBS.flatMap((club) => {
    const included = includedShots.filter((shot) => shot.club === club);
    const excluded = excludedShots.filter((shot) => shot.club === club);
    if (included.length === 0 && excluded.length === 0) return [];
    const metrics: Partial<Record<LaunchMonitorMetric, LaunchMetricSummary>> = {};
    for (const metric of LAUNCH_MONITOR_METRICS) {
      const values = included.flatMap((shot) => shot[metric] === null ? [] : [shot[metric] as number]);
      const metricMedian = median(values);
      const resistantAverage = robustAverage(values);
      if (metricMedian !== null && resistantAverage !== null) {
        metrics[metric] = { sampleCount: values.length, median: metricMedian, resistantAverage };
      }
    }
    return [{ club, includedShots: included.length, excludedShots: excluded.length, metrics }];
  });
  return {
    sessionId: session.id,
    includedShots: includedShots.length,
    excludedShots: excludedShots.length,
    byClub,
  };
}

export function getLaunchMonitorProtocolProgress(sessionValue: unknown): LaunchMonitorProtocolProgress | null {
  const session = normalizeLaunchMonitorSession(sessionValue);
  if (!session) return null;
  const counts = Object.fromEntries(LAUNCH_MONITOR_CLUBS.map((club) => [
    club,
    session.shots.filter((shot) => shot.club === club && !shot.excluded).length,
  ])) as Record<LaunchMonitorClub, number>;
  const missing = Object.fromEntries(LAUNCH_MONITOR_CLUBS.map((club) => [club, Math.max(0, 3 - counts[club])])) as Record<LaunchMonitorClub, number>;
  return {
    complete: LAUNCH_MONITOR_CLUBS.every((club) => missing[club] === 0),
    requiredPerClub: 3,
    counts,
    missing,
  };
}
