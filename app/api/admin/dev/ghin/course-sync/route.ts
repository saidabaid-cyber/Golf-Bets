import { NextRequest, NextResponse } from "next/server";

import { serverPhase2FeatureFlags } from "../../../../../../features/feature-flags/server";
import { BACKYARD_AI_PRIVATE_HEADERS, hasOnlyKeys, isCrossSiteRequest, readJsonBodyWithLimit } from "../../../../../../lib/backyard-ai/server/http-security";
import { compareGhinCourseDryRun } from "../../../../../../lib/ghin/course-comparison";
import { GhinClientError } from "../../../../../../lib/ghin/client";
import { buildGhinCourseSyncPlan } from "../../../../../../lib/ghin/course-sync";
import { persistGhinCourseSyncPlan } from "../../../../../../lib/ghin/course-sync.server";
import { laVistaTeeTargetMappings, reconcileLaVistaLayouts } from "../../../../../../lib/ghin/la-vista-reconciliation";
import { SlidingWindowRateLimiter } from "../../../../../../lib/ghin/core";
import { resolveGhinRuntime } from "../../../../../../lib/ghin/runtime.server";
import { INTERNAL_GOLF_COURSE_CATALOG } from "../../../../../../lib/golf-course-directory";
import { isolatedPreviewDatabaseEnabled } from "../../../../../../lib/preview-database";
import { authenticatedRequest } from "../../../../../../lib/server-auth";
import { getSupabaseAdmin } from "../../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_048;
const APPLY_CONFIRMATION = "APPLY_GHIN_COURSE_SYNC_QA";
const LA_VISTA_COURSE_ID = "23233";
const syncLimiter = new SlidingWindowRateLimiter<string>({ limit: 3, windowMs: 10 * 60_000 });

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200) {
  return NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalize(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLocaleLowerCase("en-US");
}

async function adminContext(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return { ok: false as const, response: json({ error: "Ruta no disponible.", code: "PREVIEW_ONLY" }, 404) };
  if (isCrossSiteRequest(request)) return { ok: false as const, response: json({ error: "Solicitud no permitida.", code: "CROSS_SITE_REJECTED" }, 403) };
  if (!serverPhase2FeatureFlags().admin_v1) return { ok: false as const, response: json({ error: "Admin está desactivado.", code: "FEATURE_DISABLED" }, 404) };
  const account = await authenticatedRequest(request);
  if (!account.ok) return { ok: false as const, response: json({ error: account.error, code: account.code }, account.status) };
  const memberships = await account.client.from("admin_memberships").select("id").eq("user_id", account.userId).eq("active", true).limit(1);
  if (memberships.error) return { ok: false as const, response: json({ error: "No fue posible comprobar el acceso.", code: "ADMIN_CHECK_FAILED" }, 503) };
  if (!memberships.data?.length) return { ok: false as const, response: json({ error: "Se requiere acceso administrativo.", code: "ADMIN_REQUIRED" }, 403) };
  return { ok: true as const, userId: account.userId };
}

export async function POST(request: NextRequest) {
  const access = await adminContext(request);
  if (!access.ok) return access.response;
  if (request.nextUrl.search) return json({ error: "Esta operación no acepta selectores.", code: "SELECTORS_REJECTED" }, 400);
  if (!isolatedPreviewDatabaseEnabled()) {
    return json({ error: "La base QA canónica no está enlazada.", code: "QA_DATABASE_BINDING_REJECTED" }, 503);
  }
  const decision = syncLimiter.consume(access.userId);
  if (!decision.allowed) {
    const retryAfter = Math.ceil(decision.retryAfterMs / 1_000);
    return NextResponse.json({ error: "Espera antes de volver a sincronizar.", code: "RATE_LIMITED", retryAfterSeconds: retryAfter }, {
      status: 429,
      headers: { ...BACKYARD_AI_PRIVATE_HEADERS, "retry-after": String(retryAfter) },
    });
  }
  const parsed = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  const input = parsed.ok ? record(parsed.value) : null;
  if (!input || !hasOnlyKeys(input, ["operation", "courseId", "confirmation"])) return json({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);
  const operation = input.operation;
  const courseId = typeof input.courseId === "string" ? input.courseId.trim() : "";
  if (!/^\d{1,12}$/.test(courseId) || !["dry_run", "apply_confirmed"].includes(String(operation))) {
    return json({ error: "Solicitud inválida.", code: "INVALID_REQUEST" }, 400);
  }

  const runtimeState = resolveGhinRuntime();
  if (!runtimeState.ok || !runtimeState.capabilities.courseLookup) {
    return json({ error: "GHIN course lookup no está disponible.", code: runtimeState.ok ? "GHIN_COURSE_LOOKUP_DISABLED" : runtimeState.blocker }, 503);
  }
  if (operation === "apply_confirmed" && (!runtimeState.capabilities.courseSyncEnabled || input.confirmation !== APPLY_CONFIRMATION)) {
    return json({ error: "La sincronización aplicada requiere flag y confirmación explícitos.", code: "GHIN_COURSE_SYNC_NOT_CONFIRMED" }, 409);
  }
  const database = getSupabaseAdmin("cloud");
  if (!database) return json({ error: "Supabase QA no está configurado.", code: "QA_DATABASE_UNAVAILABLE" }, 503);

  try {
    const client = runtimeState.client;
    const details = await client.getCourse(courseId);
    const [postingResult, facilityResult] = await Promise.all([
      client.getScorePostingTees(courseId)
        .then((value) => ({ value, error: null }))
        .catch((error: unknown) => ({ value: null, error })),
      details.data.facilityId
        ? client.searchFacilities({ facilityId: details.data.facilityId })
          .then((value) => ({ value, error: null }))
          .catch((error: unknown) => ({ value: null, error }))
        : Promise.resolve({ value: null, error: null }),
    ]);
    const postingTees = postingResult.value;
    const facilities = facilityResult.value;
    const isKnownLaVista = courseId === LA_VISTA_COURSE_ID
      && details.data.facilityId === "19886"
      && normalize(details.data.facilityName) === normalize("La Vista Country Club");
    const reconciliation = reconcileLaVistaLayouts(
      [details.data],
      postingTees ? { [courseId]: postingTees.data } : {},
    );
    const confirmedPar72 = reconciliation.some((row) => row.layout === "PAR_72"
      && row.status === "GHIN_MATCH_CONFIRMED"
      && row.ghinCourseId === LA_VISTA_COURSE_ID);
    if (operation === "apply_confirmed" && (!isKnownLaVista || !confirmedPar72)) {
      return json({
        error: "El mapping oficial de La Vista Par 72 no está confirmado con la evidencia live actual.",
        code: "GHIN_LA_VISTA_MAPPING_NOT_CONFIRMED",
        reconciliation,
      }, 409);
    }
    let target: {
      targetClubId?: string;
      targetCourseId?: string;
      targetTeeIdsByProviderId?: Readonly<Record<string, string>>;
      targetHoleIdsByNumber?: Readonly<Record<number, string>>;
      targetYardageIdsByTeeAndHoleNumber?: Readonly<Record<string, string>>;
    } = {};
    if (isKnownLaVista) {
      const [holeResult, yardageResult] = await Promise.all([
        database.from("golf_holes").select("id,hole_number").eq("course_id", "course-la-vista"),
        database.from("golf_tee_hole_yardages").select("id,tee_id,hole_id").eq("course_id", "course-la-vista"),
      ]);
      if (holeResult.error || yardageResult.error) throw new Error("BACKYARD_LA_VISTA_IDENTITY_LOOKUP_FAILED");
      const targetHoleIdsByNumber = Object.fromEntries((holeResult.data ?? []).map((hole) => [Number(hole.hole_number), String(hole.id)]));
      const numberByHoleId = new Map((holeResult.data ?? []).map((hole) => [String(hole.id), Number(hole.hole_number)]));
      const targetYardageIdsByTeeAndHoleNumber = Object.fromEntries((yardageResult.data ?? []).flatMap((yardage) => {
        const number = numberByHoleId.get(String(yardage.hole_id));
        return number ? [[`${String(yardage.tee_id)}:${number}`, String(yardage.id)]] : [];
      }));
      target = {
        targetClubId: "club-la-vista",
        targetCourseId: "course-la-vista",
        targetTeeIdsByProviderId: laVistaTeeTargetMappings(details.data.tees),
        targetHoleIdsByNumber,
        targetYardageIdsByTeeAndHoleNumber,
      };
    }
    const comparison = isKnownLaVista ? compareGhinCourseDryRun(INTERNAL_GOLF_COURSE_CATALOG, details.data, {
      backyardCourseId: "course-la-vista",
      teeMatches: [
        { backyardTeeId: "tee-la-vista-azules", aliases: ["Blue"] },
        { backyardTeeId: "tee-la-vista-blancas", aliases: ["White"] },
        { backyardTeeId: "tee-la-vista-doradas", aliases: ["Gold", "Golden"] },
        { backyardTeeId: "tee-la-vista-rojas", aliases: ["Red", "Ladies"] },
        { backyardTeeId: "tee-la-vista-negras", aliases: ["Black"] },
      ],
    }) : null;
    const plan = buildGhinCourseSyncPlan({
      course: details.data,
      facility: facilities?.data.find((facility) => facility.id === details.data.facilityId) ?? null,
      scorePostingTees: postingTees?.data ?? [],
      ...target,
      confirmMapping: operation === "apply_confirmed" && confirmedPar72,
      observedAt: details.fetchedAt,
    });
    const persisted = await persistGhinCourseSyncPlan(database, plan, {
      mode: operation === "apply_confirmed" ? "APPLY" : "DRY_RUN",
      actorId: access.userId,
      diffSummary: comparison?.summary ?? {},
    });
    let databaseState: JsonRecord | null = null;
    if (persisted.applied) {
      const [clubRows, courseRows, teeRows, holeRows, yardageRows, courseLinkRows, teeLinkRows] = await Promise.all([
        database.from("golf_clubs").select("id,provider,provider_external_id,origin,is_provisional,provider_status,last_synced_at").eq("id", "club-la-vista"),
        database.from("golf_courses").select("id,name,provider,provider_external_id,origin,layout_type,is_provisional,provider_status,total_par,last_synced_at").eq("club_id", "club-la-vista"),
        database.from("golf_course_tees").select("id,name,gender,provider,provider_external_id,origin,provider_status,total_yards,rating,slope,par,active,last_synced_at").eq("course_id", "course-la-vista"),
        database.from("golf_holes").select("id", { count: "exact", head: true }).eq("course_id", "course-la-vista"),
        database.from("golf_tee_hole_yardages").select("id", { count: "exact", head: true }).eq("course_id", "course-la-vista"),
        database.from("golf_course_provider_links").select("external_facility_id,external_course_id,sync_status").eq("course_id", "course-la-vista").eq("provider", "GHIN"),
        database.from("golf_tee_provider_links").select("tee_id,external_tee_set_id,sync_status").eq("course_id", "course-la-vista").eq("provider", "GHIN"),
      ]);
      if ([clubRows, courseRows, teeRows, holeRows, yardageRows, courseLinkRows, teeLinkRows].some((result) => result.error)) {
        throw new Error("GHIN_COURSE_SYNC_VERIFICATION_FAILED");
      }
      const activeTees = (teeRows.data ?? []).filter((tee) => tee.active !== false);
      const preservedInactiveTees = (teeRows.data ?? []).filter((tee) => tee.active === false);
      const activeTeeIds = activeTees.map((tee) => String(tee.id));
      const activeYardageRows = activeTeeIds.length
        ? await database.from("golf_tee_hole_yardages").select("id", { count: "exact", head: true }).eq("course_id", "course-la-vista").in("tee_id", activeTeeIds)
        : { count: 0, error: null };
      if (activeYardageRows.error) throw new Error("GHIN_COURSE_SYNC_VERIFICATION_FAILED");
      databaseState = {
        club: clubRows.data?.[0] ?? null,
        layouts: courseRows.data ?? [],
        tees: activeTees,
        preservedInactiveTees,
        holeCount: holeRows.count ?? 0,
        yardageCount: activeYardageRows.count ?? 0,
        preservedYardageCount: Math.max(0, (yardageRows.count ?? 0) - (activeYardageRows.count ?? 0)),
        courseProviderLinks: courseLinkRows.data ?? [],
        teeProviderLinks: teeLinkRows.data ?? [],
      };
    }
    return json({
      status: persisted.applied ? "PASS" : persisted.candidateOnly ? "PENDING_REVIEW" : "DRY_RUN_PASS",
      mode: operation === "apply_confirmed" ? "APPLY" : "DRY_RUN",
      provider: "GHIN",
      facilityId: details.data.facilityId,
      courseId: details.data.id,
      teeSetRatingIds: details.data.tees.flatMap((tee) => tee.id ? [tee.id] : []),
      scorePostingTeeSetRatingIds: postingTees?.data.flatMap((tee) => tee.id ? [tee.id] : []) ?? [],
      scorePostingEligibility: postingResult.error instanceof GhinClientError ? {
        status: "BLOCKED_EXTERNAL",
        code: postingResult.error.code,
        httpStatus: postingResult.error.httpStatus,
      } : postingTees ? { status: "PASS", httpStatus: postingTees.httpStatus } : { status: "BLOCKED_EXTERNAL" },
      completeForPlay: plan.completeForPlay,
      completeForScorePosting: plan.completeForScorePosting,
      warnings: [
        ...plan.warnings,
        ...(postingResult.error ? ["TeeSetRatingsForScorePosting no está disponible para este token; Course Data se conservó."] : []),
        ...(facilityResult.error ? ["Facility Search no está disponible; se usaron sólo los datos de Course Details."] : []),
      ],
      facilityLookup: facilities ? { status: "PASS", httpStatus: facilities.httpStatus } : { status: "BLOCKED_EXTERNAL" },
      comparison: comparison?.summary ?? null,
      reconciliation,
      persisted,
      databaseState,
      safety: { previewOnly: true, adminOnly: true, scorePostingExecuted: false, secretsStored: false },
    });
  } catch (error) {
    const status = error instanceof GhinClientError ? error.httpStatus ?? 502 : 500;
    return json({
      error: "No fue posible completar la sincronización GHIN.",
      code: error instanceof GhinClientError ? error.code : "GHIN_COURSE_SYNC_FAILED",
      httpStatus: error instanceof GhinClientError ? error.httpStatus : null,
    }, status >= 400 && status < 600 ? status : 500);
  }
}
