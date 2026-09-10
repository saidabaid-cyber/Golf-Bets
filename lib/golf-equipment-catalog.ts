import golfBallSeed from "../data/golf-ball-catalog.seed.json";
import golfClubSeed from "../data/golf-club-catalog.seed.json";
import golfShaftSeed from "../data/golf-shaft-catalog.seed.json";
import golfEquipmentExpansionSeed from "../data/golf-equipment-catalog.expansion.seed.json";
import forgivingGolfSnapshot from "../data/forgiving-golf-equipment.snapshot.json";
import equipmentMasterSnapshot from "../data/backyard-equipment-master-2010-2026.snapshot.json";
import shaftMasterSnapshot from "../data/backyard-shaft-master-2010-2026.snapshot.json";
import {
  normalizeGolfBallCatalogEntries,
  normalizeGolfClubCatalogEntries,
  normalizeGolfShaftCatalogEntries,
  type GolfBallCatalog,
  type GolfClubCatalog,
  type GolfShaftCatalog,
} from "./golf-equipment";

type SeedEnvelope = {
  schemaVersion?: unknown;
  verifiedAt?: unknown;
  brands?: unknown;
  models?: unknown;
};

function normalizedBrands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const label = candidate.trim().replace(/\s+/g, " ").slice(0, 100);
    if (!label) continue;
    const key = label.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, label);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(right, "es-MX"));
}

function seedCount(seed: SeedEnvelope) {
  return Array.isArray(seed.models) ? seed.models.length : 0;
}

function catalogBrands<T extends { brand: string }>(seed: SeedEnvelope, models: readonly T[]) {
  const declared = normalizedBrands(seed.brands);
  const discovered = normalizedBrands(models.map((model) => model.brand));
  return normalizedBrands([...declared, ...discovered]);
}

function brandId(scope: "ball" | "club", name: string) {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${scope}-brand-${slug}`;
}

function brandRows<T extends { brand: string; officialUrl: string | null; sourceName: string | null; verifiedAt: string | null }>(
  scope: "ball" | "club",
  brands: readonly string[],
  models: readonly T[],
) {
  return brands.map((name) => {
    const evidence = models.find((model) => model.brand === name && model.officialUrl && model.verifiedAt) || null;
    return {
      id: brandId(scope, name),
      name,
      active: models.some((model) => model.brand === name),
      official_url: evidence?.officialUrl || null,
      source_name: evidence?.sourceName || null,
      verified_at: evidence?.verifiedAt || null,
      created_at: evidence?.verifiedAt || rawBallSeed.verifiedAt || rawClubSeed.verifiedAt,
      updated_at: evidence?.verifiedAt || rawBallSeed.verifiedAt || rawClubSeed.verifiedAt,
    };
  });
}

function ballFeelProfile(value: GolfBallCatalog["feel"]) {
  if (value === "VERY_LOW") return "VERY_SOFT";
  if (value === "LOW") return "SOFT";
  if (value === "HIGH") return "FIRM";
  if (value === "VERY_HIGH") return "VERY_FIRM";
  return value;
}

const rawBallSeed = golfBallSeed as SeedEnvelope;
const rawClubSeed = golfClubSeed as SeedEnvelope;
const rawShaftSeed = golfShaftSeed as SeedEnvelope;
const expansionSeed = golfEquipmentExpansionSeed as {
  schemaVersion?: unknown;
  verifiedAt?: unknown;
  balls?: unknown;
  clubs?: unknown;
  shafts?: unknown;
};
const forgivingSeed = forgivingGolfSnapshot as SeedEnvelope & { importedAt?: unknown; license?: unknown; sourceUrl?: unknown };
const masterSeed = equipmentMasterSnapshot as {
  schemaVersion?: unknown;
  sourceCounts?: { balls?: unknown; clubs?: unknown };
  acceptedCounts?: { balls?: unknown; clubs?: unknown };
  rejectedCounts?: { balls?: unknown; clubs?: unknown };
  balls?: unknown;
  clubs?: unknown;
};
const masterShaftSeed = shaftMasterSnapshot as SeedEnvelope & {
  sourceCount?: unknown;
  acceptedCount?: unknown;
  rejectedCount?: unknown;
  declaredFitEligibleCount?: unknown;
  acceptedFitEligibleCount?: unknown;
};

function expandedSeed(seed: SeedEnvelope, expansion: unknown): SeedEnvelope {
  return {
    ...seed,
    models: [
      ...(Array.isArray(seed.models) ? seed.models : []),
      ...(Array.isArray(expansion) ? expansion : []),
    ],
  };
}

const combinedBallSeed = expandedSeed(expandedSeed(rawBallSeed, expansionSeed.balls), masterSeed.balls);
const combinedClubSeed = expandedSeed(expandedSeed(expandedSeed(rawClubSeed, expansionSeed.clubs), forgivingSeed.models), masterSeed.clubs);
const legacyCombinedShaftSeed = expandedSeed(rawShaftSeed, expansionSeed.shafts);
const combinedShaftSeed = expandedSeed(legacyCombinedShaftSeed, masterShaftSeed.models);

function canonicalEquipmentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™]/g, "")
    .replace(/\+/g, " plus ")
    .toLocaleLowerCase("en-US")
    .replace(/\bgolf\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(plus)(?:\s+plus)+\b/g, "plus")
    .replace(/\s+/g, "");
}

const CANONICAL_BRAND_LABELS = new Map([
  ["cobra", "Cobra"],
  ["lab", "L.A.B. Golf"],
  ["nippon", "Nippon Shaft"],
]);

function canonicalBrandLabel(value: string) {
  return CANONICAL_BRAND_LABELS.get(canonicalEquipmentText(value)) || value;
}

function canonicalizeBrand<T extends { brand: string }>(item: T): T {
  const brand = canonicalBrandLabel(item.brand);
  return brand === item.brand ? item : { ...item, brand };
}

// These verified legacy rows predate the explicit shaft-usage field. Keeping
// the mapping by stable catalog ID preserves saved references while preventing
// an unscoped iron shaft from appearing in a wood selector (and vice versa).
const LEGACY_SHAFT_USAGE_BY_ID: Readonly<Record<string, NonNullable<GolfShaftCatalog["usage"]>>> = Object.freeze({
  "mitsubishi-diamana-wb": "WOOD",
  "mitsubishi-diamana-rb": "WOOD",
  "mitsubishi-diamana-bb": "WOOD",
  "mitsubishi-tensei-1k-pro-red": "WOOD",
  "mitsubishi-grand-bassara": "WOOD",
  "kbs-max-graphite-iron": "IRON",
  "kbs-pgi": "IRON",
  "true-temper-dynamic-gold-mid": "IRON",
  "project-x-denali-black": "WOOD",
  "ust-mamiya-recoil-dart": "IRON",
});

function withVerifiedLegacyShaftUsage(shaft: GolfShaftCatalog): GolfShaftCatalog {
  if (shaft.usage) return shaft;
  const usage = LEGACY_SHAFT_USAGE_BY_ID[shaft.id];
  return usage ? { ...shaft, usage } : shaft;
}

function modelWithoutRedundantCategory(model: string, category: GolfClubCatalog["category"]) {
  const suffixes: Partial<Record<GolfClubCatalog["category"], RegExp>> = {
    DRIVER: /\s+driver$/i,
    MINI_DRIVER: /\s+mini\s+driver$/i,
    FAIRWAY_WOOD: /\s+(?:fairway|fairway\s+wood|wood)$/i,
    HYBRID: /\s+(?:hybrid|rescue)$/i,
    UTILITY_IRON: /\s+(?:utility|utility\s+iron|driving\s+iron)$/i,
    IRON_SET: /\s+(?:irons?|iron\s+set)$/i,
    WEDGE: /\s+wedge$/i,
    PUTTER: /\s+putter$/i,
  };
  return model.replace(suffixes[category] || /$^/, "").trim();
}

function generationKey(item: { generation: string | null; year: number | null }) {
  return item.year ? String(item.year) : canonicalEquipmentText(item.generation || "unknown");
}

function clubBaseIdentity(club: Pick<GolfClubCatalog, "brand" | "model" | "category">) {
  return `${club.category}:${canonicalEquipmentText(club.brand)}:${canonicalEquipmentText(modelWithoutRedundantCategory(club.model, club.category))}`;
}

export function canonicalClubIdentity(club: Pick<GolfClubCatalog, "brand" | "model" | "category" | "generation" | "year">) {
  return `${clubBaseIdentity(club)}:${generationKey(club)}`;
}

export function canonicalBallIdentity(ball: Pick<GolfBallCatalog, "brand" | "model" | "generation" | "year">) {
  return `${canonicalEquipmentText(ball.brand)}:${canonicalEquipmentText(ball.model)}:${generationKey(ball)}`;
}

function sourcePriority(item: { sourceType?: string | null; sourceName?: string | null }) {
  if (!item.sourceType && !item.sourceName?.startsWith("forgiving.golf")) return 500;
  if (item.sourceType === "OEM_OFFICIAL" || item.sourceType === "USGA_OFFICIAL") return 400;
  if (item.sourceName?.startsWith("forgiving.golf")) return 320;
  if (item.sourceType === "OPEN_DATA_CC_BY_4_0") return 300;
  if (item.sourceType === "SECONDARY_TECHNICAL") return 250;
  return 200;
}

function populated<T>(primary: T, fallback: T): T {
  if (primary === null || primary === undefined || primary === "") return fallback;
  if (Array.isArray(primary) && primary.length === 0) return fallback;
  return primary;
}

function isBallRecord(value: GolfClubCatalog | GolfBallCatalog): value is GolfBallCatalog {
  return "compression" in value;
}

function mergeRecords<T extends GolfClubCatalog | GolfBallCatalog>(primary: T, fallback: T): T {
  const merged = { ...fallback, ...primary } as T;
  for (const key of Object.keys(merged) as Array<keyof T>) merged[key] = populated(primary[key], fallback[key]);
  if (isBallRecord(merged) && isBallRecord(primary) && isBallRecord(fallback)) {
    const compressionOwner = primary.compression === null && fallback.compression !== null ? fallback : primary;
    merged.compression = compressionOwner.compression;
    merged.compressionType = compressionOwner.compressionType;
    merged.compressionSource = compressionOwner.compressionSource;
    merged.compressionSourceUrl = compressionOwner.compressionSourceUrl;
  }
  merged.active = primary.active;
  merged.bagEligible = primary.bagEligible || fallback.bagEligible;
  merged.fitEligible = primary.fitEligible || fallback.fitEligible;
  merged.aliases = [...new Set([...primary.aliases, ...fallback.aliases, ...(primary.id === fallback.id ? [] : [fallback.id])])];
  merged.provenance = [...new Map([...primary.provenance, ...fallback.provenance]
    .map((source) => [`${source.sourceType}:${source.sourceUrl}:${source.verifiedAt}`, source])).values()];
  return merged;
}

function dedupeCatalog<T extends GolfClubCatalog | GolfBallCatalog>(models: readonly T[], identity: (item: T) => string, baseIdentity: (item: T) => string) {
  const unique = new Map<string, T>();
  const keyByBase = new Map<string, string[]>();
  const sorted = [...models].sort((left, right) => sourcePriority(right) - sourcePriority(left));
  for (const model of sorted) {
    const exactKey = identity(model);
    const base = baseIdentity(model);
    const known = keyByBase.get(base) || [];
    let key = exactKey;
    if (!unique.has(key) && generationKey(model) === "unknown" && known.length === 1) key = known[0];
    const current = unique.get(key);
    unique.set(key, current ? mergeRecords(current, model) : model);
    if (!current) keyByBase.set(base, [...known, key]);
  }
  return [...unique.values()];
}

export function dedupeGolfClubCatalog(models: readonly GolfClubCatalog[]) {
  return dedupeCatalog(models, canonicalClubIdentity, clubBaseIdentity);
}

export function dedupeGolfBallCatalog(models: readonly GolfBallCatalog[]) {
  return dedupeCatalog(models, canonicalBallIdentity, (ball) => `${canonicalEquipmentText(ball.brand)}:${canonicalEquipmentText(ball.model)}`);
}

function canonicalShaftModel(model: string) {
  const reorderedHzrdus = model.replace(/^HZRDUS\s+Gen\s+(\d+)\s+(.+)$/i, "HZRDUS $2 Gen $1");
  return canonicalEquipmentText(reorderedHzrdus);
}

function shaftBaseIdentity(shaft: Pick<GolfShaftCatalog, "brand" | "model">) {
  return `${canonicalEquipmentText(shaft.brand)}:${canonicalShaftModel(shaft.model)}`;
}

function shaftVariantIdentity(shaft: Pick<GolfShaftCatalog, "usage" | "oemStockOrAftermarket">) {
  return `${shaft.usage || "unknown"}:${shaft.oemStockOrAftermarket || "unknown"}`;
}

export function canonicalShaftIdentity(shaft: Pick<GolfShaftCatalog, "brand" | "model" | "generation" | "year" | "usage" | "oemStockOrAftermarket">) {
  return `${shaftBaseIdentity(shaft)}:${shaftVariantIdentity(shaft)}:${generationKey(shaft)}`;
}

function mergeShaftRecords(primary: GolfShaftCatalog, fallback: GolfShaftCatalog): GolfShaftCatalog {
  const merged = { ...fallback, ...primary };
  for (const key of Object.keys(merged) as Array<keyof GolfShaftCatalog>) {
    merged[key] = populated(primary[key], fallback[key]) as never;
  }
  merged.active = primary.active;
  merged.bagEligible = primary.bagEligible || fallback.bagEligible;
  merged.fitEligible = primary.fitEligible || fallback.fitEligible;
  merged.aliases = [...new Set([...primary.aliases, ...fallback.aliases, ...(primary.id === fallback.id ? [] : [fallback.id])])];
  merged.provenance = [...new Map([...primary.provenance, ...fallback.provenance]
    .map((source) => [`${source.sourceType}:${source.sourceUrl}:${source.verifiedAt}`, source])).values()];
  // Legacy rows store only coarse flex categories. The master retains exact
  // manufacturer nomenclature and therefore wins this one field when present.
  if (!primary.sourceType && fallback.flexOptions.length) merged.flexOptions = [...fallback.flexOptions];
  if (!primary.weightOptions.length && fallback.weightOptions.length) merged.weightOptions = [...fallback.weightOptions];
  if (!primary.torqueRange.length && fallback.torqueRange.length) merged.torqueRange = [...fallback.torqueRange];
  return merged;
}

function matchingCurrentMaster(legacy: GolfShaftCatalog, master: readonly GolfShaftCatalog[]) {
  const candidates = master.filter((candidate) => shaftBaseIdentity(candidate) === shaftBaseIdentity(legacy));
  const compatible = candidates.filter((candidate) => (!legacy.usage || candidate.usage === legacy.usage)
    && (!legacy.oemStockOrAftermarket || candidate.oemStockOrAftermarket === legacy.oemStockOrAftermarket));
  const current = compatible.filter((candidate) => candidate.active && /CURRENT/i.test(candidate.generation || ""));
  if (current.length === 1) return current[0];
  const active = compatible.filter((candidate) => candidate.active);
  if (active.length === 1) return active[0];
  return compatible.length === 1 ? compatible[0] : null;
}

export function dedupeGolfShaftCatalog(legacyModels: readonly GolfShaftCatalog[], masterModels: readonly GolfShaftCatalog[]) {
  const consumedMasterIds = new Set<string>();
  const preservedLegacy = legacyModels.map((legacy) => {
    const match = matchingCurrentMaster(legacy, masterModels);
    if (!match) return legacy;
    consumedMasterIds.add(match.id);
    // Existing IDs are deliberately primary so saved bags and historical
    // snapshots keep resolving after the catalog expansion.
    return mergeShaftRecords(legacy, match);
  });
  const unique = new Map<string, GolfShaftCatalog>();
  for (const shaft of [...preservedLegacy, ...masterModels.filter((shaft) => !consumedMasterIds.has(shaft.id))]
    .sort((left, right) => sourcePriority(right) - sourcePriority(left))) {
    const key = canonicalShaftIdentity(shaft);
    const current = unique.get(key);
    unique.set(key, current ? mergeShaftRecords(current, shaft) : shaft);
  }
  return [...unique.values()];
}

export const golfBallCatalog: readonly GolfBallCatalog[] = Object.freeze(
  dedupeGolfBallCatalog(normalizeGolfBallCatalogEntries(combinedBallSeed).map(canonicalizeBrand)),
);

export const golfClubCatalog: readonly GolfClubCatalog[] = Object.freeze(
  dedupeGolfClubCatalog(normalizeGolfClubCatalogEntries(combinedClubSeed).map(canonicalizeBrand)),
);

export const golfShaftCatalog: readonly GolfShaftCatalog[] = Object.freeze(
  dedupeGolfShaftCatalog(
    normalizeGolfShaftCatalogEntries(legacyCombinedShaftSeed).map(canonicalizeBrand).map(withVerifiedLegacyShaftUsage),
    normalizeGolfShaftCatalogEntries(masterShaftSeed).map(canonicalizeBrand),
  ),
);

export const golfBallBrands = Object.freeze(catalogBrands(combinedBallSeed, golfBallCatalog));
export const golfClubBrands = Object.freeze(catalogBrands(combinedClubSeed, golfClubCatalog));
export const golfShaftBrands = Object.freeze(catalogBrands(combinedShaftSeed, golfShaftCatalog));

export const golfCatalogDiagnostics = Object.freeze({
  schemaVersion: 1,
  verifiedAt: [rawBallSeed.verifiedAt, rawClubSeed.verifiedAt, rawShaftSeed.verifiedAt]
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(0) ?? null,
  balls: {
    declaredBrands: golfBallBrands.length,
    sourceModels: seedCount(combinedBallSeed),
    usableModels: golfBallCatalog.length,
    masterSourceModels: typeof masterSeed.sourceCounts?.balls === "number" ? masterSeed.sourceCounts.balls : 0,
    fitEligibleModels: golfBallCatalog.filter((ball) => ball.fitEligible && ball.active).length,
    bagEligibleModels: golfBallCatalog.filter((ball) => ball.bagEligible).length,
  },
  clubs: {
    declaredBrands: golfClubBrands.length,
    sourceModels: seedCount(combinedClubSeed),
    usableModels: golfClubCatalog.length,
    importedModels: seedCount(forgivingSeed),
    masterSourceModels: typeof masterSeed.sourceCounts?.clubs === "number" ? masterSeed.sourceCounts.clubs : 0,
    bagEligibleModels: golfClubCatalog.filter((club) => club.bagEligible).length,
  },
  shafts: {
    declaredBrands: golfShaftBrands.length,
    sourceModels: seedCount(combinedShaftSeed),
    usableModels: golfShaftCatalog.length,
    masterSourceModels: typeof masterShaftSeed.sourceCount === "number" ? masterShaftSeed.sourceCount : 0,
    masterAcceptedModels: typeof masterShaftSeed.acceptedCount === "number" ? masterShaftSeed.acceptedCount : 0,
    masterRejectedModels: typeof masterShaftSeed.rejectedCount === "number" ? masterShaftSeed.rejectedCount : 0,
    fitEligibleModels: golfShaftCatalog.filter((shaft) => shaft.fitEligible).length,
    bagEligibleModels: golfShaftCatalog.filter((shaft) => shaft.bagEligible).length,
    activeModels: golfShaftCatalog.filter((shaft) => shaft.active).length,
    historicalModels: golfShaftCatalog.filter((shaft) => !shaft.active).length,
    aliases: golfShaftCatalog.reduce((sum, shaft) => sum + shaft.aliases.length, 0),
  },
});

function requiredCatalogSource(model: { id: string; officialUrl: string | null; sourceName: string | null; sourceUrl?: string | null; verifiedAt: string | null }) {
  const evidenceUrl = model.officialUrl || model.sourceUrl || null;
  if (!evidenceUrl || !model.sourceName || !model.verifiedAt) {
    throw new Error(`El modelo ${model.id} no tiene evidencia suficiente para importarse al catálogo.`);
  }
  return {
    official_url: model.officialUrl,
    source_name: model.sourceName,
    // Until a second independent source is recorded, the official manufacturer
    // page is both the product link and the provenance link expected by SQL.
    source_url: evidenceUrl,
    verified_at: model.verifiedAt,
  };
}

/**
 * Lossless snake_case projection for an idempotent Supabase `upsert(..., {
 * onConflict: "id" })`. This function does not connect to a database: callers
 * must deliberately choose an isolated Beta project and server-only credentials.
 */
export function equipmentCatalogDatabaseSeed() {
  return {
    ballBrands: brandRows("ball", golfBallBrands, golfBallCatalog),
    clubBrands: brandRows("club", golfClubBrands, golfClubCatalog),
    balls: golfBallCatalog.map((ball) => ({
      id: ball.id,
      brand_id: brandId("ball", ball.brand),
      brand: ball.brand,
      model: ball.model,
      generation: ball.generation,
      year: ball.year,
      active: ball.active,
      cover_material: ball.coverMaterial,
      construction: ball.construction,
      compression: ball.compression,
      compression_type: ball.compressionType,
      compression_source: ball.compressionSource,
      compression_source_url: ball.compressionSourceUrl,
      compression_min: null,
      compression_max: null,
      compression_average: null,
      construction_pieces: null,
      dimple_count: null,
      year_from: ball.year,
      year_to: null,
      feel_profile: ballFeelProfile(ball.feel),
      recommended_swing_speed_min_mph: null,
      recommended_swing_speed_max_mph: null,
      target_player_description: ball.targetProfile.length ? ball.targetProfile.join(" · ") : null,
      usga_conforming: null,
      flight: ball.flight,
      driver_spin: ball.driverSpin,
      iron_spin: ball.ironSpin,
      short_game_spin: ball.shortGameSpin,
      feel: ball.feel,
      flight_source_text: null,
      driver_spin_source_text: null,
      iron_spin_source_text: null,
      short_game_spin_source_text: null,
      feel_source_text: null,
      colors: [...ball.colors],
      price_tier: ball.priceTier,
      target_profile: [...ball.targetProfile],
      ...requiredCatalogSource(ball),
      created_at: ball.createdAt,
      updated_at: ball.updatedAt,
    })),
    clubs: golfClubCatalog.map((club) => ({
      id: club.id,
      brand_id: brandId("club", club.brand),
      brand: club.brand,
      model: club.model,
      generation: club.generation,
      year: club.year,
      year_from: club.year,
      year_to: null,
      category: club.category,
      sub_category: club.subCategory,
      active: club.active,
      handedness: [...club.handedness],
      lofts: [...club.lofts],
      variants: club.variants.map((variant) => ({ loft: variant.loft, handedness: [...variant.handedness] })),
      standard_length_inches: club.standardLength,
      lie_degrees: club.lie,
      head_volume_cc: club.headVolume,
      construction: null,
      ...requiredCatalogSource(club),
      created_at: club.createdAt ?? club.verifiedAt,
      updated_at: club.updatedAt ?? club.verifiedAt,
    })),
    shafts: golfShaftCatalog.map((shaft) => ({
      id: shaft.id,
      brand: shaft.brand,
      model: shaft.model,
      generation: shaft.generation,
      year: shaft.year,
      torque_degrees: shaft.torque,
      tip_diameter_inches: shaft.tipDiameter,
      butt_diameter_inches: shaft.buttDiameter,
      active: shaft.active,
      weight_grams: shaft.weight,
      flex: [...shaft.flex],
      launch: shaft.launch,
      spin: shaft.spin,
      material: shaft.material,
      ...requiredCatalogSource(shaft),
      created_at: shaft.createdAt ?? shaft.verifiedAt,
      updated_at: shaft.updatedAt ?? shaft.verifiedAt,
    })),
  } as const;
}

export function activeGolfBalls(): readonly GolfBallCatalog[] {
  return golfBallCatalog.filter((ball) => ball.active);
}

export function activeGolfClubs(): readonly GolfClubCatalog[] {
  return golfClubCatalog.filter((club) => club.active);
}

export function activeGolfShafts(): readonly GolfShaftCatalog[] {
  return golfShaftCatalog.filter((shaft) => shaft.active);
}

export function fitEligibleGolfShafts(): readonly GolfShaftCatalog[] {
  return golfShaftCatalog.filter((shaft) => shaft.fitEligible);
}
