import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SOURCE = "https://forgiving.golf/api/v1/latest.json";
const DEFAULT_OUTPUT = "data/forgiving-golf-equipment.snapshot.json";
const LICENSE = "CC BY 4.0";
const TYPE_MAP = new Map([
  ["driver", "DRIVER"],
  ["fairway", "FAIRWAY_WOOD"],
  ["hybrid", "HYBRID"],
  ["iron-set", "IRON_SET"],
  ["putter", "PUTTER"],
]);

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null;
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function brandName(value) {
  const normalized = text(value);
  if (normalized === "Cleveland Golf") return "Cleveland";
  if (normalized === "L.A.B. Golf") return "LAB Golf";
  return normalized;
}

function handedness(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => item === "RH" || item === "LH"))];
}

function flex(value) {
  const map = { L: "LADIES", A: "SENIOR", SR: "SENIOR", R: "REGULAR", S: "STIFF", X: "X_STIFF", TX: "TX" };
  const rows = Array.isArray(value) ? value : [];
  return [...new Set(rows.map((item) => map[String(item).toUpperCase()]).filter(Boolean))];
}

function numericLofts(record, category) {
  if (!["DRIVER", "FAIRWAY_WOOD", "HYBRID"].includes(category)) return [];
  const values = Array.isArray(record.loft_options) ? record.loft_options : [];
  return [...new Set(values.flatMap((value) => {
    if (typeof value === "number" && Number.isFinite(value)) return [value];
    const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)(?:°|\s|$)/);
    return match ? [Number(match[1])] : [];
  }).filter((value) => value >= 0 && value <= 40))].sort((a, b) => a - b);
}

function newestSourceDate(record, fallback) {
  const dates = (Array.isArray(record.sources) ? record.sources : []).map((source) => text(source?.read_at)).filter(Boolean).sort();
  return dates.at(-1) || text(record.price_read_at) || fallback;
}

function mapRecord(record, generatedAt) {
  const category = TYPE_MAP.get(record?.type);
  const brand = brandName(record?.brand);
  const model = text(record?.model);
  const externalId = text(record?.id);
  const hands = handedness(record?.hand);
  const officialUrl = httpsUrl(record?.official_url);
  const verifiedAt = newestSourceDate(record, generatedAt);
  if (!category || !brand || !model || !externalId || !hands.length || !officialUrl || !verifiedAt) return null;
  const stockShafts = [...new Set([
    ...(Array.isArray(record?.shafts?.steel) ? record.shafts.steel : []),
    ...(Array.isArray(record?.shafts?.graphite) ? record.shafts.graphite : []),
  ].map(text).filter(Boolean))];
  const stockFlexes = flex(record?.shafts?.flexes);
  const lofts = numericLofts(record, category);
  return {
    id: `forgiving-golf-${externalId}`,
    externalId,
    brand,
    model,
    generation: null,
    year: Number.isInteger(record.year) ? record.year : null,
    category,
    subCategory: text(record.category),
    active: true,
    handedness: hands,
    lofts,
    variants: lofts.map((loft) => ({ loft, handedness: hands })),
    standardLength: null,
    lie: null,
    headVolume: null,
    setMakeup: text(record.set_composition),
    stockShafts,
    stockFlexes,
    officialUrl,
    sourceName: "forgiving.golf · fabricante",
    sourceUrl: officialUrl,
    sourceCheckedAt: verifiedAt,
    verifiedAt,
    license: LICENSE,
    createdAt: null,
    updatedAt: null,
  };
}

export function normalizeForgivingGolfPayload(payload, importedAt = new Date().toISOString()) {
  const data = payload?.data;
  if (payload?.meta?.data_status !== "ok" || data?.dataset !== "forgiving-golf-clubs" || data?.schema_version !== "1.0" || !Array.isArray(data.records)) {
    throw new Error("forgiving.golf devolvió un dataset no compatible");
  }
  const generatedAt = text(data.generated_at);
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error("forgiving.golf no incluyó generated_at válido");
  const models = data.records.map((record) => mapRecord(record, generatedAt)).filter(Boolean);
  return {
    schemaVersion: 1,
    source: "forgiving.golf",
    sourceUrl: DEFAULT_SOURCE,
    attributionUrl: "https://forgiving.golf/data",
    license: LICENSE,
    generatedAt,
    importedAt,
    sourceCount: data.records.length,
    supportedCount: models.length,
    models,
  };
}

async function loadSource(source) {
  if (/^https:\/\//i.test(source)) {
    const response = await fetch(source, { headers: { accept: "application/json", "user-agent": "TheBackyard-CatalogImporter/1.0" } });
    if (!response.ok) throw new Error(`No se pudo leer ${source}: HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(resolve(source), "utf8"));
}

async function main() {
  const source = process.argv[2] || DEFAULT_SOURCE;
  const output = resolve(process.argv[3] || DEFAULT_OUTPUT);
  const snapshot = normalizeForgivingGolfPayload(await loadSource(source));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  process.stdout.write(`Imported ${snapshot.supportedCount}/${snapshot.sourceCount} supported records to ${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
