import { NextRequest, NextResponse } from "next/server";

import { publicationIsEffective } from "../../../../../lib/admin-control-center";
import { getCourseCatalog } from "../../../../../lib/course-catalog-provider.server";
import { resolveEffectiveCourse, type CourseConfiguration } from "../../../../../lib/course-configuration-resolver";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  const { courseId: rawCourseId } = await context.params;
  const courseId = decodeURIComponent(rawCourseId).slice(0, 240);
  const at = request.nextUrl.searchParams.get("at") || new Date().toISOString();
  const requestedCompetitionId = request.nextUrl.searchParams.get("competitionId")?.slice(0, 60) || null;
  if (!courseId || Number.isNaN(Date.parse(at))) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });

  const catalog = await getCourseCatalog();
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
  const database = getSupabaseAdmin("cloud");
  if (!database) {
    const resolved = resolveEffectiveCourse({ base, configurations: [], at });
    return NextResponse.json({ resolved, localRules: [], badges: [], competitionId: null, competitionRuleSet: null }, { headers: { "cache-control": "public, s-maxage=5" } });
  }

  let competitionId: string | null = null;
  let competitionRuleSet: { id: string; version: number } | null = null;
  if (requestedCompetitionId && /^[0-9a-f-]{36}$/i.test(requestedCompetitionId)) {
    const competitionRevisions = await database.from("admin_catalog_revisions").select("version,payload,effective_from,effective_until").eq("entity_type", "COMPETITION").eq("entity_id", requestedCompetitionId).eq("status", "PUBLISHED").order("version", { ascending: false }).limit(20);
    const activeRevision = (competitionRevisions.data || []).find((row) => publicationIsEffective({ effectiveFrom: row.effective_from, effectiveUntil: row.effective_until }, at));
    const payload = activeRevision?.payload && typeof activeRevision.payload === "object" && !Array.isArray(activeRevision.payload) ? activeRevision.payload as Record<string, unknown> : null;
    if (!competitionRevisions.error && activeRevision && payload?.courseId === courseId && payload.visibility === "PUBLIC") {
      competitionId = requestedCompetitionId;
      const rules = await database.from("competition_rule_sets").select("id,version").eq("competition_id", competitionId).eq("version", activeRevision.version).eq("status", "PUBLISHED").maybeSingle();
      if (!rules.error && rules.data) competitionRuleSet = rules.data;
    }
  }

  const configurationsResult = await database.from("course_configurations").select("id,course_id,competition_id,scope_type,status,version,revision_hash,effective_from,effective_until").eq("course_id", courseId).in("status", ["SCHEDULED", "PUBLISHED"]).limit(10);
  const configurationIds = (configurationsResult.data || []).map((row) => row.id);
  const [configurationHoles, configurationYardages, configurationRatings, localRules, documents] = await Promise.all([
    configurationIds.length ? database.from("course_configuration_holes").select("*").in("configuration_id", configurationIds).order("sequence") : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? database.from("course_configuration_tee_holes").select("*,course_configuration_holes!inner(configuration_id)").in("course_configuration_holes.configuration_id", configurationIds) : Promise.resolve({ data: [], error: null }),
    configurationIds.length ? database.from("course_configuration_ratings").select("*").in("configuration_id", configurationIds) : Promise.resolve({ data: [], error: null }),
    database.from("admin_catalog_revisions").select("id,version,status,payload,effective_from,effective_until").eq("entity_type", "LOCAL_RULE_SET").eq("scope_type", "COURSE").eq("scope_id", courseId).in("status", ["PUBLISHED", "SCHEDULED"]).order("version", { ascending: false }).limit(20),
    database.from("admin_documents").select("id,original_name,mime_type,attribution,owner_entity_type").eq("scope_type", "COURSE").eq("scope_id", courseId).eq("rights_status", "APPROVED").eq("visibility", "PLAYER").in("owner_entity_type", ["COURSE", "LOCAL_RULE_SET"]),
  ]);
  if (configurationsResult.error || configurationHoles.error || configurationYardages.error || configurationRatings.error || localRules.error || documents.error) {
    const resolved = resolveEffectiveCourse({ base, configurations: [], at, competitionId });
    return NextResponse.json({ resolved, localRules: [], badges: [], competitionId, competitionRuleSet, warning: "No fue posible consultar operaciones temporales." }, { headers: { "cache-control": "private, no-store" } });
  }
  const configRows: CourseConfiguration[] = (configurationsResult.data || []).map((row) => ({
    id: row.id,
    courseId: row.course_id,
    competitionId: row.competition_id,
    scopeType: row.scope_type as CourseConfiguration["scopeType"],
    status: row.status as CourseConfiguration["status"],
    version: row.version,
    revisionHash: row.revision_hash,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    holes: (configurationHoles.data || []).filter((hole) => hole.configuration_id === row.id).map((hole) => ({
      id: hole.id,
      sequence: hole.sequence,
      runtimeHoleNumber: hole.runtime_hole_number,
      displayLabel: hole.display_label,
      sourceBaseHoleId: hole.source_base_hole_id,
      sourceBaseHoleNumber: hole.source_base_hole_number,
      kind: hole.kind,
      playable: hole.playable,
      parOverride: hole.par_override,
      strokeIndexOverride: hole.stroke_index_override,
      notes: hole.notes,
      temporaryGreen: hole.temporary_green,
      temporaryTee: hole.temporary_tee,
      dropZoneNote: hole.drop_zone_note,
      operationalNote: hole.operational_note,
    })),
    teeHoles: (configurationYardages.data || []).filter((yardage) => {
      const relation = yardage.course_configuration_holes as unknown;
      return object(Array.isArray(relation) ? relation[0] : relation)?.configuration_id === row.id;
    }).map((yardage) => ({ configurationHoleId: yardage.configuration_hole_id, teeId: yardage.tee_id, yardsOverride: yardage.yards_override, source: yardage.source, verifiedAt: yardage.verified_at })),
    ratings: (configurationRatings.data || []).filter((rating) => rating.configuration_id === row.id).map((rating) => ({ teeId: rating.tee_id, rating: rating.rating, slope: rating.slope, category: rating.category, source: rating.source, verifiedAt: rating.verified_at })),
  }));
  try {
    const resolved = resolveEffectiveCourse({ base, configurations: configRows, at, competitionId });
    const effectiveRuleSet = (localRules.data || []).find((row) => publicationIsEffective({ effectiveFrom: row.effective_from, effectiveUntil: row.effective_until }, at));
    const rulePayload = effectiveRuleSet?.payload;
    const rules = object(rulePayload) && Array.isArray(object(rulePayload)?.rules) ? object(rulePayload)?.rules : [];
    const badges = [...(resolved.configurationIds.length ? ["TEMPORAL"] : []), ...(Array.isArray(rules) && rules.length ? ["Reglas locales"] : []), ...((documents.data || []).length ? ["Documentos"] : [])];
    const publishedDocuments = (documents.data || []).map((document) => ({ id: document.id, name: document.original_name, mimeType: document.mime_type, attribution: document.attribution, url: `/api/courses/${encodeURIComponent(courseId)}/documents/${document.id}` }));
    return NextResponse.json({ resolved, localRules: rules, documents: publishedDocuments, badges, competitionId, competitionRuleSet }, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=30" } });
  } catch {
    const resolved = resolveEffectiveCourse({ base, configurations: [], at, competitionId });
    return NextResponse.json({ resolved, localRules: [], badges: [], competitionId: null, competitionRuleSet: null, warning: "La configuración publicada contiene un conflicto y no se aplicó." }, { headers: { "cache-control": "private, no-store" } });
  }
}
