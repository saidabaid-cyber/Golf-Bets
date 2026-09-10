import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_COURSES } from "../../../../lib/golf-course-directory";
import { internalCourseDataProvider } from "../../../../lib/golf-providers";
import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";

export async function GET(request: NextRequest) {
  if (!serverPhase2FeatureFlags().course_search) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const query = request.nextUrl.searchParams.get("q")?.slice(0, 120) ?? "";
  const cursor = request.nextUrl.searchParams.get("cursor")?.slice(0, 180) || undefined;
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.trunc(requestedLimit))) : 20;
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
      tee: { id: course.catalogTeeId ?? course.id, name: course.teeName, rating: course.rating, slope: course.slope, yards: course.totalYards },
    })),
  }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" } });
}
