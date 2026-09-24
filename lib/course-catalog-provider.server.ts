import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { publicationIsEffective } from "./admin-control-center";
import { createCourseCatalogProvider, internalCourseCatalogProvider } from "./course-catalog-provider";
import {
  INTERNAL_GOLF_COURSE_CATALOG,
  type GolfClub,
  type GolfCourse,
  type GolfCourseCatalog,
  type GolfCourseTee,
  type GolfHole,
  type TeeHoleYardage,
} from "./golf-course-directory";
import { haversineDistanceKm } from "./course-distance";
import { loadReviewedCourseCatalog, reviewCatalogQaEnabled } from "./review-course-catalog.server";
import type { ReviewedCatalogCourse } from "./review-course-catalog";
import { getSupabaseAdmin } from "./supabase/server";
import { readPublishedCatalog } from "./admin-published-catalog.server";
import { reviewedCoursePublicationShape } from "./puebla-course-publication";

type CourseCard = {
  id: string;
  courseId: string;
  clubId: string;
  name: string;
  clubName: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  aliases: string[];
  localIndexTeeAvailable: boolean;
  tee: { id: string; name: string; rating?: number; slope?: number; yards?: number; localIndexRated: boolean };
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function array(value: unknown) { return Array.isArray(value) ? value : []; }
function optionalString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function optionalNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function dataEnvironment(value: unknown): "PRODUCTION" | "QA" | "TEST" | "SYNTHETIC" | undefined {
  return ["PRODUCTION", "QA", "TEST", "SYNTHETIC"].includes(String(value)) ? value as "PRODUCTION" | "QA" | "TEST" | "SYNTHETIC" : undefined;
}

function publishedCourse(value: unknown, version: number): GolfCourseCatalog | null {
  const payload = object(value); const clubInput = object(payload?.club); const courseInput = object(payload?.course);
  if (!payload || !clubInput || !courseInput || typeof clubInput.id !== "string" || typeof clubInput.name !== "string" || typeof courseInput.id !== "string" || typeof courseInput.name !== "string") return null;
  const holesCount = courseInput.holes === 9 ? 9 : courseInput.holes === 18 ? 18 : null;
  if (!holesCount) return null;
  const environment = dataEnvironment(payload.dataEnvironment ?? payload.data_environment);
  const club: GolfClub = {
    id: clubInput.id,
    name: clubInput.name,
    aliases: array(clubInput.aliases).filter((item): item is string => typeof item === "string"),
    country: optionalString(clubInput.country),
    stateRegion: optionalString(clubInput.stateRegion),
    city: optionalString(clubInput.city),
    address: optionalString(clubInput.address),
    latitude: optionalNumber(clubInput.latitude),
    longitude: optionalNumber(clubInput.longitude),
    timezone: optionalString(clubInput.timezone),
    website: optionalString(clubInput.website),
    active: clubInput.active !== false,
    provider: "ADMIN_PUBLISHED",
    catalogVersion: version,
    sourceName: optionalString(payload.sourceName),
    sourceUrl: optionalString(payload.sourceUrl),
    verifiedAt: optionalString(payload.verifiedAt),
    dataEnvironment: environment,
  };
  const course: GolfCourse = {
    id: courseInput.id,
    clubId: club.id,
    name: courseInput.name,
    aliases: array(courseInput.aliases).filter((item): item is string => typeof item === "string"),
    holes: holesCount,
    latitude: optionalNumber(courseInput.latitude) ?? club.latitude,
    longitude: optionalNumber(courseInput.longitude) ?? club.longitude,
    active: courseInput.active !== false,
    provider: "ADMIN_PUBLISHED",
    catalogVersion: version,
    sourceName: optionalString(payload.sourceName),
    sourceUrl: optionalString(payload.sourceUrl),
    verifiedAt: optionalString(payload.verifiedAt),
    dataEnvironment: environment,
  };
  const tees = array(payload.tees).flatMap((value): GolfCourseTee[] => {
    const row = object(value); if (!row || typeof row.id !== "string" || typeof row.name !== "string") return [];
    return [{ id: row.id, courseId: course.id, legacySelectionId: row.id, name: row.name, color: optionalString(row.color), gender: optionalString(row.category), rating: optionalNumber(row.rating), slope: optionalNumber(row.slope), par: optionalNumber(row.par), totalYards: optionalNumber(row.totalYards), totalMeters: optionalNumber(row.totalMeters), frontNineRating: optionalNumber(row.frontRating), backNineRating: optionalNumber(row.backRating), active: row.active !== false, dataEnvironment: environment }];
  });
  const holes = array(payload.holes).flatMap((value): GolfHole[] => {
    const row = object(value); if (!row || typeof row.id !== "string" || typeof row.holeNumber !== "number" || typeof row.par !== "number" || typeof row.strokeIndex !== "number") return [];
    return [{ id: row.id, courseId: course.id, holeNumber: row.holeNumber, par: row.par, strokeIndex: row.strokeIndex }];
  });
  if (holes.length !== 0 && holes.length !== holesCount) return null;
  const yardages = array(payload.teeHoleYardages).flatMap((value): TeeHoleYardage[] => {
    const row = object(value); if (!row || typeof row.teeId !== "string" || typeof row.holeId !== "string" || typeof row.holeNumber !== "number") return [];
    return [{ teeId: row.teeId, holeId: row.holeId, holeNumber: row.holeNumber, yards: optionalNumber(row.yards), meters: optionalNumber(row.meters) }];
  });
  return { schemaVersion: 1, clubs: [club], courses: [course], tees, holes, teeHoleYardages: yardages, geoFeatures: [] };
}

function reviewedCoursesToCatalog(rows: readonly ReviewedCatalogCourse[]): GolfCourseCatalog {
  const clubs = new Map<string, GolfClub>();
  const courses: GolfCourse[] = [];
  const tees: GolfCourseTee[] = [];
  const holes: GolfHole[] = [];
  const teeHoleYardages: TeeHoleYardage[] = [];
  for (const row of rows) {
    const publication = reviewedCoursePublicationShape(row);
    if (!clubs.has(row.clubId)) clubs.set(row.clubId, {
      id: row.clubId,
      name: row.clubName,
      aliases: [],
      country: "México",
      city: row.city,
      stateRegion: row.stateRegion,
      latitude: row.locationEvidence ? row.latitude : undefined,
      longitude: row.locationEvidence ? row.longitude : undefined,
      active: true,
      provider: "OWNER_CATALOG_REVIEW",
      sourceName: row.locationEvidence ? "Ubicación con evidencia" : "Catálogo revisado por owner",
      sourceUrl: row.locationEvidence?.sourceUrl || row.sourceUrl,
      verifiedAt: row.locationEvidence?.verifiedAt || row.observedAt,
    });
    courses.push({ id: row.id, clubId: row.clubId, name: row.name, aliases: row.aliases, holes: publication.holes, active: true, provider: "OWNER_CATALOG_REVIEW", sourceName: publication.sourceName, sourceUrl: publication.sourceUrl, verifiedAt: publication.verifiedAt });
    const baseTee = [...publication.tees].sort((left, right) => right.holes.length - left.holes.length)[0];
    for (const hole of baseTee?.holes || []) holes.push({ id: `${row.id}:hole:${hole.hole_number}`, courseId: row.id, holeNumber: hole.hole_number, par: hole.par, strokeIndex: hole.stroke_index });
    for (const tee of publication.tees) {
      tees.push({ id: tee.id, courseId: row.id, legacySelectionId: tee.id, name: tee.name, par: tee.par ?? undefined, totalYards: tee.yards ?? undefined, active: true });
      for (const hole of tee.holes) if (hole.yards !== null) teeHoleYardages.push({ teeId: tee.id, holeId: `${row.id}:hole:${hole.hole_number}`, holeNumber: hole.hole_number, yards: hole.yards });
    }
  }
  return { schemaVersion: 1, clubs: [...clubs.values()], courses, tees, holes, teeHoleYardages, geoFeatures: [] };
}

function mergeCatalog(base: GolfCourseCatalog, overlays: readonly GolfCourseCatalog[]): GolfCourseCatalog {
  const clubs = new Map(base.clubs.map((row) => [row.id, row]));
  const courses = new Map(base.courses.map((row) => [row.id, row]));
  const tees = new Map(base.tees.map((row) => [row.id, row]));
  const holes = new Map(base.holes.map((row) => [row.id, row]));
  const yardages = new Map(base.teeHoleYardages.map((row) => [`${row.teeId}:${row.holeId}`, row]));
  for (const overlay of overlays) {
    for (const row of overlay.clubs) clubs.set(row.id, row);
    for (const row of overlay.courses) {
      const priorTeeIds = new Set([...tees.values()].filter((tee) => tee.courseId === row.id).map((tee) => tee.id));
      const priorHoleIds = new Set([...holes.values()].filter((hole) => hole.courseId === row.id).map((hole) => hole.id));
      for (const [id, tee] of tees) if (tee.courseId === row.id) tees.delete(id);
      for (const [id, hole] of holes) if (hole.courseId === row.id) holes.delete(id);
      for (const [key, yardage] of yardages) if (priorTeeIds.has(yardage.teeId) || priorHoleIds.has(yardage.holeId)) yardages.delete(key);
      courses.set(row.id, row);
    }
    for (const row of overlay.tees) tees.set(row.id, row);
    for (const row of overlay.holes) holes.set(row.id, row);
    for (const row of overlay.teeHoleYardages) yardages.set(`${row.teeId}:${row.holeId}`, row);
  }
  return { schemaVersion: 1, clubs: [...clubs.values()], courses: [...courses.values()], tees: [...tees.values()], holes: [...holes.values()], teeHoleYardages: [...yardages.values()], geoFeatures: base.geoFeatures };
}

export async function getCourseCatalog(database: SupabaseClient | null = getSupabaseAdmin("cloud")) {
  let base = INTERNAL_GOLF_COURSE_CATALOG;
  if (database && reviewCatalogQaEnabled()) {
    try {
      const reviewed = await loadReviewedCourseCatalog(database);
      if (reviewed.length) base = reviewedCoursesToCatalog(reviewed);
    } catch {
      // Fail back to the versioned internal seed; never fabricate catalog rows.
    }
  }
  const published = await readPublishedCatalog(["COURSE"]);
  const now = new Date().toISOString();
  const overlays = published.flatMap((row) => {
    if (row.status !== "PUBLISHED") return [];
    if (!publicationIsEffective({ effectiveFrom: row.effective_from, effectiveUntil: row.effective_until }, now)) return [];
    const catalog = publishedCourse(row.payload, row.version); return catalog ? [catalog] : [];
  });
  return overlays.length ? mergeCatalog(base, overlays) : base;
}

export async function getCourseCatalogProvider(database: SupabaseClient | null = getSupabaseAdmin("cloud")) {
  const catalog = await getCourseCatalog(database);
  return catalog === INTERNAL_GOLF_COURSE_CATALOG ? internalCourseCatalogProvider : createCourseCatalogProvider(catalog, "admin-published+reviewed-seed");
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}

export async function searchCourseCards(input: { query: string; limit: number; cursor?: string | null; latitude?: number; longitude?: number }, database: SupabaseClient | null = getSupabaseAdmin("cloud")) {
  const catalog = await getCourseCatalog(database);
  const clubs = new Map(catalog.clubs.map((club) => [club.id, club]));
  const cards: CourseCard[] = catalog.courses.flatMap((course) => {
    const club = clubs.get(course.clubId); if (!club || !course.active || !club.active) return [];
    const tee = catalog.tees.find((candidate) => candidate.courseId === course.id && candidate.active);
    const ratingValid = typeof tee?.rating === "number" && typeof tee.slope === "number" && Boolean(course.verifiedAt && course.sourceUrl);
    return [{ id: course.id, courseId: course.id, clubId: club.id, name: course.name, clubName: club.name, city: club.city, latitude: course.latitude ?? club.latitude, longitude: course.longitude ?? club.longitude, aliases: [...(club.aliases || []), ...(course.aliases || [])], localIndexTeeAvailable: ratingValid, tee: { id: tee?.id || course.id, name: tee?.name || "Tee por seleccionar", rating: tee?.rating, slope: tee?.slope, yards: tee?.totalYards, localIndexRated: ratingValid } }];
  });
  const tokens = normalized(input.query).split(/\s+/).filter(Boolean);
  const filtered = cards.filter((card) => tokens.every((token) => normalized(`${card.clubName} ${card.name} ${card.city || ""} ${card.aliases.join(" ")}`).includes(token)));
  const withDistance = filtered.flatMap((card) => {
    if (input.latitude === undefined || input.longitude === undefined || card.latitude === undefined || card.longitude === undefined) return [{ card, distanceKm: null as number | null }];
    const distanceKm = haversineDistanceKm({ latitude: input.latitude, longitude: input.longitude }, { latitude: card.latitude, longitude: card.longitude });
    return distanceKm === null || distanceKm > 250 ? [] : [{ card, distanceKm }];
  }).sort((left, right) => input.latitude !== undefined
    ? (left.distanceKm ?? Number.MAX_VALUE) - (right.distanceKm ?? Number.MAX_VALUE)
    : left.card.clubName.localeCompare(right.card.clubName, "es-MX") || left.card.name.localeCompare(right.card.name, "es-MX"));
  const offset = input.cursor && /^\d+$/.test(input.cursor) ? Number(input.cursor) : 0;
  const page = withDistance.slice(offset, offset + input.limit);
  const next = offset + page.length;
  return { cards: page, total: withDistance.length, hasMore: next < withDistance.length, nextCursor: next < withDistance.length ? String(next) : null, provider: catalog === INTERNAL_GOLF_COURSE_CATALOG ? "backyard-course-catalog" : "admin-published+reviewed-seed" };
}
