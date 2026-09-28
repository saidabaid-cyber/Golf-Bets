import "server-only";

import { GhinClientError, type GhinClientTrace, type GhinReadResult } from "./client";

export type GhinProfileOperation = "authorize" | "reauthorize" | "refresh" | "scores";

export type GhinProfileStage =
  | "firebase_installation"
  | "golfer_login"
  | "golfer_token_extraction"
  | "golfer_identity_from_login"
  | "lookup_by_ghin"
  | "lookup_by_email"
  | "identity_validation"
  | "authorization_state"
  | "profile_persistence"
  | "scores";

type DiagnosticFailure = {
  endpoint: string;
  httpStatus: number | null;
  code: string;
  retryable: boolean;
  errorName?: string;
};

type DiagnosticInput = {
  operation: GhinProfileOperation;
  stage: GhinProfileStage;
  endpoint: string;
  httpStatus?: number | null;
  code?: string | null;
  retryable?: boolean;
  durationMs: number;
  timestamp?: string;
  errorName?: string;
};

const SAFE_CODES = new Set([
  "authorization_state_failed",
  "cloud_unavailable",
  "fallback_required",
  "forbidden",
  "ghin_already_linked",
  "identity_incomplete",
  "identity_mismatch",
  "identity_not_present",
  "invalid_credentials",
  "invalid_response",
  "not_found",
  "owner_already_linked",
  "profile_read_failed",
  "profile_write_failed",
  "rate_limited",
  "reauth_required",
  "timeout",
  "unauthorized",
  "unavailable",
  "unknown",
]);

const SAFE_ENDPOINTS = new Map<string, string>([
  ["/v1/projects/ghin-mobile-app/installations", "/v1/projects/ghin-mobile-app/installations"],
  ["/golfer_login.json", "/golfer_login.json"],
  ["/api/v1/golfer_login.json", "/golfer_login.json"],
  ["/golfers/search.json", "/golfers/search.json"],
  ["/api/v1/golfers/search.json", "/golfers/search.json"],
  ["/scores.json", "/scores.json"],
  ["/api/v1/scores.json", "/scores.json"],
  ["/identity", "/identity"],
  ["/authorization-state", "/authorization-state"],
  ["/db/player_handicap_provider_profiles", "/db/player_handicap_provider_profiles"],
]);

function safeEndpoint(value: string) {
  try {
    const pathname = new URL(value, "https://diagnostic.invalid").pathname;
    return SAFE_ENDPOINTS.get(pathname) ?? "/unknown";
  } catch {
    return "/unknown";
  }
}

function safeCode(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return SAFE_CODES.has(normalized) ? normalized : "unknown";
}

function safeErrorName(value: string | undefined) {
  if (!value) return undefined;
  return new Set([
    "AbortError",
    "AggregateError",
    "Error",
    "NonErrorThrown",
    "RangeError",
    "SyntaxError",
    "TimeoutError",
    "TypeError",
  ]).has(value) ? value : "UnexpectedError";
}

function safeStatus(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeDuration(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeTimestamp(value: string | undefined) {
  if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

export function logGhinProfileStage(input: DiagnosticInput) {
  if (process.env.VERCEL_ENV !== "preview") return;
  const event: Record<string, unknown> = {
    operation: input.operation,
    stage: input.stage,
    endpoint: safeEndpoint(input.endpoint),
    httpStatus: safeStatus(input.httpStatus),
    code: safeCode(input.code),
    retryable: Boolean(input.retryable),
    durationMs: safeDuration(input.durationMs),
    timestamp: safeTimestamp(input.timestamp),
  };
  const errorName = safeErrorName(input.errorName);
  if (errorName) event.errorName = errorName;
  console.info("[ghin-profile]", event);
}

export function diagnosticFailure(error: unknown, fallbackEndpoint: string, fallbackCode = "unknown"): DiagnosticFailure {
  if (error instanceof GhinClientError) {
    return {
      endpoint: error.endpoint,
      httpStatus: error.httpStatus,
      code: error.code,
      retryable: error.retryable,
    };
  }
  return {
    endpoint: fallbackEndpoint,
    httpStatus: null,
    code: safeCode(fallbackCode) ?? "unknown",
    retryable: false,
    errorName: error instanceof Error ? error.name : "NonErrorThrown",
  };
}

export async function traceGhinRead<T>(
  operation: GhinProfileOperation,
  stage: GhinProfileStage,
  fallbackEndpoint: string,
  task: () => Promise<GhinReadResult<T>>,
) {
  const startedAt = Date.now();
  try {
    const result = await task();
    logGhinProfileStage({
      operation,
      stage,
      endpoint: result.endpoint,
      httpStatus: result.httpStatus,
      code: null,
      retryable: false,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logGhinProfileStage({
      operation,
      stage,
      ...diagnosticFailure(error, fallbackEndpoint),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function logAuthenticationTransport(
  operation: "authorize" | "reauthorize",
  traces: readonly GhinClientTrace[],
  error?: unknown,
) {
  const failure = error === undefined ? null : diagnosticFailure(error, "/golfer_login.json");
  const firebase = traces.find((trace) => trace.endpoint.endsWith("/installations"));
  const login = traces.find((trace) => trace.endpoint.endsWith("/golfer_login.json"));

  if (firebase) {
    const parsingFailed = Boolean(failure && !login && failure.endpoint.endsWith("/installations"));
    logGhinProfileStage({
      operation,
      stage: "firebase_installation",
      endpoint: firebase.endpoint,
      httpStatus: firebase.httpStatus,
      code: firebase.outcome === "FAIL" || parsingFailed ? failure?.code ?? "unknown" : null,
      retryable: firebase.outcome === "FAIL" || parsingFailed ? failure?.retryable ?? false : false,
      durationMs: firebase.durationMs,
      errorName: firebase.outcome === "FAIL" || parsingFailed ? failure?.errorName : undefined,
      timestamp: firebase.at,
    });
  } else if (failure?.endpoint.endsWith("/installations")) {
    logGhinProfileStage({
      operation,
      stage: "firebase_installation",
      ...failure,
      durationMs: 0,
    });
  }

  if (login) {
    logGhinProfileStage({
      operation,
      stage: "golfer_login",
      endpoint: login.endpoint,
      httpStatus: login.httpStatus,
      code: login.outcome === "FAIL" ? failure?.code ?? "unknown" : null,
      retryable: login.outcome === "FAIL" ? failure?.retryable ?? false : false,
      durationMs: login.durationMs,
      errorName: login.outcome === "FAIL" ? failure?.errorName : undefined,
      timestamp: login.at,
    });
  } else if (failure && !failure.endpoint.endsWith("/installations")) {
    logGhinProfileStage({
      operation,
      stage: "golfer_login",
      ...failure,
      durationMs: 0,
    });
  }

  if (login?.outcome === "PASS" && failure?.endpoint.endsWith("/golfer_login.json")) {
    logGhinProfileStage({
      operation,
      stage: "golfer_token_extraction",
      ...failure,
      durationMs: 0,
    });
  }
}
