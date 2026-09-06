export const GOLF_CATALOG_ADMIN_RESOURCES = [
  "ball-brands",
  "club-brands",
  "balls",
  "club-models",
  "shafts",
  "ball-tests",
  "course-venues",
  "courses",
  "course-tees",
  "course-holes",
  "tee-yardages",
  "geo-features",
] as const;

export type GolfCatalogAdminResource = (typeof GOLF_CATALOG_ADMIN_RESOURCES)[number];
export type GolfCatalogAdminWriteMode = "create" | "update";

type ResourceDefinition = {
  table: string;
  select: string;
  searchColumn: string | null;
  activeColumn: string | null;
  idKind: "text" | "uuid";
  createFields: readonly string[];
  updateFields: readonly string[];
  requiredCreateFields: readonly string[];
  parentFilter?: { parameter: string; column: string };
};

const provenanceFields = ["provider", "provider_external_id", "source_url", "verified_at"] as const;
const auditFields = ["active", "official_url", "source_name", "source_url", "verified_at"] as const;

export const GOLF_CATALOG_ADMIN_DEFINITIONS: Record<GolfCatalogAdminResource, ResourceDefinition> = {
  "ball-brands": {
    table: "golf_ball_brands",
    select: "id,name,active,official_url,source_name,verified_at,created_at,updated_at",
    searchColumn: "name",
    activeColumn: "active",
    idKind: "text",
    createFields: ["id", "name", "active", "official_url", "source_name", "verified_at"],
    updateFields: ["name", "active", "official_url", "source_name", "verified_at"],
    requiredCreateFields: ["id", "name"],
  },
  "club-brands": {
    table: "golf_club_brands",
    select: "id,name,active,official_url,source_name,verified_at,created_at,updated_at",
    searchColumn: "name",
    activeColumn: "active",
    idKind: "text",
    createFields: ["id", "name", "active", "official_url", "source_name", "verified_at"],
    updateFields: ["name", "active", "official_url", "source_name", "verified_at"],
    requiredCreateFields: ["id", "name"],
  },
  balls: {
    table: "golf_ball_catalog",
    select: "id,brand_id,brand,model,generation,year,year_from,year_to,active,cover_material,construction,construction_pieces,dimple_count,compression,compression_type,compression_source,compression_source_url,compression_min,compression_max,compression_average,feel_profile,flight,driver_spin,iron_spin,short_game_spin,colors,price_tier,target_profile,target_player_description,recommended_swing_speed_min_mph,recommended_swing_speed_max_mph,usga_conforming,official_url,source_name,source_url,verified_at,created_at,updated_at",
    searchColumn: "search_text",
    activeColumn: "active",
    idKind: "text",
    createFields: [
      "id", "brand_id", "brand", "model", "generation", "year", "year_from", "year_to", "active",
      "cover_material", "construction", "construction_pieces", "dimple_count", "compression", "compression_type",
      "compression_source", "compression_source_url", "compression_min", "compression_max", "compression_average",
      "feel_profile", "flight", "driver_spin", "iron_spin", "short_game_spin", "colors", "price_tier",
      "target_profile", "target_player_description", "recommended_swing_speed_min_mph",
      "recommended_swing_speed_max_mph", "usga_conforming", ...auditFields,
    ],
    updateFields: [
      "brand_id", "brand", "model", "generation", "year", "year_from", "year_to", "active", "cover_material",
      "construction", "construction_pieces", "dimple_count", "compression", "compression_type", "compression_source",
      "compression_source_url", "compression_min", "compression_max", "compression_average", "feel_profile", "flight",
      "driver_spin", "iron_spin", "short_game_spin", "colors", "price_tier", "target_profile",
      "target_player_description", "recommended_swing_speed_min_mph", "recommended_swing_speed_max_mph",
      "usga_conforming", ...auditFields,
    ],
    requiredCreateFields: ["id", "brand_id", "model", "source_name", "source_url", "verified_at"],
  },
  "club-models": {
    table: "golf_club_catalog",
    select: "id,brand_id,brand,model,generation,year,year_from,year_to,category,sub_category,active,handedness,lofts,variants,standard_length_inches,lie_degrees,head_volume_cc,construction,official_url,source_name,source_url,verified_at,created_at,updated_at",
    searchColumn: "search_text",
    activeColumn: "active",
    idKind: "text",
    createFields: [
      "id", "brand_id", "brand", "model", "generation", "year", "year_from", "year_to", "category",
      "sub_category", "active", "handedness", "lofts", "variants", "standard_length_inches", "lie_degrees",
      "head_volume_cc", "construction", ...auditFields,
    ],
    updateFields: [
      "brand_id", "brand", "model", "generation", "year", "year_from", "year_to", "category", "sub_category",
      "active", "handedness", "lofts", "variants", "standard_length_inches", "lie_degrees", "head_volume_cc",
      "construction", ...auditFields,
    ],
    requiredCreateFields: ["id", "brand_id", "model", "category", "source_name", "source_url", "verified_at"],
  },
  shafts: {
    table: "golf_shaft_catalog",
    select: "id,brand,model,generation,year,active,weight_grams,flex,launch,spin,material,torque_degrees,tip_diameter_inches,butt_diameter_inches,official_url,source_name,source_url,verified_at,created_at,updated_at",
    searchColumn: "search_text",
    activeColumn: "active",
    idKind: "text",
    createFields: [
      "id", "brand", "model", "generation", "year", "active", "weight_grams", "flex", "launch", "spin",
      "material", "torque_degrees", "tip_diameter_inches", "butt_diameter_inches", ...auditFields,
    ],
    updateFields: [
      "brand", "model", "generation", "year", "active", "weight_grams", "flex", "launch", "spin", "material",
      "torque_degrees", "tip_diameter_inches", "butt_diameter_inches", ...auditFields,
    ],
    requiredCreateFields: ["id", "brand", "model", "source_name", "source_url", "verified_at"],
  },
  "ball-tests": {
    table: "golf_ball_test_results",
    select: "id,golf_ball_id,test_source,source_url,source_license,source_license_url,provider_external_id,test_year,club_type,swing_speed_mph,ball_speed_mph,launch_angle_degrees,spin_rate_rpm,carry_yards,total_yards,peak_height_yards,descent_angle_degrees,dispersion_yards,notes,verified_at,active,created_at,updated_at",
    searchColumn: "test_source",
    activeColumn: "active",
    idKind: "uuid",
    createFields: [
      "golf_ball_id", "test_source", "source_url", "source_license", "source_license_url", "provider_external_id",
      "test_year", "club_type", "swing_speed_mph", "ball_speed_mph", "launch_angle_degrees", "spin_rate_rpm",
      "carry_yards", "total_yards", "peak_height_yards", "descent_angle_degrees", "dispersion_yards", "notes",
      "verified_at", "active",
    ],
    updateFields: [
      "test_source", "source_url", "source_license", "source_license_url", "provider_external_id", "test_year",
      "club_type", "swing_speed_mph", "ball_speed_mph", "launch_angle_degrees", "spin_rate_rpm", "carry_yards",
      "total_yards", "peak_height_yards", "descent_angle_degrees", "dispersion_yards", "notes", "verified_at", "active",
    ],
    requiredCreateFields: ["golf_ball_id", "test_source", "source_url", "club_type", "verified_at"],
    parentFilter: { parameter: "golfBallId", column: "golf_ball_id" },
  },
  "course-venues": {
    table: "golf_clubs",
    select: "id,name,country,state_region,city,address,latitude,longitude,timezone,phone,website,provider,provider_external_id,source_url,verified_at,active,visibility,created_at,updated_at",
    searchColumn: "search_text",
    activeColumn: "active",
    idKind: "text",
    createFields: [
      "name", "country", "state_region", "city", "address", "latitude", "longitude", "timezone", "phone",
      "website", ...provenanceFields, "active", "visibility",
    ],
    updateFields: [
      "name", "country", "state_region", "city", "address", "latitude", "longitude", "timezone", "phone",
      "website", ...provenanceFields, "active", "visibility",
    ],
    requiredCreateFields: ["name", "provider"],
  },
  courses: {
    table: "golf_courses",
    select: "id,club_id,name,holes,latitude,longitude,provider,provider_external_id,source_url,verified_at,active,visibility,created_at,updated_at",
    searchColumn: "search_text",
    activeColumn: "active",
    idKind: "text",
    createFields: ["club_id", "name", "holes", "latitude", "longitude", ...provenanceFields, "active", "visibility"],
    updateFields: ["club_id", "name", "holes", "latitude", "longitude", ...provenanceFields, "active", "visibility"],
    requiredCreateFields: ["club_id", "name", "holes", "provider"],
    parentFilter: { parameter: "clubId", column: "club_id" },
  },
  "course-tees": {
    table: "golf_course_tees",
    select: "id,course_id,name,color,gender,rating,slope,par,total_yards,total_meters,front_nine_rating,back_nine_rating,provider,provider_external_id,source_url,verified_at,active,created_at,updated_at",
    searchColumn: "name",
    activeColumn: "active",
    idKind: "text",
    createFields: [
      "course_id", "name", "color", "gender", "rating", "slope", "par", "total_yards", "total_meters",
      "front_nine_rating", "back_nine_rating", ...provenanceFields, "active",
    ],
    updateFields: [
      "name", "color", "gender", "rating", "slope", "par", "total_yards", "total_meters", "front_nine_rating",
      "back_nine_rating", ...provenanceFields, "active",
    ],
    requiredCreateFields: ["course_id", "name", "provider"],
    parentFilter: { parameter: "courseId", column: "course_id" },
  },
  "course-holes": {
    table: "golf_holes",
    select: "id,course_id,hole_number,par,stroke_index,tee_latitude,tee_longitude,green_center_latitude,green_center_longitude,green_front_latitude,green_front_longitude,green_back_latitude,green_back_longitude,provider,provider_external_id,source_url,verified_at,created_at,updated_at",
    searchColumn: null,
    activeColumn: null,
    idKind: "text",
    createFields: [
      "course_id", "hole_number", "par", "stroke_index", "tee_latitude", "tee_longitude", "green_center_latitude",
      "green_center_longitude", "green_front_latitude", "green_front_longitude", "green_back_latitude",
      "green_back_longitude", ...provenanceFields,
    ],
    updateFields: [
      "hole_number", "par", "stroke_index", "tee_latitude", "tee_longitude", "green_center_latitude",
      "green_center_longitude", "green_front_latitude", "green_front_longitude", "green_back_latitude",
      "green_back_longitude", ...provenanceFields,
    ],
    requiredCreateFields: ["course_id", "hole_number", "par", "stroke_index", "provider"],
    parentFilter: { parameter: "courseId", column: "course_id" },
  },
  "tee-yardages": {
    table: "golf_tee_hole_yardages",
    select: "id,course_id,tee_id,hole_id,yards,meters,provider,provider_external_id,source_url,verified_at,created_at,updated_at",
    searchColumn: null,
    activeColumn: null,
    idKind: "text",
    createFields: ["course_id", "tee_id", "hole_id", "yards", "meters", ...provenanceFields],
    updateFields: ["yards", "meters", ...provenanceFields],
    requiredCreateFields: ["course_id", "tee_id", "hole_id", "provider"],
    parentFilter: { parameter: "courseId", column: "course_id" },
  },
  "geo-features": {
    table: "golf_hole_geo_features",
    select: "id,hole_id,type,latitude,longitude,geometry,label,provider,provider_external_id,source_url,verified_at,active,created_at,updated_at",
    searchColumn: "label",
    activeColumn: "active",
    idKind: "text",
    createFields: ["hole_id", "type", "latitude", "longitude", "geometry", "label", ...provenanceFields, "active"],
    updateFields: ["type", "latitude", "longitude", "geometry", "label", ...provenanceFields, "active"],
    requiredCreateFields: ["hole_id", "type", "provider"],
    parentFilter: { parameter: "holeId", column: "hole_id" },
  },
};

const booleanFields = new Set(["active", "usga_conforming"]);
const numberFields = new Set([
  "year", "year_from", "year_to", "construction_pieces", "dimple_count", "compression", "compression_min",
  "compression_max", "compression_average", "recommended_swing_speed_min_mph", "recommended_swing_speed_max_mph",
  "weight_grams", "standard_length_inches", "lie_degrees", "head_volume_cc", "torque_degrees",
  "tip_diameter_inches", "butt_diameter_inches", "test_year", "swing_speed_mph", "ball_speed_mph",
  "launch_angle_degrees", "spin_rate_rpm", "carry_yards", "total_yards", "peak_height_yards",
  "descent_angle_degrees", "dispersion_yards", "latitude", "longitude", "holes", "rating", "slope", "par",
  "total_meters", "front_nine_rating", "back_nine_rating", "hole_number", "stroke_index", "tee_latitude",
  "tee_longitude", "green_center_latitude", "green_center_longitude", "green_front_latitude",
  "green_front_longitude", "green_back_latitude", "green_back_longitude", "yards", "meters",
]);
const stringArrayFields = new Set(["colors", "target_profile", "handedness", "flex"]);
const numberArrayFields = new Set(["lofts"]);
const jsonFields = new Set(["variants", "geometry"]);
const dateFields = new Set(["verified_at"]);
const urlFields = new Set([
  "official_url", "source_url", "compression_source_url", "source_license_url", "website",
]);
const referenceIdFields = new Set(["brand_id", "golf_ball_id", "club_id", "course_id", "tee_id", "hole_id"]);

const enumFields: Record<string, readonly string[]> = {
  compression_type: ["MANUFACTURER", "INDEPENDENT_MEASURED", "ESTIMATED", "UNKNOWN"],
  feel_profile: ["VERY_SOFT", "SOFT", "MID", "FIRM", "VERY_FIRM"],
  flight: ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"],
  driver_spin: ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"],
  iron_spin: ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"],
  short_game_spin: ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"],
  price_tier: ["ECONOMY", "MID", "PREMIUM"],
  category: ["DRIVER", "MINI_DRIVER", "FAIRWAY_WOOD", "HYBRID", "UTILITY_IRON", "IRON_SET", "WEDGE", "PUTTER"],
  launch: ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"],
  spin: ["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"],
  club_type: ["DRIVER", "SEVEN_IRON", "PW", "WEDGE", "OTHER"],
  visibility: ["PUBLIC", "PRIVATE"],
  gender: ["MEN", "WOMEN", "UNISEX", "OTHER"],
  type: ["TEE", "GREEN_CENTER", "GREEN_FRONT", "GREEN_BACK", "BUNKER", "WATER", "LAYUP", "DOGLEG", "OB", "PENALTY_AREA", "LANDMARK", "OTHER"],
};
const resourceNumberRanges: Partial<Record<GolfCatalogAdminResource, Record<string, readonly [number, number]>>> = {
  "ball-tests": {
    test_year: [1900, 2200],
    swing_speed_mph: [20, 180],
    ball_speed_mph: [20, 250],
    launch_angle_degrees: [-20, 90],
    spin_rate_rpm: [0, 20_000],
    carry_yards: [0, 500],
    total_yards: [0, 600],
    peak_height_yards: [0, 300],
    descent_angle_degrees: [-20, 90],
    dispersion_yards: [0, 250],
  },
};
const adminCourseResources = new Set<GolfCatalogAdminResource>([
  "course-venues", "courses", "course-tees", "course-holes", "tee-yardages", "geo-features",
]);
const canonicalBrandResources = new Set<GolfCatalogAdminResource>(["balls", "club-models"]);

type NormalizedWrite = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseGolfCatalogAdminResource(value: unknown): GolfCatalogAdminResource | null {
  return typeof value === "string" && (GOLF_CATALOG_ADMIN_RESOURCES as readonly string[]).includes(value)
    ? value as GolfCatalogAdminResource
    : null;
}

export function parseAdminBearerToken(value: string | null): string | null {
  const match = value?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export function hasImmutableAdminRole(appMetadata: unknown): boolean {
  return isRecord(appMetadata) && appMetadata.role === "admin";
}

export function parseGolfAdminLimit(value: string | null): number {
  if (value === null || !value.trim()) return 20;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 50)) : 20;
}

export function normalizeGolfAdminSearch(value: string | null): string {
  return (value || "").trim().slice(0, 100).replace(/[\\%_]/g, character => `\\${character}`);
}

export function validGolfAdminId(value: unknown, kind: ResourceDefinition["idKind"]): value is string {
  if (typeof value !== "string") return false;
  if (kind === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  return /^[a-z0-9][a-z0-9._:-]{1,199}$/i.test(value);
}

function normalizeField(resource: GolfCatalogAdminResource, field: string, value: unknown): { valid: true; value: unknown } | { valid: false } {
  if (value === null) return { valid: true, value: null };
  if (booleanFields.has(field)) return typeof value === "boolean" ? { valid: true, value } : { valid: false };
  if (numberFields.has(field)) {
    if (typeof value !== "number" || !Number.isFinite(value)) return { valid: false };
    const range = resourceNumberRanges[resource]?.[field];
    return !range || (value >= range[0] && value <= range[1]) ? { valid: true, value } : { valid: false };
  }
  if (stringArrayFields.has(field)) {
    if (!Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== "string" || !item.trim() || item.length > 120)) return { valid: false };
    return { valid: true, value: value.map(item => (item as string).trim()) };
  }
  if (numberArrayFields.has(field)) {
    if (!Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== "number" || !Number.isFinite(item))) return { valid: false };
    return { valid: true, value };
  }
  if (jsonFields.has(field)) {
    if (field === "variants" && !Array.isArray(value)) return { valid: false };
    if (field === "geometry" && !isRecord(value)) return { valid: false };
    return { valid: true, value };
  }
  if (typeof value !== "string") return { valid: false };
  const normalized = value.trim();
  if (!normalized || normalized.length > 4_000) return { valid: false };
  if (referenceIdFields.has(field) && !validGolfAdminId(normalized, "text")) return { valid: false };
  if (dateFields.has(field) && Number.isNaN(Date.parse(normalized))) return { valid: false };
  if (urlFields.has(field)) {
    try {
      if (new URL(normalized).protocol !== "https:") return { valid: false };
    } catch { return { valid: false }; }
  }
  if (field === "provider" && !/^[A-Z0-9][A-Z0-9_:-]{1,99}$/.test(normalized)) return { valid: false };
  if (enumFields[field] && !enumFields[field].includes(normalized)) return { valid: false };
  return { valid: true, value: normalized };
}

function invalidRange(data: Record<string, unknown>, lower: string, upper: string): boolean {
  return typeof data[lower] === "number" && typeof data[upper] === "number" && data[upper] < data[lower];
}

function invalidCompressionProvenance(data: Record<string, unknown>): boolean {
  const measurements = ["compression", "compression_min", "compression_max", "compression_average"];
  const hasMeasurement = measurements.some(field => typeof data[field] === "number");
  if (!hasMeasurement) return false;
  return !["MANUFACTURER", "INDEPENDENT_MEASURED", "ESTIMATED"].includes(String(data.compression_type || ""))
    || typeof data.compression_source !== "string"
    || typeof data.compression_source_url !== "string";
}

export function normalizeGolfCatalogAdminWrite(
  resource: GolfCatalogAdminResource,
  input: unknown,
  mode: GolfCatalogAdminWriteMode,
): NormalizedWrite {
  if (!isRecord(input)) return { ok: false, error: "Los datos del catálogo no son válidos." };
  const definition = GOLF_CATALOG_ADMIN_DEFINITIONS[resource];
  const allowed = new Set(mode === "create" ? definition.createFields : definition.updateFields);
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    if (!allowed.has(field)) return { ok: false, error: `El campo ${field} no se puede modificar.` };
    const normalized = normalizeField(resource, field, value);
    if (!normalized.valid) return { ok: false, error: `El campo ${field} no tiene un valor válido.` };
    data[field] = normalized.value;
  }
  if (data.id !== undefined && !validGolfAdminId(data.id, definition.idKind)) {
    return { ok: false, error: "El identificador del catálogo no es válido." };
  }
  if (mode === "create") {
    for (const field of definition.requiredCreateFields) {
      if (data[field] === undefined || data[field] === null) return { ok: false, error: `Falta el campo obligatorio ${field}.` };
    }
  }
  if (Object.keys(data).length === 0) return { ok: false, error: "No hay cambios para guardar." };
  if (canonicalBrandResources.has(resource) && data.brand !== undefined && data.brand_id === undefined) {
    return { ok: false, error: "Selecciona una marca del catálogo para conservar una referencia canónica." };
  }
  if (adminCourseResources.has(resource) && data.provider === "USER_MANUAL") {
    return { ok: false, error: "Los campos manuales privados se crean desde el flujo del jugador, no desde el catálogo global." };
  }
  if (mode === "create" && typeof data.provider === "string"
    && data.provider !== "BACKYARD_INTERNAL" && data.provider !== "USER_MANUAL"
    && (data.provider_external_id == null || data.source_url == null || data.verified_at == null)) {
    return { ok: false, error: "Un proveedor externo requiere identificador, fuente y fecha de verificación." };
  }
  if (invalidRange(data, "year_from", "year_to") || invalidRange(data, "compression_min", "compression_max")
    || invalidRange(data, "recommended_swing_speed_min_mph", "recommended_swing_speed_max_mph")) {
    return { ok: false, error: "El rango mínimo no puede ser mayor que el máximo." };
  }
  if (resource === "balls" && invalidCompressionProvenance(data)) {
    return { ok: false, error: "Toda cifra de compresión requiere tipo conocido, fuente y URL verificable." };
  }
  if (resource === "tee-yardages" && mode === "create" && data.yards == null && data.meters == null) {
    return { ok: false, error: "El yardaje requiere al menos una distancia." };
  }
  if (resource === "geo-features" && mode === "create" && data.geometry == null && data.latitude == null) {
    return { ok: false, error: "La referencia GPS requiere coordenadas o geometría." };
  }
  return { ok: true, data };
}
