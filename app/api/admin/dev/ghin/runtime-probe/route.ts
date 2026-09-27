import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { GhinClientError, GhinReadOnlyClient } from "../../../../../../lib/ghin/client";
import {
  SlidingWindowRateLimiter,
  type NormalizedGhinCourse,
  type NormalizedGhinHole,
  type NormalizedGhinScore,
  type NormalizedGhinTee,
} from "../../../../../../lib/ghin/core";
import { readGhinServerCredentials } from "../../../../../../lib/ghin/credentials.server";
import { resolveGhinRuntime } from "../../../../../../lib/ghin/runtime.server";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  hasOnlyKeys,
  isCrossSiteRequest,
  readJsonBodyWithLimit,
} from "../../../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GHIN_NUMBER = "11103349";
const QA_BRANCH = "integration/backyard-current";
const EXPECTED_NAME = "Said Abaid Taja";
const EXPECTED_CLUB = "La Vista Country Club";
const COURSE_QUERY = "LA VISTA COUNTRY CLUB";
const COURSE_FALLBACK_QUERY = "La Vista";
const COURSE_COUNTRY = "Mexico";
const COURSE_STATE = "Puebla";
const MAX_BODY_BYTES = 1_024;
const GLOBAL_LIMITER_KEY = "ghin-runtime-probe:global";
const probeLimiter = new SlidingWindowRateLimiter<string>({ limit: 3, windowMs: 10 * 60_000 });
const GHIN_AUTH_HOSTS = [
  { label: "api2", host: "api2.ghin.com", baseUrl: "https://api2.ghin.com/api/v1" },
  { label: "api", host: "api.ghin.com", baseUrl: "https://api.ghin.com/api/v1" },
] as const;

type JsonRecord = Record<string, unknown>;
type ProbeOperation = "auth_matrix" | "golfer_read_only" | "full_read_only";

function json(body: JsonRecord, status = 200, headers: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...BACKYARD_AI_PRIVATE_HEADERS, ...headers },
  });
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function lengthBand(length: number) {
  if (length === 0) return "0";
  if (length <= 7) return "1-7";
  if (length <= 15) return "8-15";
  if (length <= 31) return "16-31";
  if (length <= 63) return "32-63";
  return "64+";
}

function secretShape(value: string | undefined) {
  const raw = value ?? "";
  const wrappedInMatchingQuotes = raw.length >= 2
    && ((raw.startsWith("\"") && raw.endsWith("\""))
      || (raw.startsWith("'") && raw.endsWith("'")));
  return {
    present: value !== undefined,
    nonEmptyAfterTrim: raw.trim().length > 0,
    leadingWhitespace: raw.length > 0 && /^\s/u.test(raw),
    trailingWhitespace: raw.length > 0 && /\s$/u.test(raw),
    wrappedInMatchingQuotes,
    containsControlCharacter: /[\u0000-\u001f\u007f]/u.test(raw),
    containsLiteralEscapeSequence: /\\(?:[0abfnrtv]|u[0-9a-f]{4}|x[0-9a-f]{2})/iu.test(raw),
    startsWithBom: raw.charCodeAt(0) === 0xfeff,
    lengthBand: lengthBand(raw.length),
  };
}

function credentialShape() {
  return {
    login: secretShape(process.env.GHIN_TEST_LOGIN),
    password: secretShape(process.env.GHIN_TEST_PASSWORD),
  };
}

function bearerValue(request: NextRequest) {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? "";
}

function matchesProbeSecret(candidate: string, expected: string | undefined) {
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected ?? "", "utf8");
  const width = Math.max(candidateBytes.length, expectedBytes.length, 1);
  const paddedCandidate = Buffer.alloc(width);
  const paddedExpected = Buffer.alloc(width);
  candidateBytes.copy(paddedCandidate);
  expectedBytes.copy(paddedExpected);
  const bytesMatch = timingSafeEqual(paddedCandidate, paddedExpected);
  return expectedBytes.length > 0 && candidateBytes.length === expectedBytes.length && bytesMatch;
}

function parseOperation(value: unknown): ProbeOperation | null {
  return value === "auth_matrix" || value === "golfer_read_only" || value === "full_read_only"
    ? value
    : null;
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

function runtimeSummary(capabilities: {
  previewOnly: boolean;
  masterEnabled: boolean;
  golferLookup: boolean;
  courseLookup: boolean;
  credentialsConfigured: boolean;
}) {
  return {
    previewOnly: capabilities.previewOnly,
    masterEnabled: capabilities.masterEnabled,
    golferLookupEnabled: capabilities.golferLookup,
    courseLookupEnabled: capabilities.courseLookup,
    credentialsConfigured: capabilities.credentialsConfigured,
  };
}

async function runAuthentication(client: GhinReadOnlyClient) {
  try {
    const result = await client.authenticate(true);
    return {
      attempted: true,
      ok: result.authenticated,
      endpoint: result.endpoint,
      httpStatus: result.httpStatus,
      reused: result.reused,
      expiresAtPresent: result.expiresAt !== null,
    };
  } catch (error) {
    return { attempted: true, ok: false, error: safeFailure(error) };
  }
}

async function runAuthMatrix(credentials: { login: string; password: string }) {
  const attempts = GHIN_AUTH_HOSTS.flatMap((target) => ([
    { ...target, loginKind: "configured_login" as const, login: credentials.login },
    { ...target, loginKind: "ghin_number" as const, login: GHIN_NUMBER },
  ]));
  return Promise.all(attempts.map(async (attempt) => {
    const timestamp = new Date().toISOString();
    const client = new GhinReadOnlyClient({
      baseUrl: attempt.baseUrl,
      credentials: { login: attempt.login, password: credentials.password },
    });
    try {
      const result = await client.authenticate(true);
      return {
        label: `${attempt.label}_${attempt.loginKind}`,
        host: attempt.host,
        loginKind: attempt.loginKind,
        status: "PASS" as const,
        message: "Autenticación GHIN completada.",
        error: null,
        httpStatus: result.httpStatus,
        tokenReceived: result.authenticated,
        timestamp,
      };
    } catch (error) {
      const sanitized = safeFailure(error);
      return {
        label: `${attempt.label}_${attempt.loginKind}`,
        host: attempt.host,
        loginKind: attempt.loginKind,
        status: "FAIL" as const,
        message: sanitized.message,
        error: sanitized,
        httpStatus: sanitized.httpStatus,
        tokenReceived: false,
        timestamp,
      };
    }
  }));
}

async function runGolferLookup(client: GhinReadOnlyClient) {
  try {
    const result = await client.lookupGolfer(GHIN_NUMBER);
    const ghinNumberMatches = result.data.ghinNumber === GHIN_NUMBER;
    const nameMatches = normalizeIdentity(result.data.name) === normalizeIdentity(EXPECTED_NAME);
    const clubMatches = normalizeIdentity(result.data.clubName) === normalizeIdentity(EXPECTED_CLUB);
    const active = result.data.status === "active";
    return {
      attempted: true,
      ok: ghinNumberMatches && nameMatches && clubMatches && active,
      endpoint: result.endpoint,
      httpStatus: result.httpStatus,
      golfer: {
        ghinNumber: result.data.ghinNumber,
        name: result.data.name,
        club: result.data.clubName,
        association: result.data.associationName,
        handicapIndex: result.data.handicapIndex,
        status: result.data.status,
        fetchedAt: result.fetchedAt,
      },
      validation: { ghinNumberMatches, nameMatches, clubMatches, active },
    };
  } catch (error) {
    return { attempted: true, ok: false, error: safeFailure(error) };
  }
}

async function runScoreLookup(client: GhinReadOnlyClient) {
  try {
    const result = await client.getScores(GHIN_NUMBER, 20);
    return {
      attempted: true,
      ok: true,
      endpoint: result.endpoint,
      httpStatus: result.httpStatus,
      fetchedAt: result.fetchedAt,
      hasScores: result.data.length > 0,
      scoreCount: result.data.length,
      scores: result.data.slice(0, 20).map(normalizedScoreView),
    };
  } catch (error) {
    return { attempted: true, ok: false, error: safeFailure(error) };
  }
}

function normalizedScoreView(score: NormalizedGhinScore) {
  return {
    id: score.id,
    playedOn: score.playedOn,
    courseId: score.courseId,
    courseName: score.courseName,
    teeId: score.teeId,
    teeName: score.teeName,
    grossScore: score.grossScore,
    adjustedGrossScore: score.adjustedGrossScore,
    differential: score.differential,
    courseRating: score.courseRating,
    slopeRating: score.slopeRating,
    scoreType: score.scoreType,
    postingMethod: score.postingMethod,
    holes: score.holes,
  };
}

function normalizedHoleView(hole: NormalizedGhinHole) {
  return {
    number: hole.number,
    par: hole.par,
    yardage: hole.yardage,
    strokeIndex: hole.strokeIndex,
  };
}

function normalizedTeeView(tee: NormalizedGhinTee) {
  return {
    id: tee.id,
    name: tee.name,
    gender: tee.gender,
    holes: tee.holes,
    par: tee.par,
    courseRating: tee.courseRating,
    slopeRating: tee.slopeRating,
    totalYards: tee.totalYards,
    frontRating: tee.frontRating,
    frontSlope: tee.frontSlope,
    backRating: tee.backRating,
    backSlope: tee.backSlope,
    holeData: tee.holeData.map(normalizedHoleView),
  };
}

function normalizedCourseView(course: NormalizedGhinCourse, tees: readonly NormalizedGhinTee[]) {
  return {
    id: course.id,
    facilityId: course.facilityId,
    name: course.name,
    facilityName: course.facilityName,
    city: course.city,
    state: course.state,
    country: course.country,
    holes: course.holes,
    status: course.status,
    tees: tees.map(normalizedTeeView),
  };
}

function selectLaVista(courses: readonly NormalizedGhinCourse[]) {
  const expectedClub = normalizeIdentity(EXPECTED_CLUB);
  const fallbackName = normalizeIdentity(COURSE_FALLBACK_QUERY);
  const matches = courses.filter((course) => (
    normalizeIdentity(course.name) === expectedClub
    || normalizeIdentity(course.facilityName) === expectedClub
    || (normalizeIdentity(course.name) === fallbackName
      && normalizeIdentity(course.facilityName) === expectedClub)
  ));
  return { selected: matches.length === 1 ? matches[0] : null, matchCount: matches.length };
}

async function runCourseLookup(client: GhinReadOnlyClient) {
  try {
    const primarySearch = await client.searchCourses(COURSE_QUERY, 20, COURSE_COUNTRY, COURSE_STATE);
    const search = primarySearch.data.length > 0
      ? primarySearch
      : await client.searchCourses(COURSE_FALLBACK_QUERY, 20, COURSE_COUNTRY, COURSE_STATE);
    const fallbackUsed = primarySearch.data.length === 0;
    const { selected, matchCount } = selectLaVista(search.data);
    if (!selected?.id) {
      return {
        attempted: true,
        ok: false,
        searchEndpoint: search.endpoint,
        searchHttpStatus: search.httpStatus,
        candidateCountBand: lengthBand(search.data.length),
        exactMatchCountBand: lengthBand(matchCount),
        uniqueExactMatch: false,
        fallbackUsed,
      };
    }

    const details = await client.getCourse(selected.id);
    const tees = details.data.tees.slice(0, 20);
    const teeReads = await Promise.all(tees.map(async (tee) => {
      if (!tee.id) return { data: tee, verified: false };
      try {
        const detail = await client.getTee(tee.id);
        return { data: detail.data, verified: detail.data.id === tee.id };
      } catch {
        return { data: tee, verified: false };
      }
    }));
    const successfulTeeReads = teeReads.filter((read) => read.verified).length;
    const teeReadsComplete = tees.length > 0
      && tees.length === details.data.tees.length
      && successfulTeeReads === tees.length;
    const normalizedTees = teeReads.map((read) => read.data);

    return {
      attempted: true,
      ok: details.data.status === "active" && teeReadsComplete,
      searchEndpoint: search.endpoint,
      searchHttpStatus: search.httpStatus,
      candidateCountBand: lengthBand(search.data.length),
      exactMatchCountBand: lengthBand(matchCount),
      uniqueExactMatch: true,
      fallbackUsed,
      detailsEndpoint: details.endpoint,
      detailsHttpStatus: details.httpStatus,
      fetchedAt: details.fetchedAt,
      active: details.data.status === "active",
      teeCount: normalizedTees.length,
      successfulTeeReadsBand: lengthBand(successfulTeeReads),
      teeReadsComplete,
      course: normalizedCourseView(details.data, normalizedTees),
    };
  } catch (error) {
    return { attempted: true, ok: false, error: safeFailure(error) };
  }
}

function safetySummary() {
  return {
    previewOnly: true,
    bearerProtected: true,
    rawSecretsReturned: false,
    tokenReturned: false,
    cookiesReturned: false,
    rawProviderResponseReturned: false,
    scorePostingImplemented: false,
    writesAttempted: false,
  };
}

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview"
    || process.env.VERCEL_GIT_COMMIT_REF !== QA_BRANCH) {
    return json({ error: "Ruta no disponible.", code: "PREVIEW_ONLY" }, 404);
  }
  if (isCrossSiteRequest(request)) {
    return json({ error: "Solicitud no permitida.", code: "CROSS_SITE_REJECTED" }, 403);
  }
  if (request.nextUrl.search) {
    return json({ error: "El probe no acepta selectores.", code: "SELECTORS_REJECTED" }, 400);
  }
  if (!matchesProbeSecret(bearerValue(request), process.env.GHIN_QA_PROBE_SECRET)) {
    return json({ error: "No autorizado.", code: "UNAUTHORIZED" }, 401, {
      "www-authenticate": "Bearer",
    });
  }

  const parsed = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  const input = parsed.ok ? record(parsed.value) : null;
  const operation = input && hasOnlyKeys(input, ["operation"])
    ? parseOperation(input.operation)
    : null;
  if (!operation) {
    return json({ error: "Solicitud de probe inválida.", code: "INVALID_PROBE_REQUEST" }, 400);
  }

  const limit = probeLimiter.consume(GLOBAL_LIMITER_KEY);
  if (!limit.allowed) {
    const retryAfterSeconds = Math.ceil(limit.retryAfterMs / 1_000);
    return json({ error: "Espera antes de volver a ejecutar el probe.", code: "RATE_LIMITED" }, 429, {
      "retry-after": String(retryAfterSeconds),
    });
  }

  const shape = credentialShape();
  const runtimeState = resolveGhinRuntime();
  if (!runtimeState.ok) {
    return json({
      status: "BLOCKED_EXTERNAL",
      operation,
      mode: "READ_ONLY",
      credentialShape: shape,
      runtime: runtimeSummary(runtimeState.capabilities),
      blocker: runtimeState.blocker,
      safety: safetySummary(),
    }, 503);
  }
  if ((operation === "golfer_read_only" || operation === "full_read_only")
    && !runtimeState.capabilities.golferLookup) {
    return json({
      status: "BLOCKED_EXTERNAL",
      operation,
      mode: "READ_ONLY",
      credentialShape: shape,
      runtime: runtimeSummary(runtimeState.capabilities),
      blocker: "GHIN_GOLFER_LOOKUP_DISABLED",
      safety: safetySummary(),
    }, 503);
  }

  if (operation === "full_read_only" && !runtimeState.capabilities.courseLookup) {
    return json({
      status: "BLOCKED_EXTERNAL",
      operation,
      mode: "READ_ONLY",
      credentialShape: shape,
      runtime: runtimeSummary(runtimeState.capabilities),
      blocker: "GHIN_COURSE_LOOKUP_DISABLED",
      safety: safetySummary(),
    }, 503);
  }

  if (operation === "auth_matrix") {
    const credentials = readGhinServerCredentials(process.env);
    if (!credentials) {
      return json({
        status: "BLOCKED_EXTERNAL",
        operation,
        mode: "READ_ONLY",
        credentialShape: shape,
        runtime: runtimeSummary(runtimeState.capabilities),
        blocker: "CREDENTIALS_NOT_CONFIGURED",
        safety: safetySummary(),
      }, 503);
    }
    const matrix = await runAuthMatrix(credentials);
    return json({
      status: matrix.some((attempt) => attempt.tokenReceived) ? "PASS" : "BLOCKED_EXTERNAL",
      operation,
      mode: "READ_ONLY",
      credentialShape: shape,
      runtime: runtimeSummary(runtimeState.capabilities),
      matrix,
      safety: safetySummary(),
    }, matrix.some((attempt) => attempt.tokenReceived) ? 200 : 502);
  }

  const authentication = await runAuthentication(runtimeState.client);
  if (!authentication.ok) {
    return json({
      status: "BLOCKED_EXTERNAL",
      operation,
      mode: "READ_ONLY",
      credentialShape: shape,
      runtime: runtimeSummary(runtimeState.capabilities),
      authentication,
      safety: safetySummary(),
    }, 502);
  }
  const golfer = await runGolferLookup(runtimeState.client);
  const scores = await runScoreLookup(runtimeState.client);
  if (operation === "golfer_read_only") {
    return json({
      status: golfer.ok && scores.ok ? "PASS" : "PARTIAL",
      operation,
      mode: "READ_ONLY",
      credentialShape: shape,
      runtime: runtimeSummary(runtimeState.capabilities),
      authentication,
      golfer,
      scores,
      safety: safetySummary(),
    });
  }

  const course = await runCourseLookup(runtimeState.client);
  const status = golfer.ok && scores.ok && course.ok ? "PASS" : "PARTIAL";
  return json({
    status,
    operation,
    mode: "READ_ONLY",
    credentialShape: shape,
    runtime: runtimeSummary(runtimeState.capabilities),
    authentication,
    golfer,
    scores,
    course,
    safety: safetySummary(),
  });
}
