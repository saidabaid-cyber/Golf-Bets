import type { Course } from "./types";
import {
  buildInternalCourseCatalog,
  type CourseHoleRecord,
  type CourseTeeRecord,
  type GolfCourseRecord,
  type InternalCourseCatalog,
} from "./course-catalog";
import { findNearbyCourses, isValidGeographicPoint, type CourseGeographicPoint, type NearbyCourseMatch } from "./course-distance";
import { INTERNAL_GOLF_COURSE_CATALOG, type GolfHoleGeoFeature } from "./golf-course-directory";

export type ProviderFailureCode =
  | "not_configured"
  | "not_authorized"
  | "not_found"
  | "unsupported"
  | "temporarily_unavailable"
  | "invalid_response";

export type ProviderResult<T> =
  | { ok: true; data: T; providerId: string }
  | { ok: false; code: ProviderFailureCode; message: string; providerId: string };

export type CourseDataCapability =
  | "search"
  | "nearby"
  | "details"
  | "tees"
  | "holes"
  | "geo_features"
  | "manual_write"
  | "remote_catalog"
  | "structured_catalog";

export type CourseSearchInput = {
  /** The caller-owned catalog. The internal provider never adds remote records. */
  courses: readonly Course[];
  query?: string;
  limit?: number;
  /** Opaque selection cursor returned by the preceding page. */
  cursor?: string;
};

export type CourseSearchData = {
  courses: Course[];
  query: string;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  /** Formal, validated course/tee/hole records for the returned page. */
  catalog: InternalCourseCatalog;
  /** Records kept by the caller but excluded because they are unsafe to play. */
  rejected: number;
};

export type CourseLookupInput = {
  courses: readonly Course[];
  courseId: string;
};

export type CourseHoleLookupInput = CourseLookupInput & {
  holeNumber?: number;
};

export type NearbyCoursesInput = {
  courses: readonly Course[];
  origin: CourseGeographicPoint;
  radiusKm?: number;
  limit?: number;
};

export type NearbyCoursesData = {
  matches: NearbyCourseMatch[];
  total: number;
};

export interface CourseDataProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: "internal" | "external";
  readonly capabilities: Readonly<Record<CourseDataCapability, boolean>>;
  searchCourses(input: CourseSearchInput): Promise<ProviderResult<CourseSearchData>>;
  nearbyCourses(input: NearbyCoursesInput): Promise<ProviderResult<NearbyCoursesData>>;
  getCourse(input: CourseLookupInput): Promise<ProviderResult<GolfCourseRecord>>;
  getTees(input: CourseLookupInput): Promise<ProviderResult<CourseTeeRecord[]>>;
  getHoles(input: CourseLookupInput): Promise<ProviderResult<CourseHoleRecord[]>>;
  getGeoFeatures(input: CourseHoleLookupInput): Promise<ProviderResult<GolfHoleGeoFeature[]>>;
  /** @deprecated Backward-compatible alias for searchCourses. */
  search(input: CourseSearchInput): Promise<ProviderResult<CourseSearchData>>;
}

function searchableText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-MX");
}

function searchLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(value as number)));
}

/**
 * Searches only the catalog already owned by the application. It performs no
 * fetch, geocoding, scraping or enrichment, and it returns the original Course
 * objects so existing snapshots remain authoritative.
 */
export function searchInternalCourses(input: CourseSearchInput): CourseSearchData {
  const query = searchableText(input.query);
  const tokens = query.split(/\s+/).filter(Boolean);
  const limit = searchLimit(input.limit);
  const fullCatalog = buildInternalCourseCatalog(input.courses);

  const matches = fullCatalog.entries
    .map((entry, index) => {
      if (!entry.playable || !entry.course || !entry.tee) return null;
      const name = searchableText(entry.course.name);
      const tee = searchableText(entry.tee.name);
      const haystack = [name, tee, entry.course.clubName, entry.course.city, entry.course.stateRegion, entry.course.country]
        .map(searchableText)
        .filter(Boolean)
        .join(" ");
      if (!tokens.every((token) => haystack.includes(token))) return null;
      const rank = !query || name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : 3;
      return { course: entry.sourceCourse, index, rank };
    })
    .filter((match): match is { course: Course; index: number; rank: number } => Boolean(match));

  if (query) matches.sort((left, right) => left.rank - right.rank || left.index - right.index);
  const afterIndex = input.cursor
    ? matches.findIndex((match) => match.course.id === input.cursor)
    : -1;
  const pageStart = afterIndex >= 0 ? afterIndex + 1 : 0;
  const pageMatches = matches.slice(pageStart, pageStart + limit);
  const courses = pageMatches.map((match) => match.course);
  const hasMore = pageStart + courses.length < matches.length;
  return {
    courses,
    query: String(input.query ?? "").trim(),
    total: matches.length,
    hasMore,
    ...(hasMore && courses.length ? { nextCursor: courses[courses.length - 1].id } : {}),
    catalog: buildInternalCourseCatalog(courses),
    rejected: fullCatalog.rejectedCount,
  };
}

function resolveCatalogCourse(input: CourseLookupInput) {
  const catalog = buildInternalCourseCatalog(input.courses);
  const direct = catalog.courses.find((course) => course.id === input.courseId);
  if (direct) return { catalog, course: direct };
  const entry = catalog.entries.find((candidate) => candidate.selectionId === input.courseId && candidate.playable);
  return entry?.course ? { catalog, course: entry.course } : null;
}

/** Default provider for Beta: a deterministic, offline search over real local data. */
export const internalCourseDataProvider: CourseDataProvider = {
  id: "backyard-internal",
  label: "Catálogo de The Backyard",
  kind: "internal",
  capabilities: {
    search: true,
    nearby: true,
    details: true,
    tees: true,
    holes: true,
    geo_features: true,
    manual_write: true,
    remote_catalog: false,
    structured_catalog: true,
  },
  async searchCourses(input) {
    return { ok: true, data: searchInternalCourses(input), providerId: this.id };
  },
  async search(input) {
    return { ok: true, data: searchInternalCourses(input), providerId: this.id };
  },
  async nearbyCourses(input) {
    if (!isValidGeographicPoint(input.origin)) {
      return { ok: false, code: "invalid_response", message: "La ubicación no tiene coordenadas válidas.", providerId: this.id };
    }
    const matches = findNearbyCourses(input.courses, input.origin, { limit: input.limit, radiusKm: input.radiusKm });
    return { ok: true, data: { matches, total: matches.length }, providerId: this.id };
  },
  async getCourse(input) {
    const resolved = resolveCatalogCourse(input);
    return resolved
      ? { ok: true, data: resolved.course, providerId: this.id }
      : { ok: false, code: "not_found", message: "El campo no está disponible.", providerId: this.id };
  },
  async getTees(input) {
    const resolved = resolveCatalogCourse(input);
    return resolved
      ? { ok: true, data: resolved.catalog.tees.filter((tee) => tee.courseId === resolved.course.id), providerId: this.id }
      : { ok: false, code: "not_found", message: "El campo no está disponible.", providerId: this.id };
  },
  async getHoles(input) {
    const resolved = resolveCatalogCourse(input);
    return resolved
      ? { ok: true, data: resolved.catalog.holes.filter((hole) => hole.courseId === resolved.course.id), providerId: this.id }
      : { ok: false, code: "not_found", message: "El campo no está disponible.", providerId: this.id };
  },
  async getGeoFeatures(input) {
    const resolved = resolveCatalogCourse(input);
    if (!resolved) return { ok: false, code: "not_found", message: "El campo no está disponible.", providerId: this.id };
    const holeIds = new Set(INTERNAL_GOLF_COURSE_CATALOG.holes
      .filter((hole) => hole.courseId === resolved.course.id && (input.holeNumber === undefined || hole.holeNumber === input.holeNumber))
      .map((hole) => hole.id));
    const data = INTERNAL_GOLF_COURSE_CATALOG.geoFeatures.filter((feature) => holeIds.has(feature.holeId));
    return { ok: true, data, providerId: this.id };
  },
};

export type HandicapCapability = "current_index" | "history" | "account_link" | "authorized_write";

export type HandicapLookup = {
  userId: string;
  externalPlayerId?: string;
};

export type HandicapRecord = {
  value: number;
  effectiveAt: string;
  classification: "official" | "provider_calculated" | "manual";
  authorityLabel?: string;
  externalPlayerId?: string;
};

export interface HandicapProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: Readonly<Record<HandicapCapability, boolean>>;
  getCurrent(input: HandicapLookup): Promise<ProviderResult<HandicapRecord>>;
  getHistory?(input: HandicapLookup): Promise<ProviderResult<HandicapRecord[]>>;
}

export type GolfProfileCapability = "lookup" | "account_link" | "profile_import" | "profile_export";

export type GolfProfileLookup = {
  userId: string;
  externalPlayerId?: string;
};

export type GolfProfileRecord = {
  externalPlayerId: string;
  displayName?: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
  club?: string;
  handicap?: HandicapRecord;
  updatedAt?: string;
};

export interface GolfProfileProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: Readonly<Record<GolfProfileCapability, boolean>>;
  getProfile(input: GolfProfileLookup): Promise<ProviderResult<GolfProfileRecord>>;
}

export type GeographicPoint = CourseGeographicPoint;

export type GolfMapCapability = "hole_geometry" | "green_targets" | "hazards" | "layups";

export type GolfMapLookup = {
  courseId: string;
  holeNumber: number;
  teeId?: string;
};

export type GolfMapTarget = {
  id: string;
  label: string;
  kind: "tee" | "front" | "center" | "back" | "hazard" | "layup" | "custom";
  point: GeographicPoint;
};

export type GolfHoleMap = {
  courseId: string;
  holeNumber: number;
  targets: GolfMapTarget[];
  updatedAt?: string;
};

export interface GolfMapProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: Readonly<Record<GolfMapCapability, boolean>>;
  getHoleMap(input: GolfMapLookup): Promise<ProviderResult<GolfHoleMap>>;
}

export type DistanceCapability = "straight_line" | "front_center_back" | "hazards" | "layups";

export type DistanceRequest = {
  origin: GeographicPoint;
  targets: GolfMapTarget[];
  unit: "yards" | "meters";
};

export type DistanceMeasurement = {
  targetId: string;
  value: number;
  unit: "yards" | "meters";
};

export interface DistanceProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: Readonly<Record<DistanceCapability, boolean>>;
  measure(input: DistanceRequest): Promise<ProviderResult<DistanceMeasurement[]>>;
}
