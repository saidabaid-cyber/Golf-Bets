import { NextRequest, NextResponse } from "next/server";

import { getCourseCatalog } from "../../../../../lib/course-catalog-provider.server";
import { resolveEffectiveCourse, type CourseConfiguration } from "../../../../../lib/course-configuration-resolver";
import { getSupabasePublic } from "../../../../../lib/supabase/server";
import { authenticatedRequest, bearerToken } from "../../../../../lib/server-auth";

export const dynamic = "force-dynamic";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function list(value: unknown) { return Array.isArray(value) ? value : []; }

export async function GET(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  const { courseId: rawCourseId } = await context.params;
  const courseId = decodeURIComponent(rawCourseId).slice(0, 240);
  const at = request.nextUrl.searchParams.get("at") || new Date().toISOString();
  const requestedCompetitionId = request.nextUrl.searchParams.get("competitionId")?.slice(0, 60) || null;
  if (!courseId || Number.isNaN(Date.parse(at))) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });

  const hasBearer = Boolean(bearerToken(request));
  const auth = hasBearer ? await authenticatedRequest(request) : null;
  if (auth && !auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status, headers: { "cache-control": "private, no-store" } });
  const catalog = await getCourseCatalog(auth?.ok ? auth.client : null);
  const course = catalog.courses.find((candidate) => candidate.id === courseId && candidate.active);
  const club = course ? catalog.clubs.find((candidate) => candidate.id === course.clubId) : null;
  if (!course || !club) return NextResponse.json({ error: "Campo no encontrado." }, { status: 404 });
  const holes = catalog.holes.filter((hole) => hole.courseId === courseId).sort((left, right) => left.holeNumber - right.holeNumber);
  const tees = catalog.tees.filter((tee) => tee.courseId === courseId && tee.active).map((tee) => ({
    id: tee.id,
    name: tee.name,
    rating: tee.rating ?? null,
    slope: tee.slope ?? null,
    category: tee.gender ?? null,
    yardages: Object.fromEntries(catalog.teeHoleYardages.filter((row) => row.teeId === tee.id).map((row) => [row.holeId, row.yards ?? null])),
  }));
  const base = { id: course.id, name: `${club.name} · ${course.name}`, version: course.catalogVersion || 1, holes: holes.map((hole) => ({ id: hole.id, holeNumber: hole.holeNumber, par: hole.par, strokeIndex: hole.strokeIndex })), tees };
  const database = auth?.ok ? auth.client : getSupabasePublic("cloud");
  if (!database) {
    const resolved = resolveEffectiveCourse({ base, configurations: [], at });
    return NextResponse.json({ resolved, localRules: [], badges: [], competitionId: null, competitionRuleSet: null }, { headers: { "cache-control": "public, s-maxage=5" } });
  }
  const projection = await database.rpc("player_course_operations_v1", {
    requested_course_id: courseId,
    effective_at: at,
    requested_competition_id: requestedCompetitionId && /^[0-9a-f-]{36}$/i.test(requestedCompetitionId) ? requestedCompetitionId : null,
  });
  const projected = object(projection.data);
  if (projection.error || !projected) {
    const resolved = resolveEffectiveCourse({ base, configurations: [], at });
    return NextResponse.json({ resolved, localRules: [], badges: [], competitionId: null, competitionRuleSet: null, warning: "No fue posible consultar operaciones temporales." }, { headers: { "cache-control": "private, no-store" } });
  }
  const competitionId = typeof projected.competitionId === "string" ? projected.competitionId : null;
  const competitionRule = object(projected.competitionRuleSet);
  const competitionRuleSet = competitionRule && typeof competitionRule.id === "string" && typeof competitionRule.version === "number"
    ? { id: competitionRule.id, version: competitionRule.version }
    : null;
  const configRows = list(projected.configurations).filter((value): value is Record<string, unknown> => object(value) !== null).map((row) => ({
    id: String(row.id),
    courseId: String(row.courseId),
    competitionId: typeof row.competitionId === "string" ? row.competitionId : null,
    scopeType: row.scopeType as CourseConfiguration["scopeType"],
    status: row.status as CourseConfiguration["status"],
    version: Number(row.version),
    revisionHash: String(row.revisionHash || ""),
    effectiveFrom: typeof row.effectiveFrom === "string" ? row.effectiveFrom : null,
    effectiveUntil: typeof row.effectiveUntil === "string" ? row.effectiveUntil : null,
    holes: list(row.holes) as CourseConfiguration["holes"],
    teeHoles: list(row.teeHoles) as CourseConfiguration["teeHoles"],
    ratings: list(row.ratings) as CourseConfiguration["ratings"],
  } satisfies CourseConfiguration));
  try {
    const resolved = resolveEffectiveCourse({ base, configurations: configRows, at, competitionId });
    const rules = list(projected.localRules);
    const documents = list(projected.documents).filter((value): value is Record<string, unknown> => object(value) !== null);
    const badges = [...(resolved.configurationIds.length ? ["TEMPORAL"] : []), ...(rules.length ? ["Reglas locales"] : []), ...(documents.length ? ["Documentos"] : [])];
    const publishedDocuments = documents.map((document) => ({ id: String(document.id), name: String(document.name), mimeType: String(document.mimeType), attribution: typeof document.attribution === "string" ? document.attribution : null, url: `/api/courses/${encodeURIComponent(courseId)}/documents/${String(document.id)}` }));
    return NextResponse.json({ resolved, localRules: rules, documents: publishedDocuments, badges, competitionId, competitionRuleSet }, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=30" } });
  } catch {
    const resolved = resolveEffectiveCourse({ base, configurations: [], at, competitionId });
    return NextResponse.json({ resolved, localRules: [], badges: [], competitionId: null, competitionRuleSet: null, warning: "La configuración publicada contiene un conflicto y no se aplicó." }, { headers: { "cache-control": "private, no-store" } });
  }
}
