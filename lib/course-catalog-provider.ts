import {
  INTERNAL_GOLF_COURSE_CATALOG,
  type GolfClub,
  type GolfCourse,
  type GolfCourseCatalog,
  type GolfCourseTee,
  type GolfHole,
  type TeeHoleYardage,
} from "./golf-course-directory";
import type { ProviderResult } from "./golf-providers";

export type ClubSearchResult = {
  clubs: GolfClub[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export interface CourseCatalogProvider {
  readonly id: string;
  readonly kind: "internal" | "external";
  searchClubs(query: string, limit?: number, cursor?: string): Promise<ProviderResult<ClubSearchResult>>;
  getCourses(clubId: string): Promise<ProviderResult<GolfCourse[]>>;
  getTees(courseId: string): Promise<ProviderResult<GolfCourseTee[]>>;
  getHoles(courseId: string): Promise<ProviderResult<GolfHole[]>>;
}

function searchable(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").trim();
}

function catalogProvider(catalog: GolfCourseCatalog, providerId = "backyard-course-catalog", kind: "internal" | "external" = "internal"): CourseCatalogProvider {
  const success = <T,>(data: T): ProviderResult<T> => ({ ok: true, data, providerId });
  const missing = (message: string): ProviderResult<never> => ({ ok: false, code: "not_found", message, providerId });
  return {
    id: providerId,
    kind,
    async searchClubs(query, limit = 20, cursor) {
      const tokens = searchable(query).split(/\s+/).filter(Boolean);
      const matches = catalog.clubs
        .filter((club) => club.active && tokens.every((token) => searchable([club.name, club.city, club.stateRegion, club.country].filter(Boolean).join(" ")).includes(token)))
        .sort((left, right) => left.name.localeCompare(right.name, "es-MX") || left.id.localeCompare(right.id));
      const pageSize = Math.max(1, Math.min(50, limit));
      const offset = cursor && /^\d+$/.test(cursor) ? Math.max(0, Number(cursor)) : 0;
      const clubs = matches.slice(offset, offset + pageSize);
      const nextOffset = offset + clubs.length;
      return success({ clubs, total: matches.length, hasMore: nextOffset < matches.length, nextCursor: nextOffset < matches.length ? String(nextOffset) : null });
    },
    async getCourses(clubId) {
      const rows = catalog.courses.filter((course) => course.active && course.clubId === clubId);
      return rows.length ? success(rows) : missing("El club no tiene campos disponibles.");
    },
    async getTees(courseId) {
      const rows = catalog.tees.filter((tee) => tee.active && tee.courseId === courseId);
      return rows.length ? success(rows) : missing("El campo no tiene tees disponibles.");
    },
    async getHoles(courseId) {
      const rows = catalog.holes.filter((hole) => hole.courseId === courseId);
      return rows.length ? success(rows) : missing("El campo no tiene hoyos disponibles.");
    },
  };
}

export const internalCourseCatalogProvider = catalogProvider(INTERNAL_GOLF_COURSE_CATALOG);

export type GolfApiTeePayload = {
  id: string;
  name: string;
  color?: string | null;
  gender?: string | null;
  rating?: number | null;
  slope?: number | null;
  par?: number | null;
  totalYards?: number | null;
  totalMeters?: number | null;
  yardages?: Array<number | null>;
};

export type GolfApiCoursePayload = {
  id: string;
  name: string;
  holes: 9 | 18;
  latitude?: number | null;
  longitude?: number | null;
  pars: number[];
  strokeIndexes: number[];
  tees?: GolfApiTeePayload[];
};

export type GolfApiClubPayload = {
  id: string;
  name: string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  courses: GolfApiCoursePayload[];
};

/** Normalizes an authorized GolfAPI response into Backyard-owned records.
 * Network access is intentionally injected: no key means no request. */
export function normalizeGolfApiCatalog(rows: readonly GolfApiClubPayload[], retrievedAt: string, sourceUrl = "https://www.golfapi.io/"): GolfCourseCatalog {
  const clubs: GolfClub[] = [];
  const courses: GolfCourse[] = [];
  const tees: GolfCourseTee[] = [];
  const holes: GolfHole[] = [];
  const teeHoleYardages: TeeHoleYardage[] = [];
  for (const input of rows) {
    const clubId = `golfapi-club-${input.id}`;
    clubs.push({ id: clubId, name: input.name, country: input.country || undefined, stateRegion: input.state || undefined, city: input.city || undefined, latitude: input.latitude ?? undefined, longitude: input.longitude ?? undefined, active: true, provider: "GOLFAPI", providerExternalId: input.id, sourceName: "GolfAPI", sourceUrl, verifiedAt: retrievedAt });
    for (const courseInput of input.courses) {
      if (courseInput.pars.length !== courseInput.holes || courseInput.strokeIndexes.length !== courseInput.holes) continue;
      const courseId = `golfapi-course-${courseInput.id}`;
      courses.push({ id: courseId, clubId, name: courseInput.name, holes: courseInput.holes, latitude: courseInput.latitude ?? undefined, longitude: courseInput.longitude ?? undefined, active: true, provider: "GOLFAPI", providerExternalId: courseInput.id, sourceName: "GolfAPI", sourceUrl, verifiedAt: retrievedAt });
      courseInput.pars.forEach((par, index) => holes.push({ id: `${courseId}-hole-${index + 1}`, courseId, holeNumber: index + 1, par, strokeIndex: courseInput.strokeIndexes[index] }));
      for (const teeInput of courseInput.tees || []) {
        const teeId = `golfapi-tee-${teeInput.id}`;
        tees.push({ id: teeId, courseId, legacySelectionId: teeId, name: teeInput.name, color: teeInput.color || undefined, gender: teeInput.gender || undefined, rating: teeInput.rating ?? undefined, slope: teeInput.slope ?? undefined, par: teeInput.par ?? undefined, totalYards: teeInput.totalYards ?? undefined, totalMeters: teeInput.totalMeters ?? undefined, active: true });
        (teeInput.yardages || []).forEach((yards, index) => {
          if (typeof yards === "number" && Number.isFinite(yards)) teeHoleYardages.push({ teeId, holeId: `${courseId}-hole-${index + 1}`, holeNumber: index + 1, yards });
        });
      }
    }
  }
  return { schemaVersion: 1, clubs, courses, tees, holes, teeHoleYardages, geoFeatures: [] };
}

export function createGolfApiCourseCatalogProvider(options: { apiKey?: string; load: (apiKey: string) => Promise<GolfApiClubPayload[]>; now?: () => string }): CourseCatalogProvider {
  const notConfigured = <T,>(): ProviderResult<T> => ({ ok: false, code: "not_configured", message: "GolfAPI requiere una API key y licencia activas.", providerId: "golfapi" });
  const loadProvider = async () => {
    if (!options.apiKey) return null;
    const rows = await options.load(options.apiKey);
    return catalogProvider(normalizeGolfApiCatalog(rows, options.now?.() || new Date().toISOString()), "golfapi", "external");
  };
  return {
    id: "golfapi", kind: "external",
    async searchClubs(query, limit, cursor) { const provider = await loadProvider(); return provider ? provider.searchClubs(query, limit, cursor) : notConfigured(); },
    async getCourses(clubId) { const provider = await loadProvider(); return provider ? provider.getCourses(clubId) : notConfigured(); },
    async getTees(courseId) { const provider = await loadProvider(); return provider ? provider.getTees(courseId) : notConfigured(); },
    async getHoles(courseId) { const provider = await loadProvider(); return provider ? provider.getHoles(courseId) : notConfigured(); },
  };
}
