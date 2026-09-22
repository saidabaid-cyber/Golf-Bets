import "server-only";

import { publicationIsEffective } from "./admin-control-center";
import { createInternalEquipmentCatalogProvider } from "./equipment-catalog-provider";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "./golf-equipment-catalog";
import type { GolfBallCatalog, GolfClubCatalog, GolfShaftCatalog } from "./golf-equipment";
import { mergePublishedCatalog } from "./layered-catalog";
import { readPublishedCatalog } from "./admin-published-catalog.server";

/** Server-only seed loader. Client components know only the HTTP contract. */
export const internalEquipmentCatalogProvider = createInternalEquipmentCatalogProvider({
  balls: golfBallCatalog,
  clubs: golfClubCatalog,
  shafts: golfShaftCatalog,
});

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function common(value: Record<string, unknown>) {
  if (typeof value.id !== "string" || typeof value.brand !== "string" || typeof value.model !== "string") return null;
  return {
    ...value,
    id: value.id,
    aliases: stringArray(value.aliases),
    brand: value.brand,
    model: value.model,
    generation: typeof value.generation === "string" ? value.generation : null,
    year: typeof value.year === "number" ? value.year : null,
    active: value.active !== false,
    bagEligible: value.bagEligible !== false,
    fitEligible: value.fitEligible === true,
    sourceName: typeof value.sourceName === "string" ? value.sourceName : "Admin verificado",
    sourceUrl: typeof value.sourceUrl === "string" ? value.sourceUrl : null,
    sourceType: typeof value.sourceType === "string" ? value.sourceType : "ADMIN_RESEARCH",
    confidence: typeof value.confidence === "string" ? value.confidence : null,
    license: typeof value.license === "string" ? value.license : null,
    provenance: Array.isArray(value.provenance) ? value.provenance : [],
    verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : new Date(0).toISOString(),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function ball(value: unknown): GolfBallCatalog | null {
  const row = object(value); const base = row && common(row); if (!row || !base) return null;
  return {
    ...base,
    coverMaterial: typeof row.coverMaterial === "string" ? row.coverMaterial : null,
    construction: typeof row.construction === "string" ? row.construction : null,
    constructionPieces: typeof row.constructionPieces === "number" ? row.constructionPieces : null,
    compression: typeof row.compression === "number" ? row.compression : null,
    compressionType: typeof row.compressionType === "string" ? row.compressionType as GolfBallCatalog["compressionType"] : "UNKNOWN",
    compressionSource: typeof row.compressionSource === "string" ? row.compressionSource : null,
    compressionSourceUrl: typeof row.compressionSourceUrl === "string" ? row.compressionSourceUrl : null,
    flight: typeof row.flight === "string" ? row.flight as GolfBallCatalog["flight"] : null,
    driverSpin: typeof row.driverSpin === "string" ? row.driverSpin as GolfBallCatalog["driverSpin"] : null,
    ironSpin: typeof row.ironSpin === "string" ? row.ironSpin as GolfBallCatalog["ironSpin"] : null,
    shortGameSpin: typeof row.shortGameSpin === "string" ? row.shortGameSpin as GolfBallCatalog["shortGameSpin"] : null,
    feel: typeof row.feel === "string" ? row.feel as GolfBallCatalog["feel"] : null,
    colors: stringArray(row.colors),
    priceTier: typeof row.priceTier === "string" ? row.priceTier as GolfBallCatalog["priceTier"] : null,
    targetProfile: stringArray(row.targetProfile),
    officialUrl: typeof row.officialUrl === "string" ? row.officialUrl : null,
    createdAt: base.createdAt || new Date(0).toISOString(),
    updatedAt: base.updatedAt || new Date(0).toISOString(),
  };
}

function club(value: unknown): GolfClubCatalog | null {
  const row = object(value); const base = row && common(row); if (!row || !base || typeof row.category !== "string") return null;
  return {
    ...base,
    externalId: typeof row.externalId === "string" ? row.externalId : null,
    category: row.category as GolfClubCatalog["category"],
    subCategory: typeof row.subCategory === "string" ? row.subCategory : null,
    handedness: stringArray(row.handedness) as GolfClubCatalog["handedness"],
    lofts: numberArray(row.lofts),
    variants: Array.isArray(row.variants) ? row.variants as GolfClubCatalog["variants"] : [],
    standardLength: typeof row.standardLength === "number" ? row.standardLength : null,
    lie: typeof row.lie === "number" ? row.lie : null,
    headVolume: typeof row.headVolume === "number" ? row.headVolume : null,
    setMakeup: typeof row.setMakeup === "string" ? row.setMakeup : null,
    stockShafts: stringArray(row.stockShafts),
    stockFlexes: stringArray(row.stockFlexes) as GolfClubCatalog["stockFlexes"],
    officialUrl: typeof row.officialUrl === "string" ? row.officialUrl : null,
    sourceCheckedAt: typeof row.sourceCheckedAt === "string" ? row.sourceCheckedAt : null,
  };
}

function shaft(value: unknown): GolfShaftCatalog | null {
  const row = object(value); const base = row && common(row); if (!row || !base) return null;
  return {
    ...base,
    usage: typeof row.usage === "string" ? row.usage as GolfShaftCatalog["usage"] : null,
    oemStockOrAftermarket: typeof row.oemStockOrAftermarket === "string" ? row.oemStockOrAftermarket as GolfShaftCatalog["oemStockOrAftermarket"] : null,
    weightOptions: numberArray(row.weightOptions),
    flexOptions: stringArray(row.flexOptions),
    weight: typeof row.weight === "number" ? row.weight : null,
    flex: stringArray(row.flex) as GolfShaftCatalog["flex"],
    launch: typeof row.launch === "string" ? row.launch as GolfShaftCatalog["launch"] : null,
    spin: typeof row.spin === "string" ? row.spin as GolfShaftCatalog["spin"] : null,
    material: typeof row.material === "string" ? row.material : null,
    torqueRange: numberArray(row.torqueRange),
    torque: typeof row.torque === "number" ? row.torque : null,
    tipDiameter: typeof row.tipDiameter === "number" ? row.tipDiameter : null,
    buttDiameter: typeof row.buttDiameter === "number" ? row.buttDiameter : null,
    officialUrl: typeof row.officialUrl === "string" ? row.officialUrl : null,
  };
}

/** Admin Published DB overlays the versioned seed. Drafts never enter this path. */
export async function loadLayeredEquipmentCatalogs() {
  const seed = { balls: golfBallCatalog, clubs: golfClubCatalog, shafts: golfShaftCatalog };
  const published = await readPublishedCatalog(["BALL", "CLUB_EQUIPMENT", "SHAFT"]);
  const balls: GolfBallCatalog[] = [];
  const clubs: GolfClubCatalog[] = [];
  const shafts: GolfShaftCatalog[] = [];
  const now = new Date().toISOString();
  const byIdentity = new Map<string, PublishedRow[]>();
  type PublishedRow = (typeof published)[number];
  for (const revision of published) {
    const key = `${revision.entity_type}:${revision.entity_id}`;
    byIdentity.set(key, [...(byIdentity.get(key) || []), revision]);
  }
  const selected = [...byIdentity.values()].flatMap((revisions) => {
    const effective = [...revisions].reverse().find((revision) => revision.status === "PUBLISHED" && publicationIsEffective({ effectiveFrom: revision.effective_from, effectiveUntil: revision.effective_until }, now));
    if (effective) return [{ ...effective, historical: false }];
    const historical = [...revisions].reverse().find((revision) => !revision.effective_from || Date.parse(revision.effective_from) <= Date.parse(now));
    return historical ? [{ ...historical, historical: true }] : [];
  });
  for (const revision of selected) {
    const payload = revision.historical && revision.payload && typeof revision.payload === "object" ? { ...revision.payload as Record<string, unknown>, active: false } : revision.payload;
    if (revision.entity_type === "BALL") { const item = ball(payload); if (item) balls.push(item); }
    else if (revision.entity_type === "CLUB_EQUIPMENT") { const item = club(payload); if (item) clubs.push(item); }
    else { const item = shaft(payload); if (item) shafts.push(item); }
  }
  if (!balls.length && !clubs.length && !shafts.length) return seed;
  return {
    balls: mergePublishedCatalog(golfBallCatalog, balls),
    clubs: mergePublishedCatalog(golfClubCatalog, clubs),
    shafts: mergePublishedCatalog(golfShaftCatalog, shafts),
  };
}

/** Admin Published DB overlays the versioned seed. Drafts never enter this path. */
export async function getEquipmentCatalogProvider() {
  const catalogs = await loadLayeredEquipmentCatalogs();
  const isSeed = catalogs.balls === golfBallCatalog && catalogs.clubs === golfClubCatalog && catalogs.shafts === golfShaftCatalog;
  return isSeed ? internalEquipmentCatalogProvider : createInternalEquipmentCatalogProvider(catalogs, "admin-published+versioned-seed");
}
