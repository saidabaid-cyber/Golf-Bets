import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_COURSES } from "../../../../lib/golf-course-directory";
import { internalCourseDataProvider } from "../../../../lib/golf-providers";
import { internalCourseCatalogProvider } from "../../../../lib/course-catalog-provider";
import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";

function hasLocalRatedTee(courseId: string) {
  return DEFAULT_COURSES.some((course) => (course.catalogCourseId ?? course.id) === courseId && course.indexRatingEvidence?.kind === "CURATED_RATED_TEE");
}

export async function GET(request: NextRequest) {
  if (!serverPhase2FeatureFlags().course_search) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const query = request.nextUrl.searchParams.get("q")?.slice(0, 120) ?? "";
  const cursor = request.nextUrl.searchParams.get("cursor")?.slice(0, 180) || undefined;
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.trunc(requestedLimit))) : 20;
  if (request.nextUrl.searchParams.get("scope") === "clubs") {
    const result = await internalCourseCatalogProvider.searchClubs(query, limit, cursor);
    if (!result.ok) return NextResponse.json({ error: result.code }, { status: 503, headers: { "cache-control": "no-store" } });
    return NextResponse.json({
      provider: result.providerId,
      query,
      total: result.data.total,
      hasMore: result.data.hasMore,
      nextCursor: result.data.nextCursor,
      clubs: result.data.clubs.map((club) => ({ id: club.id, name: club.name, city: club.city, stateRegion: club.stateRegion, country: club.country })),
    }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" } });
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
    const result = await internalCourseDataProvider.nearbyCourses({ courses: DEFAULT_COURSES, origin: { latitude, longitude }, limit, radiusKm: 50 });
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
        localIndexTeeAvailable: hasLocalRatedTee(course.catalogCourseId ?? course.id),
        tee: { id: course.catalogTeeId ?? course.id, name: course.teeName, rating: course.rating, slope: course.slope, yards: course.totalYards, localIndexRated: course.indexRatingEvidence?.kind === "CURATED_RATED_TEE" },
      })),
    }, { headers: { "cache-control": "private, no-store" } });
  }
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
      localIndexTeeAvailable: hasLocalRatedTee(course.catalogCourseId ?? course.id),
      tee: { id: course.catalogTeeId ?? course.id, name: course.teeName, rating: course.rating, slope: course.slope, yards: course.totalYards, localIndexRated: course.indexRatingEvidence?.kind === "CURATED_RATED_TEE" },
    })),
  }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" } });
}
