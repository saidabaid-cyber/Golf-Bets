import "server-only";

import {
  TtlPromiseCache,
  normalizeGhinError,
  parseGhinCourse,
  parseGhinCourses,
  parseGhinFacilities,
  parseGhinGolfer,
  parseGhinGolfers,
  parseGhinScorePostingTees,
  parseGhinScores,
  parseGhinTee,
  parseGhinToken,
  parseFirebaseInstallationToken,
  safeJsonParse,
  type GhinErrorCode,
  type NormalizedGhinCourse,
  type NormalizedGhinError,
  type NormalizedGhinFacility,
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
const GHIN_ACCEPT = "application/json, text/plain, */*";
const FIREBASE_SESSION_URL = "https://firebaseinstallations.googleapis.com/v1/projects/ghin-mobile-app/installations";
// Public application configuration reproduced from @spicygolf/ghin@0.20.0.
// It does not authenticate a golfer or grant access to GHIN data.
const FIREBASE_API_KEY = "AIzaSyBxgTOAWxiud0HuaE5tN-5NTlzFnrtyz-I";
const FIREBASE_INSTALLATION = {
  appId: "1:884417644529:web:47fb315bc6c70242f72650",
  authVersion: "FIS_v2",
  fid: "fg6JfS0U01YmrelthLX9Iz",
  sdkVersion: "w:0.5.7",
} as const;
const GHIN_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";

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
  firebaseHttpStatus: number;
  authenticatedAt: string;
  expiresAt: string | null;
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
  firebaseHttpStatus: number;
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

function boundedLimit(value: number, fallback = 20, maximum = 100) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.trunc(value)));
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

function query(path: string, params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `${path}?${search.toString()}`;
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
  private readonly facilitySearchCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinFacility[]>>;
  private readonly courseSearchCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinCourse[]>>;
  private readonly courseCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinCourse>>;
  private readonly teeCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinTee>>;
  private readonly scorePostingTeeCache: TtlPromiseCache<string, GhinReadResult<NormalizedGhinTee[]>>;
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
    this.facilitySearchCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
    this.courseSearchCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
    this.courseCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
    this.teeCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
    this.scorePostingTeeCache = new TtlPromiseCache({ ttlMs: courseTtlMs, now: this.clock });
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
    this.facilitySearchCache.clear();
    this.courseSearchCache.clear();
    this.courseCache.clear();
    this.teeCache.clear();
    this.scorePostingTeeCache.clear();
  }

  invalidateGolfer(ghinNumber: string) {
    this.golferCache.delete(ghinNumber.trim());
  }

  invalidateScores(ghinNumber: string) {
    const prefix = `${ghinNumber.trim()}:`;
    for (let limit = 1; limit <= 1_000; limit += 1) this.scoresCache.delete(`${prefix}${limit}`);
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
      const url = /^https:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
      const response = await this.fetchImpl(url, {
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
    const firebase = await this.fetchJson("POST", FIREBASE_SESSION_URL, {
      headers: {
        "content-type": "application/json",
        "user-agent": GHIN_USER_AGENT,
        "x-goog-api-key": FIREBASE_API_KEY,
      },
      body: JSON.stringify(FIREBASE_INSTALLATION),
    });
    const installationToken = parseFirebaseInstallationToken(firebase.payload, authenticatedAt);
    if (!installationToken) {
      throw new GhinClientError(normalizeGhinError("invalid response", firebase.status), firebase.endpoint);
    }
    const response = await this.fetchJson("POST", "/golfer_login.json", {
      headers: {
        "content-type": "application/json",
        accept: GHIN_ACCEPT,
        "user-agent": GHIN_USER_AGENT,
      },
      body: JSON.stringify({
        user: {
          password: this.#credentials.password,
          email_or_ghin: this.#credentials.login,
        },
        token: installationToken.accessToken,
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
    return {
      token,
      authenticatedAt,
      effectiveExpiresAt,
      httpStatus: response.status,
      firebaseHttpStatus: firebase.status,
    };
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
      firebaseHttpStatus: session.firebaseHttpStatus,
      authenticatedAt: new Date(session.authenticatedAt).toISOString(),
      expiresAt: Number.isFinite(session.effectiveExpiresAt) ? new Date(session.effectiveExpiresAt).toISOString() : null,
      reused,
    };
  }

  private async authorizedJson(path: string): Promise<JsonResponse> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { session } = await this.getSession(attempt === 1);
      try {
        return await this.fetchJson("GET", path, {
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
      const endpoint = query("/golfers/search.json", {
        golfer_id: normalized,
        page: 1,
        per_page: 100,
        sorting_criteria: "last_name_first_name",
        order: "asc",
      });
      const response = await this.authorizedJson(endpoint);
      const golfers = parseGhinGolfers(response.payload);
      const matching = golfers.filter((candidate) => candidate.ghinNumber === normalized);
      const home = matching.find((candidate) => candidate.isHomeClub === true) ?? null;
      const selected = home ?? matching[0]
        ?? parseGhinGolfer(response.payload);
      if (!selected || selected.ghinNumber !== normalized) {
        throw new GhinClientError(normalizeGhinError("not found", 404), response.endpoint);
      }
      const golfer = {
        ...selected,
        homeClubName: home?.clubName ?? selected.homeClubName,
      };
      return { data: golfer, endpoint: response.endpoint, httpStatus: response.status, fetchedAt: new Date(this.clock()).toISOString() };
    });
  }

  getScores(ghinNumber: string, limit = 20): Promise<GhinReadResult<NormalizedGhinScore[]>> {
    const normalized = ghinNumber.trim();
    const safeLimit = boundedLimit(limit, 20, 1_000);
    if (!/^\d{5,12}$/.test(normalized)) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/scores.json"));
    }
    const cacheKey = `${normalized}:${safeLimit}`;
    return this.scoresCache.get(cacheKey, async () => {
      const response = await this.authorizedJson(query("/scores.json", { golfer_id: normalized }));
      return {
        data: parseGhinScores(response.payload).slice(0, safeLimit),
        endpoint: response.endpoint,
        httpStatus: response.status,
        fetchedAt: new Date(this.clock()).toISOString(),
      };
    });
  }

  searchFacilities(input: {
    name?: string;
    facilityId?: string;
    country?: string;
    state?: string;
  }): Promise<GhinReadResult<NormalizedGhinFacility[]>> {
    const name = input.name?.trim() || undefined;
    const facilityId = input.facilityId?.trim() || undefined;
    const country = input.country?.trim() || undefined;
    const state = input.state?.trim() || undefined;
    if (!name && !facilityId && !country && !state) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/facilities/search.json"));
    }
    if (facilityId && !/^\d+$/.test(facilityId)) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/facilities/search.json"));
    }
    const cacheKey = [name, facilityId, country, state]
      .map((value) => String(value ?? "").toLocaleLowerCase("en-US"))
      .join(":");
    return this.facilitySearchCache.get(cacheKey, async () => {
      const response = await this.authorizedJson(query("/facilities/search.json", {
        name,
        facility_id: facilityId,
        country,
        state,
      }));
      return {
        data: parseGhinFacilities(response.payload),
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
      const endpoint = query("/crsCourseMethods.asmx/GetCourseDetails.json", {
        course_id: normalized,
        tee_set_status: "Active",
      });
      const response = await this.authorizedJson(endpoint);
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

  getScorePostingTees(courseId: string): Promise<GhinReadResult<NormalizedGhinTee[]>> {
    const normalized = courseId.trim();
    if (!/^\d+$/.test(normalized)) {
      return Promise.reject(new GhinClientError(normalizeGhinError("not found", 404), "/Courses/invalid/TeeSetRatingsForScorePosting.json"));
    }
    return this.scorePostingTeeCache.get(normalized, async () => {
      const path = `/Courses/${encodeURIComponent(normalized)}/TeeSetRatingsForScorePosting.json`;
      const response = await this.authorizedJson(path);
      return {
        data: parseGhinScorePostingTees(response.payload),
        endpoint: response.endpoint,
        httpStatus: response.status,
        fetchedAt: new Date(this.clock()).toISOString(),
      };
    });
  }
}
