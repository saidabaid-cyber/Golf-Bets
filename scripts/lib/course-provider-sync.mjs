import { createHash } from "node:crypto";

export const COURSE_PROVIDER_BUNDLE_SCHEMA_VERSION = 1;
export const COURSE_SYNC_STATUSES = ["ADDED", "UPDATED", "UNCHANGED", "CONFLICT", "DEPRECATED"];

const COUNTRY_CODES = new Map([
  ["mexico", "MX"], ["mx", "MX"],
  ["united states", "US"], ["united states of america", "US"], ["usa", "US"], ["us", "US"],
  ["canada", "CA"], ["ca", "CA"],
]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, label, { required = false, max = 1000 } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw Error(`${label}_REQUIRED`);
    return null;
  }
  if (typeof value !== "string") throw Error(`${label}_INVALID`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > max) throw Error(`${label}_INVALID`);
  return normalized;
}

function numberOrNull(value, label, minimum, maximum, integer = false) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw Error(`${label}_INVALID`);
  }
  return value;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function isoOrNull(value, label, required = false) {
  const parsed = text(value, label, { required, max: 80 });
  if (parsed === null) return null;
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp)) throw Error(`${label}_INVALID`);
  return new Date(timestamp).toISOString();
}

function httpsUrl(value, label, required = false) {
  const parsed = text(value, label, { required, max: 1000 });
  if (parsed === null) return null;
  let url;
  try { url = new URL(parsed); } catch { throw Error(`${label}_INVALID`); }
  if (url.protocol !== "https:") throw Error(`${label}_INVALID`);
  return url.toString();
}

export function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeCountry(value) {
  const raw = text(value, "COUNTRY", { required: true, max: 120 });
  const known = COUNTRY_CODES.get(normalizeSearchText(raw));
  if (known) return known;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return raw;
}

function aliases(value, ownName) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw Error("ALIASES_INVALID");
  const own = normalizeSearchText(ownName);
  return [...new Map(value.map((entry) => {
    const alias = text(entry, "ALIAS", { required: true, max: 200 });
    return [normalizeSearchText(alias), alias];
  }).filter(([key]) => key && key !== own)).values()].sort((left, right) => left.localeCompare(right, "es-MX"));
}

function provider(value) {
  const parsed = text(value, "PROVIDER", { required: true, max: 64 }).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_]{1,63}$/.test(parsed)) throw Error("PROVIDER_INVALID");
  return parsed;
}

function externalId(value, label) {
  return text(String(value ?? ""), label, { required: true, max: 240 });
}

function stableId(kind, sourceProvider, id) {
  const hash = createHash("sha256").update(`${sourceProvider}:${kind}:${id}`).digest("hex").slice(0, 24);
  return `master-${sourceProvider.toLocaleLowerCase("en-US").replace(/_/g, "-")}-${kind}-${hash}`;
}

function normalizedGender(value) {
  const raw = text(value, "TEE_GENDER", { max: 40 });
  if (raw === null) return null;
  const key = normalizeSearchText(raw);
  if (["men", "male", "hombres", "caballeros", "m"].includes(key)) return "MEN";
  if (["women", "female", "mujeres", "damas", "f", "w"].includes(key)) return "WOMEN";
  if (["unisex", "mixed", "mixto"].includes(key)) return "UNISEX";
  return "OTHER";
}

function normalizedStatus(value, fallback = "ACTIVE") {
  const raw = text(value, "STATUS", { max: 80 });
  return (raw ?? fallback).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function lengths(input, prefix) {
  const yards = numberOrNull(input.totalYards, `${prefix}_TOTAL_YARDS`, 1, 20000, true);
  const meters = numberOrNull(input.totalMeters, `${prefix}_TOTAL_METERS`, 1, 20000, true);
  if (yards === null && meters === null) return { totalYards: null, totalMeters: null, derivedUnit: null };
  if (yards === null) return { totalYards: Math.round(meters * 1.0936133), totalMeters: meters, derivedUnit: "YARDS_FROM_METERS" };
  if (meters === null) return { totalYards: yards, totalMeters: Math.round(yards * 0.9144), derivedUnit: "METERS_FROM_YARDS" };
  return { totalYards: yards, totalMeters: meters, derivedUnit: null };
}

function normalizeHole(input, holeCount, label) {
  const row = record(input);
  if (!row) throw Error(`${label}_INVALID`);
  const number = numberOrNull(row.number, `${label}_NUMBER`, 1, holeCount, true);
  if (number === null) throw Error(`${label}_NUMBER_REQUIRED`);
  return {
    externalId: row.externalId === null || row.externalId === undefined ? null : externalId(row.externalId, `${label}_EXTERNAL_ID`),
    number,
    par: numberOrNull(row.par, `${label}_PAR`, 3, 6, true),
    // Physical 9-hole cards can legitimately retain an odd/even allocation
    // from an 18-hole rating, so the verified range remains 1..18.
    strokeIndexMen: numberOrNull(row.strokeIndexMen ?? row.strokeIndex, `${label}_STROKE_INDEX_MEN`, 1, 18, true),
    strokeIndexWomen: numberOrNull(row.strokeIndexWomen, `${label}_STROKE_INDEX_WOMEN`, 1, 18, true),
    yards: numberOrNull(row.yards, `${label}_YARDS`, 1, 1000, true),
    meters: numberOrNull(row.meters, `${label}_METERS`, 1, 1000, true),
  };
}

function uniqueBy(rows, key, error) {
  const seen = new Set();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) throw Error(error);
    seen.add(value);
  }
}

export function validateAuthorizedSource(sourceInput) {
  const source = record(sourceInput);
  if (!source) throw Error("SOURCE_REQUIRED");
  const normalized = {
    provider: provider(source.provider),
    displayName: text(source.displayName, "SOURCE_DISPLAY_NAME", { required: true, max: 160 }),
    sourceUrl: httpsUrl(source.sourceUrl, "SOURCE_URL", true),
    termsUrl: httpsUrl(source.termsUrl, "SOURCE_TERMS_URL"),
    authorizationStatus: text(source.authorizationStatus, "SOURCE_AUTHORIZATION_STATUS", { required: true, max: 40 }),
    authorizationBasis: text(source.authorizationBasis, "SOURCE_AUTHORIZATION_BASIS", { required: true, max: 2000 }),
    authorizedForDatabaseImport: source.authorizedForDatabaseImport === true,
    ratingReuseAuthorized: source.ratingReuseAuthorized === true,
    fetchedAt: isoOrNull(source.fetchedAt, "SOURCE_FETCHED_AT", true),
  };
  if (normalized.authorizationStatus !== "AUTHORIZED" || !normalized.authorizedForDatabaseImport) {
    throw Error("SOURCE_NOT_AUTHORIZED_FOR_DATABASE_IMPORT");
  }
  return normalized;
}

export function normalizeCourseProviderBundle(input) {
  const bundle = record(input);
  if (!bundle || bundle.schemaVersion !== COURSE_PROVIDER_BUNDLE_SCHEMA_VERSION) throw Error("COURSE_PROVIDER_BUNDLE_SCHEMA_UNSUPPORTED");
  const source = validateAuthorizedSource(bundle.source);
  const scopeInput = record(bundle.scope) ?? {};
  const scope = {
    kind: text(scopeInput.kind, "SCOPE_KIND", { max: 40 }) ?? "PARTIAL",
    country: scopeInput.country ? normalizeCountry(scopeInput.country) : null,
    region: text(scopeInput.region, "SCOPE_REGION", { max: 160 }),
    complete: scopeInput.complete === true,
  };
  if (!Array.isArray(bundle.facilities)) throw Error("FACILITIES_REQUIRED");
  const facilities = bundle.facilities.map((facilityInput, facilityIndex) => {
    const facility = record(facilityInput);
    if (!facility) throw Error(`FACILITY_${facilityIndex}_INVALID`);
    const facilityExternalId = externalId(facility.externalId, `FACILITY_${facilityIndex}_EXTERNAL_ID`);
    const facilityName = text(facility.name, `FACILITY_${facilityIndex}_NAME`, { required: true, max: 200 });
    const country = normalizeCountry(facility.country);
    const latitude = numberOrNull(facility.latitude, `FACILITY_${facilityIndex}_LATITUDE`, -90, 90);
    const longitude = numberOrNull(facility.longitude, `FACILITY_${facilityIndex}_LONGITUDE`, -180, 180);
    if ((latitude === null) !== (longitude === null)) throw Error(`FACILITY_${facilityIndex}_COORDINATE_PAIR_INVALID`);
    if (!Array.isArray(facility.layouts)) throw Error(`FACILITY_${facilityIndex}_LAYOUTS_REQUIRED`);
    const layouts = facility.layouts.map((layoutInput, layoutIndex) => {
      const layout = record(layoutInput);
      if (!layout) throw Error(`LAYOUT_${facilityIndex}_${layoutIndex}_INVALID`);
      const layoutExternalId = externalId(layout.externalId, `LAYOUT_${facilityIndex}_${layoutIndex}_EXTERNAL_ID`);
      const layoutName = text(layout.name, `LAYOUT_${facilityIndex}_${layoutIndex}_NAME`, { required: true, max: 200 });
      const holeCount = numberOrNull(layout.holeCount, `LAYOUT_${facilityIndex}_${layoutIndex}_HOLES`, 9, 18, true);
      if (![9, 18].includes(holeCount)) throw Error(`LAYOUT_${facilityIndex}_${layoutIndex}_HOLES_INVALID`);
      const layoutHoles = Array.isArray(layout.holes) ? layout.holes.map((hole, index) => normalizeHole(hole, holeCount, `LAYOUT_${layoutIndex}_HOLE_${index}`)) : [];
      uniqueBy(layoutHoles, (hole) => hole.number, `LAYOUT_${facilityIndex}_${layoutIndex}_DUPLICATE_HOLE`);
      uniqueBy(layoutHoles.filter((hole) => hole.strokeIndexMen !== null), (hole) => hole.strokeIndexMen, `LAYOUT_${facilityIndex}_${layoutIndex}_DUPLICATE_STROKE_INDEX`);
      const teeInputs = Array.isArray(layout.tees) ? layout.tees : [];
      const tees = teeInputs.map((teeInput, teeIndex) => {
        const tee = record(teeInput);
        if (!tee) throw Error(`TEE_${layoutIndex}_${teeIndex}_INVALID`);
        const teeExternalId = externalId(tee.externalId, `TEE_${layoutIndex}_${teeIndex}_EXTERNAL_ID`);
        const teeName = text(tee.name, `TEE_${layoutIndex}_${teeIndex}_NAME`, { required: true, max: 120 });
        const teeHoles = Array.isArray(tee.holes) ? tee.holes.map((hole, index) => normalizeHole(hole, holeCount, `TEE_${teeIndex}_HOLE_${index}`)) : [];
        uniqueBy(teeHoles, (hole) => hole.number, `TEE_${layoutIndex}_${teeIndex}_DUPLICATE_HOLE`);
        uniqueBy(teeHoles.filter((hole) => hole.strokeIndexMen !== null), (hole) => hole.strokeIndexMen, `TEE_${layoutIndex}_${teeIndex}_DUPLICATE_STROKE_INDEX`);
        const totalLength = lengths(tee, `TEE_${layoutIndex}_${teeIndex}`);
        return {
          id: stableId("tee", source.provider, teeExternalId), externalId: teeExternalId,
          name: teeName, displayName: text(tee.displayName, `TEE_${teeIndex}_DISPLAY_NAME`, { max: 120 }),
          gender: normalizedGender(tee.gender), color: text(tee.color, `TEE_${teeIndex}_COLOR`, { max: 80 }),
          status: normalizedStatus(tee.status), active: booleanOr(tee.active, true),
          par: numberOrNull(tee.par, `TEE_${teeIndex}_PAR`, 20, 90, true),
          courseRating: numberOrNull(tee.courseRating, `TEE_${teeIndex}_COURSE_RATING`, 20, 100),
          bogeyRating: numberOrNull(tee.bogeyRating, `TEE_${teeIndex}_BOGEY_RATING`, 20, 120),
          slopeRating: numberOrNull(tee.slopeRating, `TEE_${teeIndex}_SLOPE_RATING`, 55, 155, true),
          frontNineRating: numberOrNull(tee.frontNineRating, `TEE_${teeIndex}_FRONT_RATING`, 10, 60),
          frontNineSlope: numberOrNull(tee.frontNineSlope, `TEE_${teeIndex}_FRONT_SLOPE`, 55, 155, true),
          backNineRating: numberOrNull(tee.backNineRating, `TEE_${teeIndex}_BACK_RATING`, 10, 60),
          backNineSlope: numberOrNull(tee.backNineSlope, `TEE_${teeIndex}_BACK_SLOPE`, 55, 155, true),
          ...totalLength, holes: teeHoles,
          sourceUpdatedAt: isoOrNull(tee.sourceUpdatedAt, `TEE_${teeIndex}_SOURCE_UPDATED_AT`),
        };
      });
      uniqueBy(tees, (tee) => tee.externalId, `LAYOUT_${facilityIndex}_${layoutIndex}_DUPLICATE_TEE_EXTERNAL_ID`);
      return {
        id: stableId("layout", source.provider, layoutExternalId), externalId: layoutExternalId,
        name: layoutName, aliases: aliases(layout.aliases, layoutName), holeCount,
        par: numberOrNull(layout.par, `LAYOUT_${layoutIndex}_PAR`, 20, 90, true),
        temporary: layout.temporary === true, status: normalizedStatus(layout.status), active: booleanOr(layout.active, true),
        activeFrom: isoOrNull(layout.activeFrom, `LAYOUT_${layoutIndex}_ACTIVE_FROM`),
        activeTo: isoOrNull(layout.activeTo, `LAYOUT_${layoutIndex}_ACTIVE_TO`),
        sourceUpdatedAt: isoOrNull(layout.sourceUpdatedAt, `LAYOUT_${layoutIndex}_SOURCE_UPDATED_AT`),
        holes: layoutHoles, tees,
      };
    });
    uniqueBy(layouts, (layout) => layout.externalId, `FACILITY_${facilityIndex}_DUPLICATE_LAYOUT_EXTERNAL_ID`);
    return {
      id: stableId("facility", source.provider, facilityExternalId), externalId: facilityExternalId,
      name: facilityName, aliases: aliases(facility.aliases, facilityName), country,
      stateRegion: text(facility.stateRegion, `FACILITY_${facilityIndex}_STATE`, { max: 160 }),
      city: text(facility.city, `FACILITY_${facilityIndex}_CITY`, { max: 160 }),
      address: text(facility.address, `FACILITY_${facilityIndex}_ADDRESS`, { max: 500 }),
      timezone: text(facility.timezone, `FACILITY_${facilityIndex}_TIMEZONE`, { max: 100 }),
      latitude, longitude, status: normalizedStatus(facility.status), active: booleanOr(facility.active, true),
      sourceUpdatedAt: isoOrNull(facility.sourceUpdatedAt, `FACILITY_${facilityIndex}_SOURCE_UPDATED_AT`), layouts,
    };
  });
  uniqueBy(facilities, (facility) => facility.externalId, "DUPLICATE_FACILITY_EXTERNAL_ID");
  return { schemaVersion: 1, source, scope, facilities };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stable(nested)]));
  return value;
}

export function contentFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function rowStatus(incoming, existing, comparableFields) {
  if (!existing) return { status: "ADDED", changedFields: comparableFields };
  const changedFields = comparableFields.filter((field) => contentFingerprint(incoming[field]) !== contentFingerprint(existing[field]));
  return { status: changedFields.length ? "UPDATED" : "UNCHANGED", changedFields };
}

function facilityKey(row) {
  return [normalizeSearchText(row.name), normalizeSearchText(row.city), normalizeSearchText(row.country)].join("|");
}

function layoutKey(row) {
  return [row.club_id ?? row.facilityId, normalizeSearchText(row.name), row.holes ?? row.holeCount].join("|");
}

function teeKey(row) {
  return [row.course_id ?? row.layoutId, normalizeSearchText(row.name), row.gender ?? ""].join("|");
}

export function flattenCourseProviderBundle(normalized) {
  const providerName = normalized.source.provider;
  const fetchedAt = normalized.source.fetchedAt;
  const facilities = [], layouts = [], tees = [], holes = [], yardages = [];
  for (const facility of normalized.facilities) {
    facilities.push({
      id: facility.id, name: facility.name, country: facility.country, state_region: facility.stateRegion,
      city: facility.city, address: facility.address, latitude: facility.latitude, longitude: facility.longitude,
      timezone: facility.timezone, provider: providerName, provider_external_id: facility.externalId,
      source_url: normalized.source.sourceUrl, verified_at: fetchedAt, active: facility.active,
      visibility: "PUBLIC", catalog_metadata: { search_aliases: facility.aliases, importer_schema: 1 },
      origin: "BACKYARD_ADMIN", is_provisional: false, provider_status: facility.status,
      last_synced_at: fetchedAt, source_updated_at: facility.sourceUpdatedAt,
    });
    for (const layout of facility.layouts) {
      const completeLayoutHoles = layout.holes.length === layout.holeCount
        && layout.holes.every((hole) => hole.par !== null && hole.strokeIndexMen !== null);
      layouts.push({
        id: layout.id, club_id: facility.id, name: layout.name, holes: layout.holeCount,
        provider: providerName, provider_external_id: layout.externalId, source_url: normalized.source.sourceUrl,
        verified_at: fetchedAt, active: layout.active, visibility: "PUBLIC",
        catalog_metadata: {
          provider: providerName, course_id: layout.externalId, search_aliases: layout.aliases,
          observed_at: fetchedAt, rating_reuse_status: "AUTHORIZED", importer_schema: 1,
          qa_status: completeLayoutHoles ? "PASS" : "MISSING_HOLE_DATA",
        },
        origin: "BACKYARD_ADMIN", layout_type: layout.temporary ? "TEMPORARY" : "STANDARD",
        is_provisional: false, provider_status: layout.status, total_par: layout.par,
        season: layout.activeFrom || layout.activeTo ? { activeFrom: layout.activeFrom, activeTo: layout.activeTo } : null,
        last_synced_at: fetchedAt, source_updated_at: layout.sourceUpdatedAt,
      });
      if (completeLayoutHoles) for (const hole of layout.holes) holes.push({
        id: stableId("hole", providerName, `${layout.externalId}:${hole.externalId ?? hole.number}`),
        course_id: layout.id, hole_number: hole.number, par: hole.par, stroke_index: hole.strokeIndexMen,
        provider: providerName, provider_external_id: `${layout.externalId}:${hole.externalId ?? hole.number}`,
        source_url: normalized.source.sourceUrl, verified_at: fetchedAt, origin: "BACKYARD_ADMIN",
        active: true, provider_status: layout.status, last_synced_at: fetchedAt, source_updated_at: layout.sourceUpdatedAt,
      });
      const holeByNumber = new Map(holes.filter((hole) => hole.course_id === layout.id).map((hole) => [hole.hole_number, hole]));
      for (const tee of layout.tees) {
        const teeHoleSource = tee.holes.length ? tee.holes : layout.holes;
        const normalizedHoles = teeHoleSource.flatMap((hole) => {
          const canonical = holeByNumber.get(hole.number);
          if (!canonical || hole.par === null || hole.strokeIndexMen === null) return [];
          return [{ hole_number: hole.number, par: hole.par, stroke_index: hole.strokeIndexMen, yards: hole.yards }];
        });
        const completeTeeHoles = normalizedHoles.length === layout.holeCount;
        tees.push({
          id: tee.id, course_id: layout.id, name: tee.name, display_name: tee.displayName,
          color: tee.color, gender: tee.gender, rating: tee.courseRating, slope: tee.slopeRating,
          par: tee.par ?? layout.par, total_yards: tee.totalYards, total_meters: tee.totalMeters,
          front_nine_rating: tee.frontNineRating, back_nine_rating: tee.backNineRating,
          provider: providerName, provider_external_id: tee.externalId, source_url: normalized.source.sourceUrl,
          verified_at: fetchedAt, active: tee.active,
          catalog_metadata: {
            id: tee.externalId, name: tee.name, displayName: tee.displayName, gender: tee.gender,
            course_rating: tee.courseRating, slope_rating: tee.slopeRating, bogey_rating: tee.bogeyRating,
            yards: tee.totalYards, meters: tee.totalMeters, par: tee.par ?? layout.par,
            rating_category: tee.gender, qa_status: completeTeeHoles ? "PASS" : "MISSING_HOLE_DATA",
            source_limitation: completeTeeHoles ? null : "Provider did not supply complete par/stroke allocation/length data.",
            holes: normalizedHoles, nineRatings: [], qa: { status: completeTeeHoles ? "PASS" : "MISSING_HOLE_DATA", errors: completeTeeHoles ? [] : ["MISSING_HOLE_DATA"] },
            derived_unit: tee.derivedUnit, importer_schema: 1,
          },
          origin: "BACKYARD_ADMIN", provider_status: tee.status, bogey_rating: tee.bogeyRating,
          front_nine_slope: tee.frontNineSlope, back_nine_slope: tee.backNineSlope,
          last_synced_at: fetchedAt, source_updated_at: tee.sourceUpdatedAt,
        });
        for (const hole of teeHoleSource) {
          const canonical = holeByNumber.get(hole.number);
          if (!canonical || (hole.yards === null && hole.meters === null)) continue;
          yardages.push({
            id: stableId("yardage", providerName, `${tee.externalId}:${hole.externalId ?? hole.number}`),
            course_id: layout.id, tee_id: tee.id, hole_id: canonical.id,
            yards: hole.yards, meters: hole.meters, tee_par: hole.par, tee_stroke_index: hole.strokeIndexMen,
            provider: providerName, provider_external_id: `${tee.externalId}:${hole.externalId ?? hole.number}`,
            source_url: normalized.source.sourceUrl, verified_at: fetchedAt,
          });
        }
      }
    }
  }
  return { facilities, layouts, tees, holes, yardages };
}

function preserveExistingInternalIds(incoming, existing, providerName) {
  const rebound = structuredClone(incoming);
  const remap = (key, parentFields = []) => {
    const existingByExternal = new Map(existing[key].filter((row) => row.provider === providerName).map((row) => [row.provider_external_id, row.id]));
    const idMap = new Map();
    for (const row of rebound[key]) {
      const priorId = existingByExternal.get(row.provider_external_id);
      if (priorId && priorId !== row.id) { idMap.set(row.id, priorId); row.id = priorId; }
    }
    for (const [childKey, parentField] of parentFields) for (const row of rebound[childKey]) {
      if (idMap.has(row[parentField])) row[parentField] = idMap.get(row[parentField]);
    }
  };
  remap("facilities", [["layouts", "club_id"]]);
  remap("layouts", [["tees", "course_id"], ["holes", "course_id"], ["yardages", "course_id"]]);
  remap("tees", [["yardages", "tee_id"]]);
  remap("holes", [["yardages", "hole_id"]]);
  remap("yardages");
  return rebound;
}

export function buildCourseProviderSyncPlan(bundleInput, current = {}) {
  const normalized = normalizeCourseProviderBundle(bundleInput);
  const flattened = flattenCourseProviderBundle(normalized);
  const existing = {
    facilities: Array.isArray(current.facilities) ? current.facilities : [],
    layouts: Array.isArray(current.layouts) ? current.layouts : [],
    tees: Array.isArray(current.tees) ? current.tees : [],
    holes: Array.isArray(current.holes) ? current.holes : [],
    yardages: Array.isArray(current.yardages) ? current.yardages : [],
  };
  const providerName = normalized.source.provider;
  const incoming = preserveExistingInternalIds(flattened, existing, providerName);
  const specs = [
    ["FACILITY", "facilities", "provider_external_id", ["name", "country", "state_region", "city", "address", "latitude", "longitude", "timezone", "active", "provider_status"]],
    ["LAYOUT", "layouts", "provider_external_id", ["club_id", "name", "holes", "active", "layout_type", "total_par", "provider_status"]],
    ["TEE", "tees", "provider_external_id", ["course_id", "name", "display_name", "gender", "rating", "slope", "par", "total_yards", "total_meters", "front_nine_rating", "front_nine_slope", "back_nine_rating", "back_nine_slope", "provider_status"]],
    ["HOLE", "holes", "provider_external_id", ["course_id", "hole_number", "par", "stroke_index", "active", "provider_status"]],
    ["TEE_HOLE", "yardages", "provider_external_id", ["course_id", "tee_id", "hole_id", "yards", "meters", "tee_par", "tee_stroke_index"]],
  ];
  const changes = [];
  for (const [entityType, key, identity, fields] of specs) {
    const sameProvider = existing[key].filter((row) => row.provider === providerName);
    const byExternal = new Map(sameProvider.map((row) => [row[identity], row]));
    const seen = new Set();
    for (const row of incoming[key]) {
      seen.add(row[identity]);
      const result = rowStatus(row, byExternal.get(row[identity]), fields);
      changes.push({ entityType, externalId: row[identity], internalId: row.id, ...result });
    }
    if (normalized.scope.complete) for (const row of sameProvider) if (!seen.has(row[identity])) {
      changes.push({ entityType, externalId: row[identity], internalId: row.id, status: "DEPRECATED", changedFields: ["active", "provider_status"] });
    }
  }

  const exactFacilityIds = new Set(existing.facilities.filter((row) => row.provider === providerName).map((row) => row.provider_external_id));
  const facilityKeys = new Map(existing.facilities.map((row) => [facilityKey(row), row]));
  for (const row of incoming.facilities) {
    const collision = facilityKeys.get(facilityKey(row));
    if (collision && collision.provider !== providerName && !exactFacilityIds.has(row.provider_external_id)) {
      changes.push({ entityType: "FACILITY", externalId: row.provider_external_id, internalId: row.id, status: "CONFLICT", changedFields: [], reason: "POSSIBLE_CROSS_PROVIDER_DUPLICATE_REQUIRES_RECONCILIATION" });
    }
  }
  const layoutKeys = new Map(existing.layouts.map((row) => [layoutKey(row), row]));
  for (const row of incoming.layouts) {
    const collision = layoutKeys.get(layoutKey(row));
    if (collision && collision.provider !== providerName) changes.push({ entityType: "LAYOUT", externalId: row.provider_external_id, internalId: row.id, status: "CONFLICT", changedFields: [], reason: "POSSIBLE_LAYOUT_DUPLICATE_REQUIRES_RECONCILIATION" });
  }
  const teeKeys = new Map(existing.tees.map((row) => [teeKey(row), row]));
  for (const row of incoming.tees) {
    const collision = teeKeys.get(teeKey(row));
    if (collision && collision.provider_external_id !== row.provider_external_id) changes.push({ entityType: "TEE", externalId: row.provider_external_id, internalId: row.id, status: "CONFLICT", changedFields: [], reason: "TEE_NAME_GENDER_COLLISION_REQUIRES_RECONCILIATION" });
  }

  const uniqueChanges = [...new Map(changes.map((change) => [`${change.entityType}:${change.externalId}:${change.status}`, change])).values()];
  const counts = Object.fromEntries(COURSE_SYNC_STATUSES.map((status) => [status, uniqueChanges.filter((change) => change.status === status).length]));
  const quality = {
    facilities: incoming.facilities.length, layouts: incoming.layouts.length, tees: incoming.tees.length,
    holes: incoming.holes.length, teeHoleYardages: incoming.yardages.length,
    ratedTees: incoming.tees.filter((tee) => tee.rating !== null && tee.slope !== null).length,
    completeLayoutScorecards: incoming.layouts.filter((layout) => incoming.holes.filter((hole) => hole.course_id === layout.id).length === layout.holes).length,
    completeTeeScorecards: incoming.tees.filter((tee) => incoming.yardages.filter((row) => row.tee_id === tee.id).length === incoming.layouts.find((layout) => layout.id === tee.course_id)?.holes).length,
    countries: [...new Set(incoming.facilities.map((facility) => facility.country).filter(Boolean))].sort(),
  };
  return { schemaVersion: 1, provider: providerName, normalized, rows: incoming, changes: uniqueChanges, counts, quality, blocked: counts.CONFLICT > 0, fingerprint: contentFingerprint({ provider: providerName, rows: incoming }) };
}
