import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SOURCE = "backyard_shafts_2010_2026.json";
const DEFAULT_OUTPUT = "data/backyard-shaft-master-2010-2026.snapshot.json";
const EXPECTED_SCOPE = "2010-2026 commercially relevant shaft families; aftermarket plus selected OEM-stock references";
const USAGES = new Set(["WOOD", "FAIRWAY", "HYBRID", "UTILITY", "IRON", "WEDGE", "PUTTER"]);
const ORIGINS = new Set(["AFTERMARKET", "OEM_STOCK"]);
const QUALITATIVE = new Map([
  ["VERY_LOW", "VERY_LOW"],
  ["LOW", "LOW"],
  ["LOW_MID", "LOW"],
  ["MID_LOW", "LOW"],
  ["MID", "MID"],
  ["MID_HIGH", "HIGH"],
  ["HIGH_MID", "HIGH"],
  ["HIGH", "HIGH"],
  ["VERY_HIGH", "VERY_HIGH"],
  ["VARIABLE", "VARIABLE"],
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
  try {
    return normalized && new URL(normalized).protocol === "https:" ? normalized : null;
  } catch {
    return null;
  }
}

function list(value, maximumItems = 80) {
  const values = Array.isArray(value) ? value : text(value, 1_000)?.split(/[,;]+/) ?? [];
  const unique = new Map();
  for (const candidate of values) {
    const normalized = text(candidate, 80);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, normalized);
    if (unique.size >= maximumItems) break;
  }
  return [...unique.values()];
}

function numberList(value, minimum, maximum) {
  return [...new Set(list(value).flatMap((candidate) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? [parsed] : [];
  }))].sort((left, right) => left - right);
}

function numberRange(value, minimum, maximum) {
  const normalized = text(value, 100);
  if (!normalized) return [];
  const values = normalized.split(/\s*(?:-|–|—|to)\s*/i).map(Number);
  if (values.some((candidate) => !Number.isFinite(candidate) || candidate < minimum || candidate > maximum)) return [];
  return [...new Set(values)].sort((left, right) => left - right).slice(0, 2);
}

function source(record) {
  const sourceType = text(record.source_type, 80);
  const sourceName = text(record.source_name, 300);
  const sourceUrl = url(record.source_url);
  const verifiedAt = date(record.verified_at);
  if (!sourceType || !sourceName || !sourceUrl || !verifiedAt) return null;
  return {
    sourceType,
    sourceName,
    sourceUrl,
    verifiedAt,
    license: null,
    confidence: text(record.confidence, 40),
  };
}

function mapRecord(record) {
  const id = text(record?.id, 240);
  const brand = text(record?.brand, 120);
  const model = text(record?.model, 180);
  const usage = USAGES.has(record?.usage) ? record.usage : null;
  const origin = ORIGINS.has(record?.oem_stock_or_aftermarket) ? record.oem_stock_or_aftermarket : null;
  const provenance = source(record ?? {});
  const active = typeof record?.active_2026 === "boolean" ? record.active_2026 : null;
  const bagEligible = typeof record?.bag_eligible === "boolean" ? record.bag_eligible : null;
  const explicitFitEligible = typeof record?.fit_eligible === "boolean" ? record.fit_eligible : null;
  if (!id || !brand || !model || !usage || !origin || !provenance || active === null || bagEligible === null || explicitFitEligible === null) return null;

  const weightOptions = numberList(record.weight_options_g, 1, 300);
  const flexOptions = list(record.flex_options, 40);
  const launch = QUALITATIVE.get(text(record.launch_profile, 40)) ?? null;
  const spin = QUALITATIVE.get(text(record.spin_profile, 40)) ?? null;
  const torqueRange = numberRange(record.torque_range_deg, 0, 30);
  const tipDiameter = Number(record.tip_diameter_in);
  const technicalCoverage = weightOptions.length > 0 && flexOptions.length > 0 && launch !== null && spin !== null;

  return {
    id,
    aliases: [],
    brand,
    model,
    generation: text(record.generation, 100),
    year: Number.isInteger(record.year_from) && record.year_from >= 1900 && record.year_from <= 2200 ? record.year_from : null,
    usage,
    active,
    bagEligible,
    fitEligible: explicitFitEligible && technicalCoverage,
    oemStockOrAftermarket: origin,
    weightOptions,
    flexOptions,
    launch,
    spin,
    material: text(record.material, 120),
    torqueRange,
    tipDiameter: Number.isFinite(tipDiameter) && tipDiameter >= 0.1 && tipDiameter <= 2 ? tipDiameter : null,
    buttDiameter: null,
    officialUrl: provenance.sourceType === "OEM_OFFICIAL" || provenance.sourceType === "OEM_OFFICIAL_ARCHIVE"
      ? provenance.sourceUrl
      : null,
    sourceName: provenance.sourceName,
    sourceUrl: provenance.sourceUrl,
    sourceType: provenance.sourceType,
    confidence: provenance.confidence,
    license: provenance.license,
    provenance: [provenance],
    verifiedAt: provenance.verifiedAt,
    createdAt: null,
    updatedAt: null,
  };
}

function envelope(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.scope !== EXPECTED_SCOPE || !Array.isArray(value.models)) {
    throw new Error("El master de varillas no cumple el contrato esperado.");
  }
  if (value.models.length !== value.count || value.models.length < 450 || value.fitEligibleCount !== 80) {
    throw new Error("El paquete de varillas parece incompleto por sus conteos declarados.");
  }
  return value;
}

export async function importShaftMaster(sourceFile, outputFile = DEFAULT_OUTPUT) {
  const source = resolve(sourceFile || DEFAULT_SOURCE);
  const sourceBytes = await readFile(source);
  const sourceEnvelope = envelope(JSON.parse(sourceBytes.toString("utf8")));
  const models = sourceEnvelope.models.map(mapRecord).filter(Boolean);
  const ids = new Set(models.map((model) => model.id));
  if (ids.size !== models.length) throw new Error("El master contiene IDs de varilla duplicados.");
  const output = resolve(outputFile);
  const snapshot = {
    schemaVersion: 1,
    sourcePackage: "backyard_shaft_catalog_package_2010_2026.zip",
    packageSha256: "5D7A7D1A3FD834CBEE66CDFB1750F3ECDDF8822CEF62F9CC76E2F5804F79DBE2",
    sourceFile: "backyard_shafts_2010_2026.json",
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex").toUpperCase(),
    generatedAt: sourceEnvelope.generatedAt ?? null,
    importedAt: "2026-09-10T00:00:00.000Z",
    sourceCount: sourceEnvelope.models.length,
    acceptedCount: models.length,
    rejectedCount: sourceEnvelope.models.length - models.length,
    declaredFitEligibleCount: sourceEnvelope.fitEligibleCount,
    acceptedFitEligibleCount: models.filter((model) => model.fitEligible).length,
    models,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

async function main() {
  const sourceFile = process.argv[2];
  if (!sourceFile) throw new Error("Uso: node scripts/import-shaft-master-2010-2026.mjs <json-fuente> [salida]");
  const snapshot = await importShaftMaster(sourceFile, process.argv[3]);
  process.stdout.write(`${JSON.stringify({
    sourceCount: snapshot.sourceCount,
    acceptedCount: snapshot.acceptedCount,
    rejectedCount: snapshot.rejectedCount,
    acceptedFitEligibleCount: snapshot.acceptedFitEligibleCount,
    sourceSha256: snapshot.sourceSha256,
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
