import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BALL_PRICE_TIERS,
  CLUB_CATEGORIES,
  CLUB_HANDEDNESS,
  normalizeGolfBallCatalogEntries,
  normalizeGolfClubCatalogEntries,
  normalizeGolfShaftCatalogEntries,
  QUALITATIVE_LEVELS,
  SHAFT_FLEXES,
} from "../lib/golf-equipment";
import {
  equipmentCatalogDatabaseSeed,
  golfBallBrands,
  golfBallCatalog,
  golfClubBrands,
  golfClubCatalog,
  golfShaftBrands,
  golfShaftCatalog,
} from "../lib/golf-equipment-catalog";

const VERIFIED_AT = "2026-09-06T00:00:00.000Z";
const FILES = {
  balls: "golf-ball-catalog.seed.json",
  clubs: "golf-club-catalog.seed.json",
  shafts: "golf-shaft-catalog.seed.json",
} as const;

const REQUIRED_BALL_BRANDS = [
  "Titleist",
  "TaylorMade",
  "Callaway",
  "Bridgestone",
  "Srixon",
  "Wilson",
  "Vice",
  "Maxfli",
  "Mizuno",
  "Snell",
  "Kirkland Signature",
] as const;

const REQUIRED_CLUB_BRANDS = [
  "Titleist",
  "TaylorMade",
  "Callaway",
  "PING",
  "Cobra",
  "Mizuno",
  "Srixon",
  "Cleveland",
  "PXG",
  "Wilson",
  "Bridgestone",
  "Odyssey",
  "Scotty Cameron",
  "Bettinardi",
  "LAB Golf",
] as const;

type UnknownRecord = Record<string, unknown>;
type SeedRoot = {
  schemaVersion: number;
  verifiedAt: string;
  brands: string[];
  models: UnknownRecord[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSeed(filename: string): SeedRoot {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), "data", filename), "utf8"));
  assert.ok(isRecord(parsed), `${filename} debe contener un objeto raíz`);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.verifiedAt, VERIFIED_AT);
  assert.ok(Array.isArray(parsed.brands));
  assert.ok(parsed.brands.every((brand) => typeof brand === "string" && brand.trim() === brand && brand.length > 0));
  assert.ok(Array.isArray(parsed.models));
  assert.ok(parsed.models.every(isRecord));
  return {
    schemaVersion: 1,
    verifiedAt: VERIFIED_AT,
    brands: parsed.brands,
    models: parsed.models,
  };
}

function textField(model: UnknownRecord, key: string): string {
  const value = model[key];
  assert.equal(typeof value, "string", `${String(model.id)}.${key} debe ser texto`);
  assert.ok((value as string).trim().length > 0, `${String(model.id)}.${key} no puede estar vacío`);
  return value as string;
}

function validateCommonModelContract(seed: SeedRoot): void {
  const ids = new Set<string>();
  for (const model of seed.models) {
    const id = textField(model, "id");
    const brand = textField(model, "brand");
    textField(model, "model");
    textField(model, "sourceName");
    assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${id} debe ser un slug estable`);
    assert.ok(!ids.has(id), `${id} está duplicado`);
    assert.ok(seed.brands.includes(brand), `${brand} no está declarado en brands`);
    assert.equal(model.active, true, `${id} debe declarar active explícitamente`);
    assert.equal(model.verifiedAt, VERIFIED_AT, `${id} debe conservar la fecha de verificación`);
    assert.equal(model.createdAt, VERIFIED_AT);
    assert.equal(model.updatedAt, VERIFIED_AT);
    ids.add(id);
  }
  assert.equal(ids.size, seed.models.length);
  assert.equal(new Set(seed.brands).size, seed.brands.length, "brands no debe tener duplicados");
}

function expectEveryBrandHasAModel(seed: SeedRoot, required: readonly string[]): void {
  for (const brand of required) {
    assert.ok(seed.brands.includes(brand), `Falta la marca requerida ${brand}`);
    assert.ok(seed.models.some((model) => model.brand === brand), `Falta un modelo verificado de ${brand}`);
  }
}

const OFFICIAL_HOST_SUFFIX_BY_BRAND: Readonly<Record<string, readonly string[]>> = {
  Titleist: ["titleist.com"],
  TaylorMade: ["taylormadegolf.com"],
  Callaway: ["callawaygolf.com"],
  Bridgestone: ["bridgestonegolf.com"],
  Srixon: ["dunlopsports.com"],
  Cleveland: ["dunlopsports.com"],
  Wilson: ["wilson.com"],
  Vice: ["vicegolf.com"],
  Maxfli: ["dickssportinggoods.com"],
  Mizuno: ["mizunogolf.com"],
  Snell: ["snellgolf.com"],
  "Kirkland Signature": ["costco.com"],
  PING: ["ping.com"],
  Cobra: ["cobragolf.com"],
  PXG: ["pxg.com"],
  Odyssey: ["callawaygolf.com"],
  "Scotty Cameron": ["scottycameron.com"],
  Bettinardi: ["bettinardi.com"],
  "LAB Golf": ["labgolf.com"],
  Fujikura: ["fujikuragolf.com"],
  "Mitsubishi Chemical": ["mitsubishigolf.com"],
  KBS: ["kbsgolfshafts.com"],
  "Graphite Design": ["proschoicegolfshafts.com"],
  "True Temper": ["truetemper.com"],
};

function validateOfficialSources(seed: SeedRoot): void {
  for (const model of seed.models) {
    const brand = textField(model, "brand");
    const officialUrl = textField(model, "officialUrl");
    const url = new URL(officialUrl);
    assert.equal(url.protocol, "https:", `${String(model.id)} debe usar HTTPS`);
    const allowedSuffixes = OFFICIAL_HOST_SUFFIX_BY_BRAND[brand];
    assert.ok(allowedSuffixes, `No hay política de fuente para ${brand}`);
    assert.ok(
      allowedSuffixes.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)),
      `${officialUrl} no es una fuente oficial permitida para ${brand}`,
    );
  }
}

test("los seeds tienen contrato versionado, modelos únicos y fuentes trazables", () => {
  for (const filename of Object.values(FILES)) {
    const seed = readSeed(filename);
    validateCommonModelContract(seed);
    validateOfficialSources(seed);
  }
});

test("el catálogo de bolas incluye cada marca mínima y solo atributos normalizados", () => {
  const seed = readSeed(FILES.balls);
  expectEveryBrandHasAModel(seed, REQUIRED_BALL_BRANDS);
  const qualitativeFields = ["flight", "driverSpin", "ironSpin", "shortGameSpin", "feel"] as const;
  for (const model of seed.models) {
    assert.ok(model.coverMaterial === null || typeof model.coverMaterial === "string");
    assert.ok(model.construction === null || typeof model.construction === "string");
    assert.ok(model.compression === null || (typeof model.compression === "number" && model.compression > 0));
    if (model.compression === null) {
      assert.equal(model.compressionType, "UNKNOWN");
      assert.equal(model.compressionSource, null);
      assert.equal(model.compressionSourceUrl, null);
    } else {
      assert.equal(model.compressionType, "MANUFACTURER");
      assert.equal(model.compressionSource, model.sourceName);
      assert.equal(model.compressionSourceUrl, model.officialUrl);
    }
    for (const field of qualitativeFields) {
      assert.ok(model[field] === null || QUALITATIVE_LEVELS.includes(model[field] as (typeof QUALITATIVE_LEVELS)[number]));
    }
    assert.ok(model.priceTier === null || BALL_PRICE_TIERS.includes(model.priceTier as (typeof BALL_PRICE_TIERS)[number]));
    assert.ok(Array.isArray(model.colors) && model.colors.every((color) => typeof color === "string"));
    assert.ok(Array.isArray(model.targetProfile) && model.targetProfile.every((profile) => typeof profile === "string"));
  }
  const publishedCompression = new Map(seed.models.map((model) => [model.id, model.compression]));
  assert.equal(publishedCompression.get("srixon-z-star-10360111"), 88);
  assert.equal(publishedCompression.get("vice-pro-2024"), 90);
  assert.equal(publishedCompression.get("maxfli-tour-x-24maxumxfltrxwhtdgbl"), 100);
  assert.equal(publishedCompression.get("titleist-pro-v1-2025"), null, "Titleist no publica una compresión numérica oficial para este registro");
  assert.equal(publishedCompression.get("snell-pr3-2026"), null, "Un rango publicado no se convierte artificialmente en un escalar");
});

test("el catálogo de bastones incluye todas las marcas solicitadas y especificaciones opcionales seguras", () => {
  const seed = readSeed(FILES.clubs);
  expectEveryBrandHasAModel(seed, REQUIRED_CLUB_BRANDS);
  for (const model of seed.models) {
    assert.ok(CLUB_CATEGORIES.includes(model.category as (typeof CLUB_CATEGORIES)[number]));
    assert.ok(Array.isArray(model.handedness) && model.handedness.length > 0);
    assert.ok(model.handedness.every((hand) => CLUB_HANDEDNESS.includes(hand as (typeof CLUB_HANDEDNESS)[number])));
    assert.ok(Array.isArray(model.lofts) && model.lofts.every((loft) => typeof loft === "number" && Number.isFinite(loft)));
    for (const field of ["standardLength", "lie", "headVolume"] as const) {
      assert.ok(model[field] === null || (typeof model[field] === "number" && Number.isFinite(model[field])));
    }
  }
  assert.ok(seed.models.some((model) => model.category === "MINI_DRIVER"));
  assert.ok(seed.models.some((model) => model.category === "HYBRID"));
  assert.ok(seed.models.some((model) => model.category === "UTILITY_IRON"));
});

test("el catálogo de shafts conserva variantes familiares sin inventar un peso único", () => {
  const seed = readSeed(FILES.shafts);
  for (const model of seed.models) {
    assert.ok(model.weight === null || (typeof model.weight === "number" && model.weight > 0));
    assert.ok(Array.isArray(model.flex) && model.flex.length > 0);
    assert.ok(model.flex.every((flex) => SHAFT_FLEXES.includes(flex as (typeof SHAFT_FLEXES)[number])));
    assert.ok(model.launch === null || QUALITATIVE_LEVELS.includes(model.launch as (typeof QUALITATIVE_LEVELS)[number]));
    assert.ok(model.spin === null || QUALITATIVE_LEVELS.includes(model.spin as (typeof QUALITATIVE_LEVELS)[number]));
    for (const field of ["generation", "torque", "tipDiameter", "buttDiameter"] as const) assert.equal(model[field] ?? null, null);
  }
  assert.ok(seed.models.every((model) => model.weight === null), "Los modelos familiares no deben fingir un único peso común a todos sus flexes");
});

test("la proyección de compresión y shaft usa procedencia explícita, nunca inferencia", () => {
  const projected = equipmentCatalogDatabaseSeed();
  for (const ball of projected.balls) {
    if (ball.compression === null) {
      assert.equal(ball.compression_type, "UNKNOWN");
      assert.equal(ball.compression_source, null);
      assert.equal(ball.compression_source_url, null);
    } else {
      assert.equal(ball.compression_type, "MANUFACTURER");
      assert.ok(ball.compression_source);
      assert.equal(ball.compression_source_url, ball.official_url);
    }
  }
  for (const shaft of projected.shafts) {
    assert.equal(shaft.generation, null);
    assert.equal(shaft.torque_degrees, null);
    assert.equal(shaft.tip_diameter_inches, null);
    assert.equal(shaft.butt_diameter_inches, null);
  }
});

test("los loaders del dominio importan todos los modelos sin descartes silenciosos", () => {
  const balls = readSeed(FILES.balls);
  const clubs = readSeed(FILES.clubs);
  const shafts = readSeed(FILES.shafts);
  assert.equal(normalizeGolfBallCatalogEntries(balls).length, balls.models.length);
  assert.equal(normalizeGolfClubCatalogEntries(clubs).length, clubs.models.length);
  assert.equal(normalizeGolfShaftCatalogEntries(shafts).length, shafts.models.length);
});

test("cada catálogo tiene una proyección completa e idempotente para Supabase Beta", () => {
  const projected = equipmentCatalogDatabaseSeed();
  assert.equal(projected.balls.length, golfBallCatalog.length);
  assert.equal(projected.clubs.length, golfClubCatalog.length);
  assert.equal(projected.shafts.length, golfShaftCatalog.length);
  assert.equal(projected.ballBrands.length, golfBallBrands.length);
  assert.equal(projected.clubBrands.length, golfClubBrands.length);
  assert.ok(golfBallCatalog.length >= 30, "Beta necesita un catálogo útil de bolas");
  assert.ok(golfClubCatalog.length >= 60, "Beta necesita un catálogo útil de bastones");
  assert.ok(golfShaftCatalog.length >= 40, "Beta necesita un catálogo útil de varillas");
  assert.ok(golfBallBrands.length >= 12);
  assert.ok(golfShaftBrands.length >= 10);
  assert.ok(projected.clubBrands.length >= REQUIRED_CLUB_BRANDS.length);
  assert.equal(new Set(projected.ballBrands.map((row) => row.id)).size, projected.ballBrands.length);
  assert.ok(projected.balls.every((row) => projected.ballBrands.some((brand) => brand.id === row.brand_id)));
  assert.ok(projected.clubs.every((row) => projected.clubBrands.some((brand) => brand.id === row.brand_id)));
  assert.ok(projected.balls.every((row) => row.compression_type === (row.compression === null ? "UNKNOWN" : "MANUFACTURER")));
  assert.ok(projected.balls.every((row) => row.recommended_swing_speed_min_mph === null && row.usga_conforming === null));

  for (const row of [...projected.ballBrands, ...projected.clubBrands, ...projected.balls, ...projected.clubs, ...projected.shafts]) {
    assert.ok(row.id);
    if ("source_url" in row) {
      assert.equal(row.source_url, row.official_url);
      assert.match(row.source_url, /^https:\/\//);
    }
    assert.ok(row.source_name);
    assert.ok(row.verified_at);
    assert.ok(Number.isFinite(Date.parse(row.verified_at)));
  }
});
