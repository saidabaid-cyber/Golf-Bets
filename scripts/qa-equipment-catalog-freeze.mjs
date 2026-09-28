import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Compile with `node node_modules/typescript/bin/tsc -p tsconfig.test.json` first.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const {
  canonicalBallIdentity,
  canonicalClubIdentity,
  canonicalShaftIdentity,
  golfBallCatalog,
  golfClubCatalog,
  golfShaftCatalog,
} = require("../.test-dist/lib/golf-equipment-catalog.js");
const { createInternalEquipmentCatalogProvider } = require("../.test-dist/lib/equipment-catalog-provider.js");
const { equipmentAliasRegistry } = require("../.test-dist/lib/equipment-catalog-aliases.js");
const { isPublicEquipmentCatalogItem } = require("../.test-dist/lib/equipment-catalog-visibility.js");

const baselineFile = path.join(root, "data/qa/equipment-catalog-freeze-baseline-2026-09-27.json");
const closeoutFile = path.join(root, "data/qa/equipment-catalog-freeze-closeout-2026-09-27.json");
const originalAuditFile = path.join(root, "data/qa/equipment-gaps.json");
const mode = process.argv[2];
if (!["--capture-baseline", "--write", "--check"].includes(mode)) {
  throw new Error("Usage: node scripts/qa-equipment-catalog-freeze.mjs --capture-baseline|--write|--check");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function serialize(value) {
  return JSON.stringify(stableJson(value), null, 2) + "\n";
}

if (mode === "--capture-baseline") {
  if (existsSync(baselineFile)) throw new Error("FREEZE_BASELINE_ALREADY_EXISTS");
  const audit = JSON.parse(readFileSync(originalAuditFile, "utf8"));
  const kinds = { balls: "BALL", clubs: "CLUB", shafts: "SHAFT" };
  const records = Object.fromEntries(Object.entries(kinds).map(([auditKind, kind]) => [kind,
    audit.records.filter((row) => row.kind === auditKind).map((row) => ({
      id: row.id,
      brand: row.brand,
      model: row.model,
      active: row.active,
    })).sort((left, right) => left.id.localeCompare(right.id)),
  ]));
  const baseline = {
    schemaVersion: 1,
    capturedFromCommit: "a6daa6832ac618246dde68e32c0df4cebc4da873",
    capturedFromCatalogDigest: audit.catalogDigest,
    capturedAt: "2026-09-27T00:00:00.000Z",
    source: "data/qa/equipment-gaps.json checked against the runtime before catalog freeze changes",
    summary: audit.summary,
    records,
  };
  writeFileSync(baselineFile, serialize(baseline));
  console.log(JSON.stringify({ status: "PASS", mode: "capture-baseline", file: path.relative(root, baselineFile), counts: Object.fromEntries(Object.entries(records).map(([kind, rows]) => [kind, rows.length])) }));
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
const catalogs = { BALL: golfBallCatalog, CLUB: golfClubCatalog, SHAFT: golfShaftCatalog };
const identity = { BALL: canonicalBallIdentity, CLUB: canonicalClubIdentity, SHAFT: canonicalShaftIdentity };
const provider = createInternalEquipmentCatalogProvider({ balls: golfBallCatalog, clubs: golfClubCatalog, shafts: golfShaftCatalog });
const marker = /synthetic|(?:^|\W)qa(?:\W|$)|fixture|(?:^|\W)test(?:\W|$)|internal qa|(?:^|\W)fake(?:\W|$)|(?:^|\W)mock(?:\W|$)/i;
const pinnedIds = [
  "titleist-pro-v1x-left-dash",
  "callaway-apex-pro-21-iron-set-2021",
  "callaway-paradym-triple-diamond-fairway-fairway-2023",
  "lab-golf-oz1i-putter-2025",
  "taylormade-milled-grind-4-wedge-2023",
  "taylormade-qi4d-driver-2026",
  "titleist-gt2-driver-2024",
  "titleist-vokey-sm11-wedge-2026",
  "fujikura-ventus-blue-velocore-plus-unversioned",
  "graphite-design-tour-ad-f-series-fairway-2015",
  "nippon-shaft-n-s-pro-modus3-wedge-wedge-2017",
  "nippon-shaft-n-s-pro-regio-formula-b-plus-wood-2018",
  "project-x-project-x-ls-iron-2020",
];

function duplicates(rows, key) {
  const grouped = new Map();
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) || []), row.id]);
  return [...grouped.entries()].filter(([, ids]) => ids.length > 1).map(([value, ids]) => ({ identity: value, ids }));
}

const result = {
  schemaVersion: 1,
  status: "PASS",
  baselineCommit: baseline.capturedFromCommit,
  baselineCatalogDigest: baseline.capturedFromCatalogDigest,
  provider: provider.id,
  generatedAt: "2026-09-27T00:00:00.000Z",
  aliases: {
    registryVersion: equipmentAliasRegistry.schemaVersion,
    brandMappings: equipmentAliasRegistry.brandAliases,
    itemMappings: equipmentAliasRegistry.itemAliases,
  },
  catalogs: {},
  savedReferenceIds: {
    source: "Aggregate, non-PII catalog IDs observed in Supabase QA player_equipment_profiles on 2026-09-27",
    checked: pinnedIds,
    unresolved: pinnedIds.filter((id) => !Object.values(catalogs).some((rows) => rows.some((row) => row.id === id || row.aliases.includes(id)))),
  },
  requiredSearches: {},
};

for (const [kind, rows] of Object.entries(catalogs)) {
  const beforeRows = baseline.records[kind];
  const beforeIds = new Set(beforeRows.map((row) => row.id));
  // Semantic dedupe may move a legacy stable ID into the canonical row's
  // aliases. That ID is still resolvable by the runtime provider and must not
  // be reported as removed from saved bags or historical snapshots.
  const afterResolvableIds = new Set(rows.flatMap((row) => [row.id, ...row.aliases]));
  const duplicateIds = duplicates(rows, (row) => row.id);
  const duplicateIdentities = duplicates(rows, identity[kind]);
  const internalRows = rows.filter((row) => marker.test([row.id, row.brand, row.model, row.sourceName, row.sourceType].filter(Boolean).join(" ")) || !isPublicEquipmentCatalogItem(row));
  const provenanceInsufficient = rows.filter((row) => !row.brand.trim() || !row.model.trim() || !row.sourceName || !row.verifiedAt || !(row.officialUrl || row.sourceUrl));
  result.catalogs[kind] = {
    before: {
      total: beforeRows.length,
      current: beforeRows.filter((row) => row.active).length,
      legacy: beforeRows.filter((row) => !row.active).length,
      brands: [...new Set(beforeRows.map((row) => row.brand))].sort(),
    },
    after: {
      total: rows.length,
      current: rows.filter((row) => row.active).length,
      legacy: rows.filter((row) => !row.active).length,
      brands: [...new Set(rows.map((row) => row.brand))].sort(),
      catalogAliasCount: rows.reduce((sum, row) => sum + row.aliases.length, 0),
    },
    added: rows.filter((row) => !beforeIds.has(row.id)).map((row) => ({ id: row.id, brand: row.brand, model: row.model, active: row.active })).sort((left, right) => left.id.localeCompare(right.id)),
    removed: beforeRows.filter((row) => !afterResolvableIds.has(row.id)).map((row) => row.id).sort(),
    duplicateIds,
    duplicateIdentities,
    internalRows,
    provenanceInsufficient: provenanceInsufficient.map((row) => row.id),
    catalogDigest: sha256(serialize(rows.map((row) => ({ id: row.id, aliases: row.aliases, brand: row.brand, model: row.model, generation: row.generation, year: row.year, active: row.active })) )),
  };
}

for (const [kind, query] of [["CLUB", "Honma"], ["CLUB", "Takomo"], ["SHAFT", "Veylix"], ["SHAFT", "Paderson"], ["SHAFT", "Paderson Kinetixx"], ["BALL", "Top-Flite"], ["BALL", "Noodle"]]) {
  const page = await provider.search({ kind, query, includeArchived: true, limit: 50 });
  result.requiredSearches[`${kind}:${query}`] = page.items.map((row) => row.id);
}

const failures = [];
for (const [kind, catalog] of Object.entries(result.catalogs)) {
  if (catalog.removed.length) failures.push(`${kind}:BASELINE_ID_REMOVED`);
  if (catalog.duplicateIds.length) failures.push(`${kind}:DUPLICATE_ID`);
  if (catalog.duplicateIdentities.length) failures.push(`${kind}:DUPLICATE_IDENTITY`);
  if (catalog.internalRows.length) failures.push(`${kind}:INTERNAL_ROW_VISIBLE`);
  if (catalog.provenanceInsufficient.length) failures.push(`${kind}:PROVENANCE_INSUFFICIENT`);
}
if (result.savedReferenceIds.unresolved.length) failures.push("SAVED_REFERENCE_UNRESOLVED");
if (Object.values(result.requiredSearches).some((ids) => ids.length === 0)) failures.push("REQUIRED_ALIAS_OR_BRAND_SEARCH_EMPTY");
if (golfShaftCatalog.filter((row) => row.model === "VENTUS Blue VeloCore+").length === 0
  || golfShaftCatalog.filter((row) => row.model === "VENTUS Blue VeloCore").length === 0) failures.push("PLUS_GENERATION_COLLAPSED");
for (const model of ["Xtreme Tour", "Xtreme Tour X"]) {
  if (golfBallCatalog.filter((row) => row.brand === "PXG" && row.model === model).length !== 1) failures.push(`PXG_${model}_COUNT`);
}
result.failures = failures;
result.status = failures.length ? "FAIL" : "PASS";
const content = serialize(result);
if (mode === "--write") writeFileSync(closeoutFile, content);
else if (!existsSync(closeoutFile) || readFileSync(closeoutFile, "utf8").replaceAll("\r\n", "\n") !== content) throw new Error("STALE_EQUIPMENT_FREEZE_AUDIT");
if (failures.length) throw new Error(failures.join(","));
console.log(JSON.stringify({ status: result.status, mode: mode.slice(2), file: path.relative(root, closeoutFile), counts: Object.fromEntries(Object.entries(result.catalogs).map(([kind, catalog]) => [kind, catalog.after])) }));
