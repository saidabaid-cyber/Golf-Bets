import { NextRequest, NextResponse } from "next/server";

import { serverPhase2FeatureFlags } from "../../../../../features/feature-flags/server";
import {
  compareGhinCourseDryRun,
  proposeLaVistaGhinMappings,
  type GhinTeeMatchRule,
} from "../../../../../lib/ghin/course-comparison";
import { GhinClientError } from "../../../../../lib/ghin/client";
import { SlidingWindowRateLimiter, type NormalizedGhinCourse } from "../../../../../lib/ghin/core";
import { resolveGhinRuntime } from "../../../../../lib/ghin/runtime.server";
import { INTERNAL_GOLF_COURSE_CATALOG } from "../../../../../lib/golf-course-directory";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  hasOnlyKeys,
  isCrossSiteRequest,
  readJsonBodyWithLimit,
} from "../../../../../lib/backyard-ai/server/http-security";
import { authenticatedRequest } from "../../../../../lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GHIN_NUMBER = "11103349";
const EXPECTED_NAME = "Said Abaid Taja";
const EXPECTED_CLUB = "La Vista Country Club";
const COURSE_QUERY = "La Vista";
const MAX_BODY_BYTES = 1_024;
const diagnosticLimiter = new SlidingWindowRateLimiter<string>({ limit: 3, windowMs: 10 * 60_000 });

const TEE_MATCHES: readonly GhinTeeMatchRule[] = [
  { backyardTeeId: "tee-la-vista-azules", aliases: ["Blue"] },
  { backyardTeeId: "tee-la-vista-blancas", aliases: ["White"] },
  { backyardTeeId: "tee-la-vista-doradas", aliases: ["Gold", "Golden"] },
  { backyardTeeId: "tee-la-vista-rojas", aliases: ["Red"] },
];

type DiagnosticStatus =
  | "PASS"
  | "FAIL"
  | "PARTIAL"
  | "BLOCKED_EXTERNAL"
  | "PENDING_CONTROLLED_DB_APPLY"
  | "PENDING_INTERACTIVE_QA";

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200, headers: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...BACKYARD_AI_PRIVATE_HEADERS, ...headers },
  });
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalizeIdentity(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function safeFailure(error: unknown) {
  if (error instanceof GhinClientError) {
    return {
      code: error.code,
      message: error.message,
      httpStatus: error.httpStatus,
      endpoint: error.endpoint,
      retryable: error.retryable,
    };
  }
  return {
    code: "unknown",
    message: "No se pudo completar la consulta GHIN.",
    httpStatus: null,
    endpoint: null,
    retryable: false,
  };
}

function externalFailureStatus(error: unknown): DiagnosticStatus {
  if (!(error instanceof GhinClientError)) return "FAIL";
  return ["invalid_response", "not_found", "inactive_golfer"].includes(error.code) ? "FAIL" : "BLOCKED_EXTERNAL";
}

async function adminContext(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return { ok: false as const, response: json({ error: "Ruta no disponible.", code: "PREVIEW_ONLY" }, 404) };
  }
  if (isCrossSiteRequest(request)) {
    return { ok: false as const, response: json({ error: "Solicitud no permitida.", code: "CROSS_SITE_REJECTED" }, 403) };
  }
  if (request.nextUrl.search) {
    return { ok: false as const, response: json({ error: "Este diagnóstico no acepta selectores.", code: "SELECTORS_REJECTED" }, 400) };
  }
  if (!serverPhase2FeatureFlags().admin_v1) {
    return { ok: false as const, response: json({ error: "Admin está desactivado.", code: "FEATURE_DISABLED" }, 404) };
  }
  const account = await authenticatedRequest(request);
  if (!account.ok) {
    return { ok: false as const, response: json({ error: account.error, code: account.code }, account.status) };
  }
  const memberships = await account.client
    .from("admin_memberships")
    .select("id,role,scope_type,scope_id")
    .eq("user_id", account.userId)
    .eq("active", true)
    .limit(20);
  if (memberships.error) {
    return { ok: false as const, response: json({ error: "No fue posible comprobar el acceso administrativo.", code: "ADMIN_CHECK_FAILED" }, 503) };
  }
  if (!memberships.data?.length) {
    return { ok: false as const, response: json({ error: "Se requiere una membresía administrativa activa.", code: "ADMIN_REQUIRED" }, 403) };
  }
  return { ok: true as const, userId: account.userId };
}

function selectLaVista(courses: readonly NormalizedGhinCourse[]) {
  const expectedCourse = normalizeIdentity(COURSE_QUERY);
  const expectedFacility = normalizeIdentity(EXPECTED_CLUB);
  const matches = courses.filter((course) => (
    normalizeIdentity(course.name) === expectedCourse
    || normalizeIdentity(course.facilityName) === expectedFacility
  ));
  return matches.length === 1 ? matches[0] : null;
}

function overallStatus(statuses: readonly DiagnosticStatus[]): DiagnosticStatus {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("BLOCKED_EXTERNAL")) return statuses.includes("PASS") ? "PARTIAL" : "BLOCKED_EXTERNAL";
  if (statuses.includes("PENDING_CONTROLLED_DB_APPLY") || statuses.includes("PENDING_INTERACTIVE_QA")) {
    return statuses.includes("PASS") ? "PARTIAL" : "PENDING_INTERACTIVE_QA";
  }
  return statuses.every((status) => status === "PASS") ? "PASS" : "PARTIAL";
}

export async function GET(request: NextRequest) {
  const access = await adminContext(request);
  if (!access.ok) return access.response;
  const configured = resolveGhinRuntime();
  return json({
    status: configured.ok ? "PENDING_INTERACTIVE_QA" : "BLOCKED_EXTERNAL",
    mode: "READ_ONLY",
    environment: process.env.VERCEL_ENV ?? "unknown",
    capabilities: configured.capabilities,
    blocker: configured.ok ? null : configured.blocker,
    fixedTargets: {
      ghinNumber: GHIN_NUMBER,
      expectedName: EXPECTED_NAME,
      expectedClub: EXPECTED_CLUB,
      courseQuery: COURSE_QUERY,
    },
    safety: {
      adminOnly: true,
      previewOnly: true,
      scorePostingImplemented: false,
      writesApplied: false,
      profileAssociationActivated: false,
    },
  });
}

export async function POST(request: NextRequest) {
  const access = await adminContext(request);
  if (!access.ok) return access.response;

  const decision = diagnosticLimiter.consume(access.userId);
  if (!decision.allowed) {
    return json({
      error: "Espera antes de volver a ejecutar el diagnóstico GHIN.",
      code: "RATE_LIMITED",
      retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1_000),
    }, 429, { "retry-after": String(Math.ceil(decision.retryAfterMs / 1_000)) });
  }

  const parsed = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  const input = parsed.ok ? record(parsed.value) : null;
  if (!input || !hasOnlyKeys(input, ["operation"]) || input.operation !== "run_full_read_only") {
    return json({ error: "Solicitud de diagnóstico inválida.", code: "INVALID_DIAGNOSTIC_REQUEST" }, 400);
  }

  const runtimeState = resolveGhinRuntime();
  if (!runtimeState.ok) {
    return json({
      status: "BLOCKED_EXTERNAL",
      mode: "READ_ONLY",
      blocker: runtimeState.blocker,
      capabilities: runtimeState.capabilities,
      safety: { scorePostingImplemented: false, writesApplied: false, profileAssociationActivated: false },
    }, 503);
  }
  if (!runtimeState.capabilities.golferLookup) {
    return json({
      status: "PENDING_INTERACTIVE_QA",
      mode: "READ_ONLY",
      blocker: "GHIN_GOLFER_LOOKUP_DISABLED",
      capabilities: runtimeState.capabilities,
      safety: { scorePostingImplemented: false, writesApplied: false, profileAssociationActivated: false },
    }, 503);
  }

  const client = runtimeState.client;
  client.clearTrace();
  const startedAt = new Date().toISOString();
  let auth: JsonRecord;
  try {
    auth = { status: "PASS", ...(await client.authenticate()) };
  } catch (error) {
    const status = externalFailureStatus(error);
    return json({
      status,
      mode: "READ_ONLY",
      startedAt,
      completedAt: new Date().toISOString(),
      auth: { status, error: safeFailure(error) },
      golfer: { status: "BLOCKED_EXTERNAL" },
      scores: { status: "BLOCKED_EXTERNAL" },
      course: { status: "BLOCKED_EXTERNAL" },
      trace: client.getTrace(),
      safety: { scorePostingImplemented: false, writesApplied: false, profileAssociationActivated: false },
    }, status === "BLOCKED_EXTERNAL" ? 502 : 500);
  }

  let golfer: JsonRecord;
  try {
    const result = await client.lookupGolfer(GHIN_NUMBER);
    const nameMatches = normalizeIdentity(result.data.name) === normalizeIdentity(EXPECTED_NAME);
    const clubMatches = normalizeIdentity(result.data.clubName) === normalizeIdentity(EXPECTED_CLUB);
    const active = result.data.status === "active";
    const identityMatches = result.data.ghinNumber === GHIN_NUMBER && nameMatches && clubMatches && active;
    golfer = {
      status: identityMatches ? "PASS" : "FAIL",
      endpoint: result.endpoint,
      httpStatus: result.httpStatus,
      fetchedAt: result.fetchedAt,
      data: result.data,
      validation: {
        ghinNumberMatches: result.data.ghinNumber === GHIN_NUMBER,
        nameMatches,
        clubMatches,
        active,
      },
    };
    if (!identityMatches) {
      return json({
        status: "FAIL",
        mode: "READ_ONLY",
        startedAt,
        completedAt: new Date().toISOString(),
        auth,
        golfer,
        scores: { status: "PENDING_INTERACTIVE_QA" },
        course: { status: "PENDING_INTERACTIVE_QA" },
        trace: client.getTrace(),
        safety: { scorePostingImplemented: false, writesApplied: false, profileAssociationActivated: false },
      }, 409);
    }
  } catch (error) {
    const status = externalFailureStatus(error);
    return json({
      status,
      mode: "READ_ONLY",
      startedAt,
      completedAt: new Date().toISOString(),
      auth,
      golfer: { status, error: safeFailure(error) },
      scores: { status: status === "BLOCKED_EXTERNAL" ? "BLOCKED_EXTERNAL" : "PENDING_INTERACTIVE_QA" },
      course: { status: status === "BLOCKED_EXTERNAL" ? "BLOCKED_EXTERNAL" : "PENDING_INTERACTIVE_QA" },
      trace: client.getTrace(),
      safety: { scorePostingImplemented: false, writesApplied: false, profileAssociationActivated: false },
    }, status === "BLOCKED_EXTERNAL" ? 502 : 404);
  }

  let scores: JsonRecord;
  try {
    const result = await client.getScores(GHIN_NUMBER, 20);
    scores = {
      status: "PASS",
      endpoint: result.endpoint,
      httpStatus: result.httpStatus,
      fetchedAt: result.fetchedAt,
      count: result.data.length,
      items: result.data,
    };
  } catch (error) {
    scores = { status: externalFailureStatus(error), error: safeFailure(error) };
  }

  let course: JsonRecord;
  if (!runtimeState.capabilities.courseLookup) {
    course = { status: "PENDING_INTERACTIVE_QA", blocker: "GHIN_COURSE_LOOKUP_DISABLED" };
  } else {
    try {
      const search = await client.searchCourses(COURSE_QUERY, 20);
      const selected = selectLaVista(search.data);
      if (!selected?.id) {
        course = {
          status: "FAIL",
          search: {
            endpoint: search.endpoint,
            httpStatus: search.httpStatus,
            fetchedAt: search.fetchedAt,
            count: search.data.length,
            candidates: search.data,
          },
          error: {
            code: "LA_VISTA_NOT_UNIQUE",
            message: "La búsqueda no produjo una coincidencia única y exacta para La Vista.",
            httpStatus: null,
            endpoint: search.endpoint,
            retryable: false,
          },
        };
      } else {
        const details = await client.getCourse(selected.id);
        const teeReads = await Promise.all(details.data.tees.slice(0, 20).map(async (tee) => {
          if (!tee.id) return { source: tee, detail: null, error: { code: "TEE_ID_MISSING", message: "El tee no reportó TeeSet ID." } };
          try {
            return { source: tee, detail: await client.getTee(tee.id), error: null };
          } catch (error) {
            return { source: tee, detail: null, error: safeFailure(error) };
          }
        }));
        const enrichedCourse: NormalizedGhinCourse = {
          ...details.data,
          tees: teeReads.map((item) => item.detail?.data ?? item.source),
        };
        const verifiedTeeSetIdsBySourceId = Object.fromEntries(teeReads.flatMap((item) => {
          const sourceId = item.source.id;
          const verifiedId = item.detail?.data.id;
          return sourceId && verifiedId === sourceId ? [[sourceId, verifiedId]] : [];
        }));
        const comparison = compareGhinCourseDryRun(INTERNAL_GOLF_COURSE_CATALOG, enrichedCourse, {
          backyardCourseId: "course-la-vista",
          teeMatches: TEE_MATCHES,
        });
        const mappingProposal = proposeLaVistaGhinMappings(INTERNAL_GOLF_COURSE_CATALOG, enrichedCourse, {
          teeMatches: TEE_MATCHES,
          verifiedTeeSetIdsBySourceId,
        });
        const teeFailures = teeReads.filter((item) => item.error !== null).length;
        const allTeesVerified = details.data.tees.length > 0
          && teeReads.length === details.data.tees.length
          && teeFailures === 0;
        course = {
          status: allTeesVerified ? "PASS" : "PARTIAL",
          search: {
            endpoint: search.endpoint,
            httpStatus: search.httpStatus,
            fetchedAt: search.fetchedAt,
            count: search.data.length,
            candidates: search.data,
          },
          details: {
            endpoint: details.endpoint,
            httpStatus: details.httpStatus,
            fetchedAt: details.fetchedAt,
            data: enrichedCourse,
          },
          teeReads: teeReads.map((item) => ({
            sourceId: item.source.id,
            sourceName: item.source.name,
            endpoint: item.detail?.endpoint ?? null,
            httpStatus: item.detail?.httpStatus ?? ("httpStatus" in (item.error ?? {}) ? (item.error as JsonRecord).httpStatus : null),
            data: item.detail?.data ?? null,
            error: item.error,
          })),
          comparison,
          mappingProposal,
        };
      }
    } catch (error) {
      course = { status: externalFailureStatus(error), error: safeFailure(error) };
    }
  }

  const status = overallStatus([
    String(auth.status) as DiagnosticStatus,
    String(golfer.status) as DiagnosticStatus,
    String(scores.status) as DiagnosticStatus,
    String(course.status) as DiagnosticStatus,
  ]);
  return json({
    status,
    mode: "READ_ONLY",
    startedAt,
    completedAt: new Date().toISOString(),
    auth,
    golfer,
    scores,
    course,
    trace: client.getTrace(),
    profileIntegration: {
      status: "PENDING_CONTROLLED_DB_APPLY",
      activated: false,
      reason: "El diagnóstico no modifica perfiles. La activación requiere validar el lookup real y aplicar la migración por separado.",
    },
    safety: {
      adminOnly: true,
      previewOnly: true,
      scorePostingImplemented: false,
      writesApplied: false,
      profileAssociationActivated: false,
    },
  });
}
