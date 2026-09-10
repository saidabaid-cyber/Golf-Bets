import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLUB_FILE = "backyard_clubs_2010_2026.json";
const BALL_FILE = "backyard_balls_2010_2026.json";
const DEFAULT_OUTPUT = "data/backyard-equipment-master-2010-2026.snapshot.json";
const CLUB_CATEGORY = new Map([
  ["DRIVER", "DRIVER"],
  ["MINI_DRIVER", "MINI_DRIVER"],
  ["FAIRWAY", "FAIRWAY_WOOD"],
  ["HYBRID", "HYBRID"],
  ["UTILITY", "UTILITY_IRON"],
  ["IRON_SET", "IRON_SET"],
  ["WEDGE", "WEDGE"],
  ["PUTTER", "PUTTER"],
]);
const QUALITATIVE = new Map([
  ["VERY_LOW", "VERY_LOW"], ["LOW", "LOW"], ["MID", "MID"],
  ["HIGH", "HIGH"], ["VERY_HIGH", "VERY_HIGH"],
  ["VERY_SOFT", "VERY_LOW"], ["SOFT", "LOW"],
  ["FIRM", "HIGH"], ["VERY_FIRM", "VERY_HIGH"],
]);

function text(value, maximum = 2_048) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : null;
}

function date(value) {
  const normalized = text(value, 80);
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : null;
}

function url(value) {
  const normalized = text(value);
  try { return normalized && new URL(normalized).protocol === "https:" ? normalized : null; }
  catch { return null; }
}

function source(record) {
  const sourceType = text(record.source_type, 80);
  const sourceName = text(record.source_name, 300);
  const sourceUrl = url(record.source_url);
  const verifiedAt = date(record.verified_at);
  const license = sourceType === "OPEN_DATA_CC_BY_4_0" ? "CC BY 4.0" : null;
  if (!sourceType || !sourceName || !sourceUrl || !verifiedAt) return null;
  return {
    sourceType,
    sourceName,
    sourceUrl,
    verifiedAt,
    license,
    confidence: text(record.confidence, 40),
  };
}

function colors(value) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => text(item, 80)).filter(Boolean))];
  const normalized = text(value, 500);
  return normalized ? [...new Set(normalized.split(/[,;/]/).map((item) => text(item, 80)).filter(Boolean))] : [];
}

function technicalCoverage(record) {
  return ["compression", "cover_material", "construction_pieces", "driver_spin", "iron_spin", "short_game_spin", "feel"]
    .filter((key) => record[key] !== null && record[key] !== undefined && record[key] !== "").length;
}

function mapClub(record) {
  const provenance = source(record);
  const category = CLUB_CATEGORY.get(record.category);
  const id = text(record.id, 240);
  const brand = text(record.brand, 120);
  const model = text(record.model, 180);
  if (!provenance || !category || !id || !brand || !model) return null;
  return {
    id,
    externalId: id,
    aliases: [],
    brand,
    model,
    generation: Number.isInteger(record.year_from) ? String(record.year_from) : null,
    year: Number.isInteger(record.year_from) ? record.year_from : null,
    category,
    subCategory: null,
    active: record.active_2026 === true,
    bagEligible: record.bag_eligible === true,
    fitEligible: false,
    handedness: [],
    lofts: [],
    variants: [],
    standardLength: null,
    lie: null,
    headVolume: null,
    setMakeup: null,
    stockShafts: [],
    stockFlexes: [],
    officialUrl: provenance.sourceType === "OEM_OFFICIAL" ? provenance.sourceUrl : null,
    sourceName: provenance.sourceName,
    sourceUrl: provenance.sourceUrl,
    sourceCheckedAt: provenance.verifiedAt,
    sourceType: provenance.sourceType,
    confidence: provenance.confidence,
    license: provenance.license,
    provenance: [provenance],
    verifiedAt: provenance.verifiedAt,
    createdAt: null,
    updatedAt: null,
  };
}

function mapBall(record) {
  const provenance = source(record);
  const id = text(record.id, 240);
  const brand = text(record.brand, 120);
  const model = text(record.model, 180);
  if (!provenance || !id || !brand || !model) return null;
  const compression = Number.isFinite(record.compression) ? record.compression : null;
  const constructionPieces = Number.isInteger(record.construction_pieces) ? record.construction_pieces : null;
  const coverage = technicalCoverage(record);
  return {
    id,
    aliases: [],
    brand,
    model,
    generation: text(record.generation, 80) || (Number.isInteger(record.year_from) ? String(record.year_from) : null),
    year: Number.isInteger(record.year_from) ? record.year_from : null,
    active: record.active_2026 === true,
    bagEligible: record.bag_eligible === true,
    // The supplied master has 21 rows marked eligible without any technical
    // facts. Fail closed: those remain searchable but cannot enter fitting.
    fitEligible: record.fit_eligible === true && coverage >= 3,
    coverMaterial: text(record.cover_material, 180),
    construction: constructionPieces === null ? null : `${constructionPieces} piezas`,
    constructionPieces,
    compression,
    compressionType: compression === null
      ? "UNKNOWN"
      : provenance.sourceType === "OEM_OFFICIAL" ? "MANUFACTURER" : "INDEPENDENT_MEASURED",
    compressionSource: compression === null ? null : provenance.sourceName,
    compressionSourceUrl: compression === null ? null : provenance.sourceUrl,
    flight: null,
    driverSpin: QUALITATIVE.get(record.driver_spin) || null,
    ironSpin: QUALITATIVE.get(record.iron_spin) || null,
    shortGameSpin: QUALITATIVE.get(record.short_game_spin) || null,
    feel: QUALITATIVE.get(record.feel) || null,
    colors: colors(record.colors),
    priceTier: null,
    targetProfile: [],
    officialUrl: provenance.sourceType === "OEM_OFFICIAL" ? provenance.sourceUrl : null,
    sourceName: provenance.sourceName,
    sourceUrl: provenance.sourceUrl,
    sourceType: provenance.sourceType,
    confidence: provenance.confidence,
    license: provenance.license,
    provenance: [provenance],
    verifiedAt: provenance.verifiedAt,
    createdAt: provenance.verifiedAt,
    updatedAt: provenance.verifiedAt,
  };
}

function envelope(value, expectedKind) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.scope !== "2010-2026 major commercial models" || !Array.isArray(value.models)) {
    throw new Error(`El master ${expectedKind} no cumple el contrato esperado.`);
  }
  return value;
}

export async function importEquipmentMaster(sourceDirectory, outputFile = DEFAULT_OUTPUT) {
  const sourceRoot = resolve(sourceDirectory);
  const clubsSource = envelope(JSON.parse(await readFile(resolve(sourceRoot, CLUB_FILE), "utf8")), "CLUBS_2010_2026");
  const ballsSource = envelope(JSON.parse(await readFile(resolve(sourceRoot, BALL_FILE), "utf8")), "BALLS_2010_2026");
  if (clubsSource.models.length < 1_000 || ballsSource.models.length < 250) {
    throw new Error("El paquete parece incompleto por sus conteos de registros.");
  }
  const clubs = clubsSource.models.map(mapClub).filter(Boolean);
  const balls = ballsSource.models.map(mapBall).filter(Boolean);
  const output = resolve(outputFile);
  const snapshot = {
    schemaVersion: 1,
    sourcePackage: "backyard_equipment_catalog_package_2010_2026.zip",
    sourceSha256: "570D46614DB1213E71EF126710C736A7B3876EBFB28B95523F0AC59AD3D1BD36",
    generatedAt: clubsSource.generatedAt || ballsSource.generatedAt || null,
    importedAt: "2026-09-10T00:00:00.000Z",
    sourceCounts: { clubs: clubsSource.models.length, balls: ballsSource.models.length },
    acceptedCounts: { clubs: clubs.length, balls: balls.length },
    rejectedCounts: { clubs: clubsSource.models.length - clubs.length, balls: ballsSource.models.length - balls.length },
    clubs,
    balls,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

async function main() {
  const sourceDirectory = process.argv[2];
  if (!sourceDirectory) throw new Error("Uso: node scripts/import-equipment-master-2010-2026.mjs <directorio-fuente> [salida]");
  const snapshot = await importEquipmentMaster(sourceDirectory, process.argv[3]);
  process.stdout.write(`${JSON.stringify({ sourceCounts: snapshot.sourceCounts, acceptedCounts: snapshot.acceptedCounts, rejectedCounts: snapshot.rejectedCounts })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
