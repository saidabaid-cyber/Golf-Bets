import type { Course } from "./types";
import { buildInternalCourseCatalog, type InternalCourseCatalog } from "./course-catalog";

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

export type CourseDataCapability = "search" | "details" | "manual_write" | "remote_catalog" | "structured_catalog";

export type CourseSearchInput = {
  /** The caller-owned catalog. The internal provider never adds remote records. */
  courses: readonly Course[];
  query?: string;
  limit?: number;
};

export type CourseSearchData = {
  courses: Course[];
  query: string;
  total: number;
  hasMore: boolean;
  /** Formal, validated course/tee/hole records for the returned page. */
  catalog: InternalCourseCatalog;
  /** Records kept by the caller but excluded because they are unsafe to play. */
  rejected: number;
};

export interface CourseDataProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: "internal" | "external";
  readonly capabilities: Readonly<Record<CourseDataCapability, boolean>>;
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
      const haystack = `${name} ${tee}`.trim();
      if (!tokens.every((token) => haystack.includes(token))) return null;
      const rank = !query || name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : 3;
      return { course: entry.sourceCourse, index, rank };
    })
    .filter((match): match is { course: Course; index: number; rank: number } => Boolean(match));

  if (query) matches.sort((left, right) => left.rank - right.rank || left.index - right.index);
  const courses = matches.slice(0, limit).map((match) => match.course);
  return {
    courses,
    query: String(input.query ?? "").trim(),
    total: matches.length,
    hasMore: matches.length > courses.length,
    catalog: buildInternalCourseCatalog(courses),
    rejected: fullCatalog.rejectedCount,
  };
}

/** Default provider for Beta: a deterministic, offline search over real local data. */
export const internalCourseDataProvider: CourseDataProvider = {
  id: "backyard-internal",
  label: "Catálogo de The Backyard",
  kind: "internal",
  capabilities: {
    search: true,
    details: true,
    manual_write: true,
    remote_catalog: false,
    structured_catalog: true,
  },
  async search(input) {
    return { ok: true, data: searchInternalCourses(input), providerId: this.id };
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

export type GeographicPoint = {
  latitude: number;
  longitude: number;
};

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
