import "server-only";

import { constants, publicEncrypt } from "node:crypto";

import {
  TtlPromiseCache,
  normalizeGhinError,
  parseGhinCourse,
  parseGhinCourses,
  parseGhinGolfer,
  parseGhinGolfers,
  parseGhinScores,
  parseGhinTee,
  parseGhinToken,
  safeJsonParse,
  type GhinErrorCode,
  type NormalizedGhinCourse,
  type NormalizedGhinError,
  type NormalizedGhinGolfer,
  type NormalizedGhinScore,
  type NormalizedGhinTee,
  type NormalizedGhinToken,
} from "./core";
import { normalizeGhinApiBaseUrl } from "./config";
import type { GhinServerCredentials } from "./credentials.server";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_TTL_MS = 55 * 60 * 1_000;
const AUTH_EXPIRY_SKEW_MS = 60_000;
const MAX_RESPONSE_CHARS = 4_000_000;
const GHIN_SOURCE = "GHINcom";
const GHIN_ACCEPT = "application/json, text/plain, */*";
/** Public key embedded in the official GHIN.com web client; it is not a credential. */
const GHIN_LOGIN_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIICCgKCAgEA4bj0vrhe3nejC07r9jYt9ieLM1QoqnmgkRcKOJAkCve/PWK/8+SX
uQumFYAnSvuBhicYwyARGJY8NzIHSMVQU3eOn6HpnVY6f2uWaMnH3OwEYHSV6fXt
2e/vy4eY/Lf8qhaQ0Jlnntluycvk4UtNdpf/3zM1hv3G0mt0ckVnzjqpUmSZ7SEn
Tec6lVBnLnQ9NWH2iswaCB5Szr4E6tRu+dN7U2juixaHYC9STLBUTd3VhCbBZrtT
v+w/ZOo+NZ4mGAf7RMAUNiO0dVQyGLU/MyzUAwOXQQUMp7iqTYoEP6laFojapNkP
P6sETHRWwJStr/O5tEPZGrnzqttjK3ImyHKnXXVoPtB3GthxLJ4m+hglGxw5WeaK
WhGX1AR0nVDTBppRqv5+hbfzSIDmlfFkt23nj4fZ5A75uZ/O+Ivs8xMoIoqws1jT
eDQ8xDSgqyb3D6R/DH6P7yodYF/xwhGPBbenFxyBGPPvXjNODwHMNFMcbrvsj2YS
9Rcf/OrkDCLxWnXevMU+sS3wY8cH6q7u4HIKCyOgaE+Fm++CaSuHp5OfjQnoaLJt
YV+1IB3l2XE6T8BEQL19Ov9JCeuvfvpamvV/MUOuIKexIBGqiYpc6kLWTpd25Kmj
YsplwBjsy1Vogbc3S4G8H8Ixd1ap0vxTqYNmTLLGHlL7d64xbKUU1YsCAwEAAQ==
-----END RSA PUBLIC KEY-----`;

export type GhinClientTrace = {
  method: "GET" | "POST";
  endpoint: string;
  httpStatus: number | null;
  outcome: "PASS" | "FAIL";
  durationMs: number;
  at: string;
};

export type GhinAuthDiagnostics = {
  authenticated: true;
  endpoint: "/golfer_login.json";
  httpStatus: number;
  authenticatedAt: string;
  expiresAt: string | null;
  tokenFingerprint: string;
  reused: boolean;
};

export type GhinReadResult<T> = {
  data: T;
  endpoint: string;
  httpStatus: number;
  fetchedAt: string;
};

export class GhinClientError extends Error {
  readonly code: GhinErrorCode;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly endpoint: string;

  constructor(error: NormalizedGhinError, endpoint: string) {
    super(error.message);
    this.name = "GhinClientError";
    this.code = error.code;
    this.httpStatus = error.httpStatus;
    this.retryable = error.retryable;
    this.endpoint = endpoint;
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GhinClientOptions = {
  baseUrl: string;
  credentials: GhinServerCredentials;
  fetchImpl?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  golferTtlMs?: number;
  scoresTtlMs?: number;
  courseTtlMs?: number;
};

type AuthSession = {
  token: NormalizedGhinToken;
  authenticatedAt: number;
  effectiveExpiresAt: number;
  httpStatus: number;
};

type JsonResponse = {
  payload: unknown;
  status: number;
  endpoint: string;
};

function positiveDuration(value: number | undefined, fallback: number, label: string) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) throw new RangeError(`${label} must be positive and finite.`);
  return resolved;
}

function boundedLimit(value: number, fallback = 20) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function safeEndpoint(input: string) {
  try {
    return new URL(input, "https://invalid.local").pathname;
  } catch {
    return "/unknown";
  }
}

function base64UrlDecode(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    if (typeof atob === "function") return atob(padded);
    return null;
  } catch {
    return null;
  }
}

function jwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const decoded = base64UrlDecode(parts[1]);
  const payload = decoded ? safeJsonParse(decoded) : null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const exp = (payload as Record<string, unknown>).exp;
  return typeof exp === "number" && Number.isFinite(exp) && exp >= 0 ? exp * 1_000 : null;
}

async function tokenFingerprint(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

function query(path: string, params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `${path}?${search.toString()}`;
}

function withGhinSource(path: string) {
  const [pathname, rawSearch = ""] = path.split("?", 2);
  const search = new URLSearchParams(rawSearch);
  search.set("source", GHIN_SOURCE);
  return `${pathname}?${search.toString()}`;
}

export function serializeGhinLoginTokenPayload(timestampMs: number) {
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) throw new RangeError("GHIN login token timestamp must be finite.");
  return JSON.stringify({ source: GHIN_SOURCE, datetime: date.toISOString() });
}

type GhinLoginEncrypt = (
  options: { key: string; padding: number },
  buffer: Buffer,
) => Buffer;

export function createGhinLoginToken(
  timestampMs = Date.now(),
  encrypt: GhinLoginEncrypt = publicEncrypt,
) {
  const encrypted = encrypt(
    { key: GHIN_LOGIN_PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(serializeGhinLoginTokenPayload(timestampMs), "utf8"),
  );
  return encrypted.toString("base64");
}

/**
 * Read-only GHIN transport. It intentionally exposes no score-posting method.
 * Every provider error is converted to a fixed safe message before leaving
 * this class; raw bodies, passwords, and bearer tokens are never retained in
 * traces or returned DTOs.
 */
export class GhinReadOnlyClient {
  private readonly baseUrl: string;
  readonly #credentials: GhinServerCredentials;
  private readonly fetchImpl: FetchLike;
  private readonly clock: () => number;
  private readonly timeoutMs: number;
  private readonly golferCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinGolfer>>;
  private readonly scoresCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinScore[]>>;
  private readonly courseSearchCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinCourse[]>>;
  private readonly courseCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinCourse>>;
  private readonly teeCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinTee>>;
  #authSession: AuthSession | null = null;
  #authInFlight: Promise<AuthSession> | null = null;
  private traces: GhinClientTrace[] = [];

  constructor(options: GhinClientOptions) {
    const baseUrl = normalizeGhinApiBaseUrl(options.baseUrl);
    if (!baseUrl) throw new Error("GHIN_API_BASE_URL_NOT_ALLOWED");
    if (!options.credentials.login.trim() || !options.credentials.password) throw new Error("GHIN_CREDENTIALS_REQUIRED");
    this.baseUrl = baseUrl;
    this.#credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.now ?? Date.now;
    this.timeoutMs = positiveDuration(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.golferCache = new TtlPromiseCache({ ttlMs: options.golferTtlMs ?? 5 * 60_000, now: this.clock });
    this.scoresCache = new TtlPromiseCache({ ttlMs: options.scoresTtlMs ?? 5 * 60_000, now: this.clock });
    const courseTtlMs = options.courseTtlMs ?? 30 * 60_000;
    this.courseSearchCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
    this.courseCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
    this.teeCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
  }

  getTrace(): readonly GhinClientTrace[] {
    return this.traces.map((trace) => ({ ...trace }));
  }

  clearTrace() {
    this.traces = [];
  }

  clearCaches() {
    this.#authSession = null;
    this.golferCache.clear();
    this.scoresCache.clear();
    this.courseSearchCache.clear();
    this.courseCache.clear();
    this.teeCache.clear();
  }

  private recordTrace(method: "GET" | "POST", endpoint: string, status: number | null, startedAt: number, ok: boolean) {
    this.traces.push({
      method,
      endpoint: safeEndpoint(endpoint),
      httpStatus: status,
      outcome: ok ? "PASS" : "FAIL",
      durationMs: Math.max(0, this.clock() - startedAt),
      at: new Date(this.clock()).toISOString(),
    });
    if (this.traces.length > 100) this.traces.splice(0, this.traces.length - 100);
  }

  private async fetchJson(
    method: "GET" | "POST",
    path: string,
    init: RequestInit = {},
  ): Promise<JsonResponse> {
    const endpoint = safeEndpoint(path);
    const startedAt = this.clock();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let status: number | null = null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        method,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      status = response.status;
      const body = await response.text();
      if (body.length > MAX_RESPONSE_CHARS) {
        throw new GhinClientError(normalizeGhinError("invalid response", response.status), endpoint);
      }
      const payload = safeJsonParse(body);
      if (!response.ok) throw new GhinClientError(normalizeGhinError(payload, response.status), endpoint);
      if (payload === null) throw new GhinClientError(normalizeGhinError("invalid response", response.status), endpoint);
      this.recordTrace(method, endpoint, status, startedAt, true);
      return { payload, status: response.status, endpoint };
    } catch (error) {
      if (!(error instanceof GhinClientError)) {
        const normalized = normalizeGhinError(error, status ?? undefined);
        error = new GhinClientError(normalized, endpoint);
      }
      this.recordTrace(method, endpoint, status, startedAt, false);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private sessionUsable(session: AuthSession | null) {
    return Boolean(session && session.effectiveExpiresAt - AUTH_EXPIRY_SKEW_MS > this.clock());
  }

  private async login(): Promise<AuthSession> {
    const authenticatedAt = this.clock();
    const response = await this.fetchJson("POST", "/golfer_login.json", {
      headers: { "content-type": "application/json", accept: GHIN_ACCEPT },
      body: JSON.stringify({
        user: {
          password: this.#credentials.password,
          email_or_ghin: this.#credentials.login,
          remember_me: false,
        },
        token: createGhinLoginToken(authenticatedAt),
        source: GHIN_SOURCE,
      }),
    });
    const token = parseGhinToken(response.payload, authenticatedAt);
    if (!token) {
      throw new GhinClientError(normalizeGhinError("invalid response", response.status), response.endpoint);
    }
    const effectiveExpiresAt = token.expiresAt ?? jwtExpiry(token.accessToken) ?? authenticatedAt + DEFAULT_TOKEN_TTL_MS;
    if (effectiveExpiresAt <= authenticatedAt + AUTH_EXPIRY_SKEW_MS) {
      throw new GhinClientError(normalizeGhinError("unauthorized", 401), response.endpoint);
    }
    return { token, authenticatedAt, effectiveExpiresAt, httpStatus: response.status };
  }

  private async getSession(force = false): Promise<{ session: AuthSession; reused: boolean }> {
    if (!force && this.sessionUsable(this.#authSession)) return { session: this.#authSession as AuthSession, reused: true };
    if (force) this.#authSession = null;
    if (!this.#authInFlight) {
      this.#authInFlight = this.login()
        .then((session) => {
          this.#authSession = session;
          return session;
        })
        .finally(() => {
          this.#authInFlight = null;
        });
    }
    return { session: await this.#authInFlight, reused: false };
  }

  async authenticate(force = false): Promise<GhinAuthDiagnostics> {
    const { session, reused } = await this.getSession(force);
    return {
      authenticated: true,
      endpoint: "/golfer_login.json",
      httpStatus: session.httpStatus,
      authenticatedAt: new Date(session.authenticatedAt).toISOString(),
      expiresAt: Number.isFinite(session.effectiveExpiresAt) ? new Date(session.effectiveExpiresAt).toISOString() : null,
      tokenFingerprint: await tokenFingerprint(session.token.accessToken),
      reused,
    };
  }

  private async authorizedJson(path: string): Promise<JsonResponse> {
    const pathWithSource = withGhinSource(path);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { session } = await this.getSession(attempt === 1);
      try {
        return await this.fetchJson("GET", pathWithSource, {
          headers: {
            accept: GHIN_ACCEPT,
            authorization: `Bearer ${session.token.accessToken}`,
          },
        });
      } catch (error) {
        const retryAuth = error instanceof GhinClientError
          && (error.httpStatus === 401 || error.httpStatus === 403)
          && attempt === 0;
        if (!retryAuth) throw error;
        this.#authSession = null;
      }
    }
    throw new GhinClientError(normalizeGhinError("unauthorized", 401), safeEndpoint(path));
  }

  private async withCompatibilityFallback(primary: string, fallback: string): Promise<JsonResponse> {
    try {
      return await this.authorizedJson(primary);
    } catch (error) {
      if (!(error instanceof GhinClientError) || ![404, 405].includes(error.httpStatus ?? 0)) throw error;
      return this.authorizedJson(fallback);
    }
  }

  lookupGolfer(ghinNumber: string): Promise<GhinReadResult<NormalizedGhinGolfer>> {
    const normalized = ghinNumber.trim();
    if (!/^\d{5,12}$/.test(normalized)) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/golfers/search.json"));
    }
    return this.golferCache.get(normalized, async () => {
      const primary = query("/golfers/search.json", {
        golfer_id: normalized,
        per_page: 10,
        page: 1,
        sorting_criteria: "id",
        order: "ASC",
      });
      const fallback = query("/golfers.json", {
        golfer_id: normalized,
        from_ghin: "true",
        per_page: 10,
        page: 1,
      });
      const response = await this.withCompatibilityFallback(primary, fallback);
      const golfers = parseGhinGolfers(response.payload);
      const golfer = golfers.find((candidate) => candidate.ghinNumber === normalized)
        ?? parseGhinGolfer(response.payload);
      if (!golfer || golfer.ghinNumber !== normalized) {
        throw new GhinClientError(normalizeGhinError("not found", 404), response.endpoint);
      }
      return { data: golfer, endpoint: response.endpoint, httpStatus: response.status, fetchedAt: new Date(this.clock()).toISOString() };
    });
  }

  getScores(ghinNumber: string, limit = 20): Promise<GhinReadResult<NormalizedGhinScore[]>> {
    const normalized = ghinNumber.trim();
    const safeLimit = boundedLimit(limit);
    if (!/^\d{5,12}$/.test(normalized)) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/scores.json"));
    }
    const cacheKey = `${normalized}:${safeLimit}`;
    return this.scoresCache.get(cacheKey, async () => {
      const primary = query("/scores.json", { golfer_id: normalized, offset: 0, limit: safeLimit });
      const fallback = query("/scores/search.json", { golfer_id: normalized, per_page: safeLimit, page: 1 });
      const response = await this.withCompatibilityFallback(primary, fallback);
      return {
        data: parseGhinScores(response.payload),
        endpoint: response.endpoint,
        httpStatus: response.status,
        fetchedAt: new Date(this.clock()).toISOString(),
      };
    });
  }

  searchCourses(
    name: string,
    limit = 20,
    country?: string,
    state?: string,
  ): Promise<GhinReadResult<NormalizedGhinCourse[]>> {
    const normalized = name.trim();
    if (normalized.length < 2 || normalized.length > 120) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/crsCourseMethods.asmx/SearchCourses.json"));
    }
    const safeLimit = boundedLimit(limit);
    const normalizedCountry = country?.trim() || undefined;
    const normalizedState = state?.trim() || undefined;
    const cacheKey = [normalized, normalizedCountry, normalizedState, safeLimit]
      .map((value) => String(value ?? "").toLocaleLowerCase("en-US"))
      .join(":");
    return this.courseSearchCache.get(cacheKey, async () => {
      const primary = query("/crsCourseMethods.asmx/SearchCourses.json", {
        name: normalized,
        country: normalizedCountry,
        state: normalizedState,
      });
      const fallback = query("/crsCourseMethods.asmx/SearchCourses.json", {
        name: normalized,
        per_page: safeLimit,
        page: 1,
      });
      const response = await this.withCompatibilityFallback(primary, fallback);
      return {
        data: parseGhinCourses(response.payload).slice(0, safeLimit),
        endpoint: response.endpoint,
        httpStatus: response.status,
        fetchedAt: new Date(this.clock()).toISOString(),
      };
    });
  }

  getCourse(courseId: string): Promise<GhinReadResult<NormalizedGhinCourse>> {
    const normalized = courseId.trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(normalized)) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/crsCourseMethods.asmx/GetCourseDetails.json"));
    }
    return this.courseCache.get(normalized, async () => {
      const primary = query("/crsCourseMethods.asmx/GetCourseDetails.json", {
        courseId: normalized,
        include_altered_tees: false,
      });
      const fallback = query("/crsCourseMethods.asmx/GetCourseDetails.json", {
        course_id: normalized,
        tee_set_status: "Active",
      });
      const response = await this.withCompatibilityFallback(primary, fallback);
      const course = parseGhinCourse(response.payload);
      if (!course) throw new GhinClientError(normalizeGhinError("invalid response", response.status), response.endpoint);
      return { data: course, endpoint: response.endpoint, httpStatus: response.status, fetchedAt: new Date(this.clock()).toISOString() };
    });
  }

  getTee(teeSetRatingId: string): Promise<GhinReadResult<NormalizedGhinTee>> {
    const normalized = teeSetRatingId.trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(normalized)) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/TeeSetRatings/invalid.json"));
    }
    return this.teeCache.get(normalized, async () => {
      const path = query(`/TeeSetRatings/${encodeURIComponent(normalized)}.json`, {
        include_altered_tees: "false",
      });
      const response = await this.authorizedJson(path);
      const tee = parseGhinTee(response.payload);
      if (!tee) throw new GhinClientError(normalizeGhinError("invalid response", response.status), response.endpoint);
      return { data: tee, endpoint: response.endpoint, httpStatus: response.status, fetchedAt: new Date(this.clock()).toISOString() };
    });
  }
}
