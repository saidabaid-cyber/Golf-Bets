import golfBallSeed from "../data/golf-ball-catalog.seed.json";
import golfClubSeed from "../data/golf-club-catalog.seed.json";
import golfShaftSeed from "../data/golf-shaft-catalog.seed.json";
import golfEquipmentExpansionSeed from "../data/golf-equipment-catalog.expansion.seed.json";
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

function expandedSeed(seed: SeedEnvelope, expansion: unknown): SeedEnvelope {
  return {
    ...seed,
    models: [
      ...(Array.isArray(seed.models) ? seed.models : []),
      ...(Array.isArray(expansion) ? expansion : []),
    ],
  };
}

const combinedBallSeed = expandedSeed(rawBallSeed, expansionSeed.balls);
const combinedClubSeed = expandedSeed(rawClubSeed, expansionSeed.clubs);
const combinedShaftSeed = expandedSeed(rawShaftSeed, expansionSeed.shafts);

export const golfBallCatalog: readonly GolfBallCatalog[] = Object.freeze(
  normalizeGolfBallCatalogEntries(combinedBallSeed),
);

export const golfClubCatalog: readonly GolfClubCatalog[] = Object.freeze(
  normalizeGolfClubCatalogEntries(combinedClubSeed),
);

export const golfShaftCatalog: readonly GolfShaftCatalog[] = Object.freeze(
  normalizeGolfShaftCatalogEntries(combinedShaftSeed),
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
  },
  clubs: {
    declaredBrands: golfClubBrands.length,
    sourceModels: seedCount(combinedClubSeed),
    usableModels: golfClubCatalog.length,
  },
  shafts: {
    declaredBrands: golfShaftBrands.length,
    sourceModels: seedCount(combinedShaftSeed),
    usableModels: golfShaftCatalog.length,
  },
});

function requiredCatalogSource(model: { id: string; officialUrl: string | null; sourceName: string | null; verifiedAt: string | null }) {
  if (!model.officialUrl || !model.sourceName || !model.verifiedAt) {
    throw new Error(`El modelo ${model.id} no tiene evidencia suficiente para importarse al catálogo.`);
  }
  return {
    official_url: model.officialUrl,
    source_name: model.sourceName,
    // Until a second independent source is recorded, the official manufacturer
    // page is both the product link and the provenance link expected by SQL.
    source_url: model.officialUrl,
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
      year: null,
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
