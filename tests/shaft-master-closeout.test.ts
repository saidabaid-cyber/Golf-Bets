import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captureClubChoices } from "../lib/bag-capture";
import { createInternalEquipmentCatalogProvider } from "../lib/equipment-catalog-provider";
import {
  canonicalShaftIdentity,
  fitEligibleGolfShafts,
  golfBallCatalog,
  golfClubCatalog,
  golfCatalogDiagnostics,
  golfShaftCatalog,
} from "../lib/golf-equipment-catalog";
import { normalizePlayerClub, type GolfShaftCatalog } from "../lib/golf-equipment";
import { startShot } from "../features/shots/domain";

const provider = createInternalEquipmentCatalogProvider({ balls: golfBallCatalog, clubs: golfClubCatalog, shafts: golfShaftCatalog });
const master = JSON.parse(readFileSync("data/backyard-shaft-master-2010-2026.snapshot.json", "utf8")) as {
  sourcePackage: string;
  packageSha256: string;
  sourceSha256: string;
  sourceCount: number;
  acceptedCount: number;
  rejectedCount: number;
  declaredFitEligibleCount: number;
  acceptedFitEligibleCount: number;
  models: GolfShaftCatalog[];
};

async function search(query: string, extra: Partial<Parameters<typeof provider.search>[0]> = {}) {
  const page = await provider.search({ kind: "SHAFT", query, includeArchived: true, limit: 50, ...extra });
  return page.items.filter((item): item is GolfShaftCatalog => "weightOptions" in item);
}

function shaft(model: string, generation?: string) {
  return golfShaftCatalog.find((item) => item.model === model && (!generation || item.generation === generation));
}

test("el snapshot 2010–2026 conserva el paquete completo y falla cerrado para fitting", () => {
  assert.equal(master.sourcePackage, "backyard_shaft_catalog_package_2010_2026.zip");
  assert.match(master.packageSha256, /^[A-F0-9]{64}$/);
  assert.match(master.sourceSha256, /^[A-F0-9]{64}$/);
  assert.equal(master.sourceCount, 467);
  assert.equal(master.acceptedCount, 467);
  assert.equal(master.rejectedCount, 0);
  assert.equal(master.declaredFitEligibleCount, 80);
  assert.equal(master.acceptedFitEligibleCount, 80);
  assert.ok(master.models.every((item) => item.bagEligible));
  assert.ok(master.models.filter((item) => item.fitEligible).every((item) => item.weightOptions.length > 0
    && item.flexOptions.length > 0 && item.launch !== null && item.spin !== null && item.provenance.length > 0));
});

test("merge conserva IDs existentes, agrega alias y no degrada evidencia", () => {
  assert.equal(golfCatalogDiagnostics.shafts.sourceModels, 515);
  assert.equal(golfCatalogDiagnostics.shafts.masterSourceModels, 467);
  assert.equal(golfCatalogDiagnostics.shafts.masterAcceptedModels, 467);
  assert.equal(golfCatalogDiagnostics.shafts.masterRejectedModels, 0);
  assert.equal(golfCatalogDiagnostics.shafts.usableModels, 474);
  assert.equal(golfCatalogDiagnostics.shafts.aliases, 41);
  const merged = golfShaftCatalog.find((item) => item.id === "fujikura-ventus-blue-velocore-plus-unversioned");
  assert.ok(merged);
  assert.ok(merged.aliases.some((id) => id.includes("2026-CURRENT")));
  assert.equal(merged.launch, "MID", "el dato OEM verificado existente conserva prioridad");
  assert.equal(merged.spin, "LOW");
  assert.ok(merged.flexOptions.includes("R2") && merged.flexOptions.includes("TX"), "el master completa nomenclatura exacta");
  assert.ok(merged.sourceUrl && merged.provenance.length >= 2);
});

test("dedupe conserva generaciones y variantes funcionalmente distintas", () => {
  const identities = golfShaftCatalog.map(canonicalShaftIdentity);
  assert.equal(new Set(identities).size, identities.length);
  assert.ok(shaft("VENTUS Blue VeloCore", "2019"));
  assert.ok(shaft("VENTUS Blue VeloCore+", "2026-CURRENT"));
  assert.ok(shaft("HZRDUS Black", "2016"));
  assert.ok(shaft("HZRDUS Black Gen 4", "2023"));
  assert.ok(shaft("HZRDUS Gen 5 Black", "2026-CURRENT"));
  assert.ok(shaft("Tour AD DI", "2010"));
  assert.ok(shaft("Tour AD DI", "2026-CURRENT"));
  assert.notEqual(shaft("VENTUS Blue VeloCore", "2019")?.id, shaft("VENTUS Blue VeloCore+", "2026-CURRENT")?.id);
});

test("nomenclaturas manufactureras y OEM stock permanecen exactas", () => {
  assert.ok(shaft("HZRDUS Black Gen 4", "2026-CURRENT")?.flexOptions.includes("5.5"));
  assert.ok(shaft("Helium NCT", "2026")?.flexOptions.includes("F4"));
  assert.ok(shaft("TZ5", "2026-CURRENT")?.flexOptions.includes("M4"));
  assert.ok(shaft("AutoFlex Original Driver", "2026-CURRENT")?.flexOptions.includes("SF505"));
  const alta = shaft("Alta CB 55", "2017");
  assert.equal(alta?.oemStockOrAftermarket, "OEM_STOCK");
  assert.equal(alta?.fitEligible, false);
});

test("buscador server-side encuentra familias actuales e históricas por peso y flex", async () => {
  for (const query of [
    "Ventus Blue 6S", "Ventus Blue Velocore+", "Ventus TR Blue", "Tour AD DI 6S", "Tour AD UB",
    "HZRDUS Black G4 60", "HZRDUS Black G5", "Denali Blue", "Tensei 1K Pro Blue", "Diamana GT",
    "KBS Tour", "KBS C-Taper", "Modus 105", "Modus 120", "SteelFiber i95", "Recoil DART",
    "Aldila Rogue", "ACCRA TZ5", "ACCRA TZ6", "AutoFlex SF505", "LA Golf A-Series",
    "Motore F1", "Speeder Evolution II", "Diamana S+", "TENSEI CK Pro Orange", "HZRDUS Yellow",
    "EvenFlow Blue", "Project X PXi", "Tour AD BB", "Tour AD GT", "Aldila Tour Green", "Rogue Silver 125",
  ]) assert.ok((await search(query)).length > 0, `${query} debe ser buscable`);
});

test("paginación es estable, no repite filas y filtra usage sin cargar todo", async () => {
  assert.ok(golfShaftCatalog.every((item) => item.usage !== null), "cada varilla debe tener uso explícito");
  assert.equal(golfShaftCatalog.find((item) => item.id === "mitsubishi-diamana-wb")?.usage, "WOOD");
  assert.equal(golfShaftCatalog.find((item) => item.id === "kbs-max-graphite-iron")?.usage, "IRON");
  const first = await provider.search({ kind: "SHAFT", query: "", limit: 20 });
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  const second = await provider.search({ kind: "SHAFT", query: "", cursor: first.nextCursor, limit: 20 });
  assert.equal(second.items.length, 20);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 40);
  const putters = await search("", { shaftUsage: "PUTTER" });
  assert.ok(putters.length > 0 && putters.every((item) => item.usage === "PUTTER"));
  const historical = await search("SteelFiber i95");
  assert.ok(historical.some((item) => item.active === false && item.bagEligible));
});

test("fit_eligible excluye históricos incompletos pero Mi Bolsa mantiene visibilidad", () => {
  assert.equal(fitEligibleGolfShafts().length, 80);
  assert.ok(fitEligibleGolfShafts().every((item) => item.fitEligible && item.bagEligible && item.provenance.length > 0));
  const historical = shaft("SteelFiber i95", "2010");
  assert.ok(historical?.bagEligible);
  assert.equal(historical?.fitEligible, false);
  assert.equal(historical?.launch, null);
  assert.equal(historical?.spin, null);
});

test("varilla manual conserva peso/flex y el shot guarda snapshot inmutable", () => {
  const normalized = normalizePlayerClub({
    id: "club-1", userId: "owner", category: "DRIVER", catalogClubId: null,
    customBrand: "Mi marca", customModel: "Driver personal", handedness: "RH",
    shaftId: null, customShaftBrand: "Project X", customShaftModel: "Modelo personal",
    customShaft: "Project X Modelo personal", flex: null, shaftFlexLabel: "5.5", shaftWeightGrams: 62,
    isCurrent: true, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z",
  }, "owner");
  assert.ok(normalized);
  assert.equal(normalized.shaftFlexLabel, "5.5");
  assert.equal(normalized.shaftWeightGrams, 62);
  const choice = captureClubChoices(normalized)[0];
  assert.equal(choice.shaft?.source, "USER_ENTERED");
  const shot = startShot({
    id: "shot-1", roundId: "round-1", playerId: "owner", hole: 1,
    clubId: choice.id, clubLabel: choice.label, category: choice.category || undefined,
    model: choice.model || undefined,
    shaft: choice.shaft ? {
      ...(choice.shaft.brand ? { brand: choice.shaft.brand } : {}),
      ...(choice.shaft.model ? { model: choice.shaft.model } : {}),
      ...(choice.shaft.flex ? { flex: choice.shaft.flex } : {}),
      ...(choice.shaft.weightGrams !== null ? { weightGrams: choice.shaft.weightGrams } : {}),
      ...(choice.shaft.source ? { source: choice.shaft.source } : {}),
    } : null,
    startedAt: "2026-09-10T12:00:00.000Z", existing: [],
  });
  (choice.shaft as NonNullable<typeof choice.shaft>).model = "CAMBIADA";
  assert.equal(shot.clubSnapshot.shaft?.model, "Modelo personal");
  assert.equal(shot.clubSnapshot.shaft?.flex, "5.5");
  assert.equal(shot.clubSnapshot.shaft?.weightGrams, 62);
});

test("Mi Bolsa usa búsqueda progresiva, peso/flex exactos y conserva fallback manual", () => {
  const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");
  const hook = readFileSync("app/components/use-equipment-catalog-search.ts", "utf8");
  assert.match(editor, /Buscar varilla/);
  assert.match(editor, /shaftUsage/);
  assert.match(editor, /selectedShaft\.flexOptions/);
  assert.match(editor, /selectedShaft\.weightOptions/);
  assert.match(editor, /Mi varilla no aparece/);
  assert.match(editor, /shaftFlexLabel/);
  assert.match(hook, /setTimeout\(async \(\) =>/);
  assert.match(hook, /limit: "50"/);
  assert.doesNotMatch(hook, /backyard-shaft-master-2010-2026/);
});
