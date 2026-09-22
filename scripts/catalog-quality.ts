import { createHash } from "node:crypto";
import type { GolfBallCatalog, GolfClubCatalog, GolfShaftCatalog } from "../lib/golf-equipment";

type Equipment = GolfBallCatalog | GolfClubCatalog | GolfShaftCatalog;
export type EquipmentInput = { clubs: readonly GolfClubCatalog[]; balls: readonly GolfBallCatalog[]; shafts: readonly GolfShaftCatalog[] };
export type CourseAuditSource = {
  projectRef: string; provider: string; observedAt?: string;
  clubs: { id: string; name: string; latitude: number | null; longitude: number | null; locationEvidence: { sourceUrl?: string; verifiedAt?: string; pointKind?: string } | null }[];
  courses: { id: string; clubId: string; name: string; sourceUrl: string | null; dataVersion: string | null }[];
  tees: { id: string; courseId: string; name: string; holeCount: number; qaStatus: string | null; qaErrors: string[] | null; ratingCategory: string | null; hasRating: boolean; hasSlope: boolean; sourceLimitation: string | null; supplementSourceUrl: string | null; supplementRatingCategory: string | null }[];
};

const compare = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const present = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
function uniqueIds(rows: readonly { id: string }[], label: string) {
  if (rows.some(row => !row.id) || new Set(rows.map(row => row.id)).size !== rows.length) throw Error(`INVALID_OR_DUPLICATE_ID:${label}`);
}
const reasons = {
  IMAGE_MISSING: "No source image URL; retain editorial placeholder.",
  IMAGE_LICENSE_UNVERIFIED: "Image exists but image-specific license or source attribution is absent. Catalog/data license does not establish image rights.",
  SPECS_UNKNOWN: "No technical values in the inspected fields. A verified identity timestamp is not specification evidence.",
  SPECS_UNVERIFIED: "Technical values exist without dated source provenance. Do not infer that the values are false; verification is missing.",
  SPECS_PARTIAL: "Some inspected technical fields are absent; absent values remain unknown, including category-specific not-applicable values.",
  SHAFT_WEIGHT_UNKNOWN: "Neither a scalar weight nor weight options exist.",
  SHAFT_FLEX_UNKNOWN: "Neither OEM flex options nor legacy flex categories exist.",
  WEDGE_LOFTS_UNKNOWN: "No loft or variant loft is available; keep explicit manual entry.",
  WEDGE_LOFTS_UNVERIFIED: "Lofts exist but dated source provenance is missing.",
};

function technicalFields(kind: keyof EquipmentInput): string[] {
  if (kind === "clubs") return ["lofts", "standardLength", "lie", "headVolume", "setMakeup", "stockShafts", "stockFlexes"];
  if (kind === "balls") return ["coverMaterial", "construction", "constructionPieces", "compression", "flight", "driverSpin", "ironSpin", "shortGameSpin", "feel"];
  return ["weightOptions", "flexOptions", "launch", "spin", "material", "torqueRange", "tipDiameter", "buttDiameter"];
}
function hasDatedProvenance(item: Equipment) {
  return item.provenance.some(source => /^https:\/\//.test(source.sourceUrl) && Boolean(source.verifiedAt));
}

export function buildEquipmentAudit(input: EquipmentInput) {
  const summary: Record<string, Record<string, number>> = {};
  const records = (Object.keys(input) as (keyof EquipmentInput)[]).sort().flatMap(kind => {
    const items = [...input[kind]].sort(compare);
    uniqueIds(items, kind);
    const counters: Record<string, number> = { total: items.length, active: 0, historical: 0, bagEligible: 0, fitEligible: 0, activeFitEligible: 0, withoutLicensedImage: 0, specsUnknown: 0, specsUnverified: 0, specsPartial: 0, shaftsWithoutWeight: 0, shaftsWithoutFlex: 0, wedgesWithoutVerifiedLofts: 0 };
    const rows = items.map(item => {
      counters[item.active ? "active" : "historical"]++;
      if (item.bagEligible) counters.bagEligible++;
      if (item.fitEligible) counters.fitEligible++;
      if (item.fitEligible && item.active) counters.activeFitEligible++;
      const fields = technicalFields(kind);
      const values = item as unknown as Record<string, unknown>;
      const missingFields = fields.filter(field => !present(values[field]));
      const traceable = hasDatedProvenance(item);
      const gaps: (keyof typeof reasons)[] = [];
      if (!item.imageUrl) gaps.push("IMAGE_MISSING");
      else if (!item.imageLicense || !item.imageSourceUrl) gaps.push("IMAGE_LICENSE_UNVERIFIED");
      if (gaps.length) counters.withoutLicensedImage++;
      if (missingFields.length === fields.length) { gaps.push("SPECS_UNKNOWN"); counters.specsUnknown++; }
      else if (!traceable) { gaps.push("SPECS_UNVERIFIED"); counters.specsUnverified++; }
      if (missingFields.length && missingFields.length < fields.length) { gaps.push("SPECS_PARTIAL"); counters.specsPartial++; }
      if (kind === "shafts") {
        const shaft = item as GolfShaftCatalog;
        if (!shaft.weightOptions.length && shaft.weight === null) { gaps.push("SHAFT_WEIGHT_UNKNOWN"); counters.shaftsWithoutWeight++; }
        if (!shaft.flexOptions.length && !shaft.flex.length) { gaps.push("SHAFT_FLEX_UNKNOWN"); counters.shaftsWithoutFlex++; }
      }
      if (kind === "clubs" && (item as GolfClubCatalog).category === "WEDGE") {
        const wedge = item as GolfClubCatalog;
        if (!wedge.lofts.length && !wedge.variants.length) { gaps.push("WEDGE_LOFTS_UNKNOWN"); counters.wedgesWithoutVerifiedLofts++; }
        else if (!traceable) { gaps.push("WEDGE_LOFTS_UNVERIFIED"); counters.wedgesWithoutVerifiedLofts++; }
      }
      return {
        id: item.id, kind, brand: item.brand, model: item.model, active: item.active,
        gaps, missingFields, datedCatalogProvenance: traceable,
        // These are catalog-level evidence references, never a claim of per-field verification.
        evidence: [...new Set(item.provenance.map(source => source.sourceUrl))].sort(),
      };
    });
    summary[kind] = counters;
    return rows.filter(row => row.gaps.length);
  });
  const catalogDigest = digest(Object.fromEntries((Object.keys(input) as (keyof EquipmentInput)[]).sort().map(kind => [kind, [...input[kind]].sort(compare)])));
  return { schemaVersion: 1, status: "PASS", scope: "Versioned normalized runtime catalog; no external fetch or DB mutation", provider: "lib/golf-equipment-catalog.ts", catalogDigest, definitions: { historical: "active === false, retained for existing references", licensedImage: "imageUrl + imageSourceUrl + imageLicense present; legal permission not independently adjudicated", verifiedSpecs: "No per-field verification flag exists. Reports distinguish absent facts from missing dated catalog provenance; traceability is not new verification.", partialSpecs: "Inventory of missing fields, not a claim that every field applies to every category" }, summary, reasons, records };
}

export function buildCourseAudit(source: CourseAuditSource) {
  if (source.projectRef !== "bymeopxkxapfizeeqeyb" || source.provider !== "OWNER_CATALOG_REVIEW") throw Error("COURSE_SOURCE_NOT_QA_OWNER_CATALOG");
  uniqueIds(source.clubs, "clubs"); uniqueIds(source.courses, "courses"); uniqueIds(source.tees, "tees");
  const clubs = [...source.clubs].sort(compare), courses = [...source.courses].sort(compare), tees = [...source.tees].sort(compare);
  const clubIds = new Set(clubs.map(row => row.id)), byCourse = new Map(courses.map(row => [row.id, row]));
  if (courses.some(row => !clubIds.has(row.clubId)) || tees.some(row => !byCourse.has(row.courseId))) throw Error("ORPHAN_CATALOG_REFERENCE");
  if (tees.some(row => !Number.isInteger(row.holeCount) || row.holeCount < 0)) throw Error("INVALID_HOLE_COUNT");
  // ReviewedTeeSource currently permits null only and reviewedTeeToCourse
  // always disables rating use. New categories need an explicit contract review.
  if (tees.some(row => row.ratingCategory !== null)) throw Error("RATING_CATEGORY_CONTRACT_REVIEW_REQUIRED");
  const located = (club: typeof clubs[number]) => club.latitude !== null && club.longitude !== null && Number.isFinite(club.latitude) && Number.isFinite(club.longitude) && Math.abs(club.latitude) <= 90 && Math.abs(club.longitude) <= 180 && Boolean(club.locationEvidence?.sourceUrl && club.locationEvidence.verifiedAt) && !/municipal|city_centroid/.test(club.locationEvidence?.pointKind ?? "");
  const missingLocation = clubs.filter(club => !located(club)).map(club => ({ id: club.id, name: club.name, reason: "LOCATION_EVIDENCE_MISSING", courseIds: courses.filter(course => course.clubId === club.id).map(course => course.id) }));
  const incomplete = tees.filter(tee => tee.holeCount !== 18).map(tee => ({ id: tee.id, courseId: tee.courseId, name: tee.name, holeCount: tee.holeCount, reason: "CARD_INCOMPLETE", qaStatus: tee.qaStatus, qaErrors: tee.qaErrors ?? [], limitation: tee.sourceLimitation, sourceUrl: tee.supplementSourceUrl ?? byCourse.get(tee.courseId)!.sourceUrl }));
  const ratingCategoryGaps = tees.filter(tee => (tee.hasRating || tee.hasSlope) && !tee.ratingCategory).map(tee => ({ id: tee.id, courseId: tee.courseId, reason: "RATING_CATEGORY_NOT_ENABLED", hasRating: tee.hasRating, hasSlope: tee.hasSlope, supplementalCategoryEvidence: tee.supplementRatingCategory, sourceUrl: tee.supplementSourceUrl ?? byCourse.get(tee.courseId)!.sourceUrl }));
  return { schemaVersion: 1, status: "PASS", scope: "Read-only OWNER_CATALOG_REVIEW metadata snapshot; no hole values redistributed or repaired", sourceDigest: digest({ ...source, clubs, courses, tees }), projectRef: source.projectRef, provider: source.provider, observedAt: source.observedAt ?? null, summary: { clubs: clubs.length, courses: courses.length, tees: tees.length, geolocated: clubs.length - missingLocation.length, complete: tees.length - incomplete.length, incomplete: incomplete.length, withoutLocationEvidence: missingLocation.length, ratingsWithoutEnabledCategory: ratingCategoryGaps.length, supplementalCategoryEvidenceNotEnabled: ratingCategoryGaps.filter(row => row.supplementalCategoryEvidence).length }, definitions: { complete: "18 hole entries, matching current catalog API completeCards; not an independent scorecard or licensing certification", ratingCategory: "Runtime rating_category only. Supplement evidence remains separate; audit never enables rating/slope.", sourceFreshness: "Counts apply to the captured source snapshot, not a claim of continuous DB equality", dataRights: "LEGAL_REVIEW_REQUIRED: existing source reuse restrictions remain in force" }, missingLocation, incompleteCards: incomplete, ratingCategoryGaps };
}
