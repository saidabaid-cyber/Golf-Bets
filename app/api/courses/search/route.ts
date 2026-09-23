import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_COURSES } from "../../../../lib/golf-course-directory";
import { internalCourseDataProvider } from "../../../../lib/golf-providers";
import { internalCourseCatalogProvider } from "../../../../lib/course-catalog-provider";
import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";
import { authenticatedRequest, bearerToken } from "../../../../lib/server-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

type LayeredSearch = Awaited<ReturnType<typeof import("../../../../lib/course-catalog-provider.server").searchCourseCards>>;

async function layeredSearch(input: { query: string; limit: number; cursor?: string; latitude?: number; longitude?: number }, database: SupabaseClient | null): Promise<LayeredSearch | null> {
  try {
    const { searchCourseCards } = await import("../../../../lib/course-catalog-provider.server");
    return await searchCourseCards(input, database);
  } catch {
    // The versioned local provider remains a deterministic offline fallback.
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!serverPhase2FeatureFlags().course_search) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  let database: SupabaseClient | null = null;
  const hasBearer = Boolean(bearerToken(request));
  if (hasBearer) {
    const auth = await authenticatedRequest(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status, headers: { "cache-control": "private, no-store" } });
    database = auth.client;
  }
  const responseCache = hasBearer
    ? { "cache-control": "private, no-store" }
    : { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" };
  const query = request.nextUrl.searchParams.get("q")?.slice(0, 120) ?? "";
  const cursor = request.nextUrl.searchParams.get("cursor")?.slice(0, 180) || undefined;
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.trunc(requestedLimit))) : 20;
  if (request.nextUrl.searchParams.get("scope") === "clubs") {
    let provider = internalCourseCatalogProvider;
    try {
      const catalogModule = await import("../../../../lib/course-catalog-provider.server");
      provider = await catalogModule.getCourseCatalogProvider(database);
    } catch {
      // Keep the internal reviewed seed available during a temporary DB outage.
    }
    const result = await provider.searchClubs(query, limit, cursor);
    if (!result.ok) return NextResponse.json({ error: result.code }, { status: 503, headers: { "cache-control": "no-store" } });
    return NextResponse.json({
      provider: result.providerId,
      query,
      total: result.data.total,
      hasMore: result.data.hasMore,
      nextCursor: result.data.nextCursor,
      clubs: result.data.clubs.map((club) => ({ id: club.id, name: club.name, city: club.city, stateRegion: club.stateRegion, country: club.country })),
    }, { headers: responseCache });
  }
  if (request.nextUrl.searchParams.get("nearby") === "1") {
    const latitudeInput = request.nextUrl.searchParams.get("lat");
    const longitudeInput = request.nextUrl.searchParams.get("lng");
    const latitude = Number(latitudeInput);
    const longitude = Number(longitudeInput);
    // Number(null) and Number("") are zero, not evidence of a real location.
    if (!latitudeInput?.trim() || !longitudeInput?.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: "invalid_location" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    const layered = await layeredSearch({ query, limit: 50, cursor, latitude, longitude }, database);
    if (layered) return NextResponse.json({
      provider: layered.provider,
      total: layered.cards.filter(({ distanceKm }) => distanceKm !== null && distanceKm <= 50).length,
      courses: layered.cards.filter(({ distanceKm }) => distanceKm !== null && distanceKm <= 50).slice(0, 3).map(({ card: course, distanceKm }) => ({
        ...course,
        distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
      })),
    }, { headers: { "cache-control": "private, no-store" } });
    const result = await internalCourseDataProvider.nearbyCourses({ courses: DEFAULT_COURSES, origin: { latitude, longitude }, limit: Math.min(3, limit), radiusKm: 50 });
    if (!result.ok) return NextResponse.json({ error: result.code }, { status: 503, headers: { "cache-control": "no-store" } });
    return NextResponse.json({
      provider: result.providerId,
      total: result.data.total,
      courses: result.data.matches.map(({ course, distanceKm }) => ({
        id: course.id,
        courseId: course.catalogCourseId ?? course.id,
        clubId: course.catalogClubId,
        name: course.name,
        clubName: course.clubName,
        city: course.city,
        distanceKm: Math.round(distanceKm * 10) / 10,
        localIndexTeeAvailable: course.indexRatingEvidence?.kind === "CURATED_RATED_TEE",
        tee: { id: course.catalogTeeId ?? course.id, name: course.teeName, rating: course.rating, slope: course.slope, yards: course.totalYards, localIndexRated: course.indexRatingEvidence?.kind === "CURATED_RATED_TEE" },
      })),
    }, { headers: { "cache-control": "private, no-store" } });
  }
  const layered = await layeredSearch({ query, limit, cursor }, database);
  if (layered) return NextResponse.json({
    provider: layered.provider,
    query,
    total: layered.total,
    hasMore: layered.hasMore,
    nextCursor: layered.nextCursor,
    courses: layered.cards.map(({ card }) => card),
  }, { headers: responseCache });
  const result = await internalCourseDataProvider.searchCourses({ courses: DEFAULT_COURSES, query, cursor, limit });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json({
    provider: result.providerId,
    query: result.data.query,
    total: result.data.total,
    hasMore: result.data.hasMore,
    nextCursor: result.data.nextCursor,
    courses: result.data.courses.map((course) => ({
      id: course.id,
      courseId: course.catalogCourseId ?? course.id,
      clubId: course.catalogClubId,
      name: course.name,
      clubName: course.clubName,
      city: course.city,
      localIndexTeeAvailable: course.indexRatingEvidence?.kind === "CURATED_RATED_TEE",
      tee: { id: course.catalogTeeId ?? course.id, name: course.teeName, rating: course.rating, slope: course.slope, yards: course.totalYards, localIndexRated: course.indexRatingEvidence?.kind === "CURATED_RATED_TEE" },
    })),
  }, { headers: responseCache });
}
