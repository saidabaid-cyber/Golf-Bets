import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { GhinReadOnlyClient } from "./ghin/client";
import { normalizeGhinApiBaseUrl } from "./ghin/config";
import { buildGhinCourseSyncPlan } from "./ghin/course-sync";
import { persistGhinCourseSyncPlan } from "./ghin/course-sync.server";
import { getSupabaseAdmin } from "./supabase/server";
import { invalidateReviewedCourseCatalogCache } from "./review-course-catalog.server";
import type { LazyCourseImportResult } from "./course-lazy-import";

function normalizeQuery(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
}

function envEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLocaleLowerCase("en-US") ?? "");
}

function providerCredentials(env: Record<string, string | undefined>) {
  const login = env.GHIN_COURSE_PROVIDER_LOGIN?.trim();
  const password = env.GHIN_COURSE_PROVIDER_PASSWORD;
  return login && password ? { login, password } : null;
}

async function providerAuthorized(database: SupabaseClient) {
  const source = await database.from("golf_course_data_sources")
    .select("authorization_status,authorized_for_import,authorized_for_display")
    .eq("provider", "GHIN").maybeSingle();
  if (source.error || !source.data) return false;
  return source.data.authorization_status === "AUTHORIZED"
    && source.data.authorized_for_import === true
    && source.data.authorized_for_display === true;
}

function candidateForQuery<T extends { id: string | null; name: string | null; facilityName: string | null }>(query: string, rows: readonly T[]) {
  if (rows.length === 1) return rows[0];
  const wanted = normalizeQuery(query);
  const exact = rows.filter((row) => normalizeQuery(row.name) === wanted || normalizeQuery(row.facilityName) === wanted);
  return exact.length === 1 ? exact[0] : null;
}

async function claimLookup(database: SupabaseClient, query: string) {
  const claimed = await database.rpc("claim_course_provider_lookup_v1", {
    target_provider: "GHIN",
    target_query: query,
  });
  if (claimed.error || !claimed.data || typeof claimed.data !== "object" || Array.isArray(claimed.data)) return null;
  return claimed.data as { claimed?: boolean; status?: string; courseIds?: string[] };
}

async function finishLookup(database: SupabaseClient, query: string, status: string, courseIds: string[], upstreamCalls: number) {
  await database.rpc("finish_course_provider_lookup_v1", {
    target_provider: "GHIN",
    target_query: query,
    target_status: status,
    target_course_ids: courseIds,
    target_upstream_calls: upstreamCalls,
  });
}

/** Runtime GHIN Course provider. It deliberately accepts only dedicated
 * provider credentials and never falls back to GHIN_TEST_* or a golfer's
 * linked session. The database source registry is the final authorization
 * gate, so a deployment flag alone cannot grant data-ingestion rights. */
export async function importGhinCourseOnMiss(input: {
  query: string;
  actorId: string;
  database?: SupabaseClient | null;
  env?: Record<string, string | undefined>;
}): Promise<LazyCourseImportResult> {
  const query = normalizeQuery(input.query);
  if (query.length < 3) return { status: "PROVIDER_MISS", courseIds: [], upstreamCalls: 0, cached: false };
  const database = input.database ?? getSupabaseAdmin("cloud");
  const env = input.env ?? process.env;
  if (!database || env.VERCEL_ENV !== "preview" || !envEnabled(env.GHIN_COURSE_PROVIDER_ENABLED)) {
    return { status: "BLOCKED_EXTERNAL", courseIds: [], upstreamCalls: 0, cached: false };
  }
  if (!(await providerAuthorized(database))) {
    return { status: "BLOCKED_EXTERNAL", courseIds: [], upstreamCalls: 0, cached: false };
  }
  const credentials = providerCredentials(env);
  const baseUrl = normalizeGhinApiBaseUrl(env.GHIN_API_BASE_URL);
  if (!credentials || !baseUrl) return { status: "PROVIDER_UNAVAILABLE", courseIds: [], upstreamCalls: 0, cached: false };

  const claim = await claimLookup(database, query);
  if (!claim) return { status: "PROVIDER_UNAVAILABLE", courseIds: [], upstreamCalls: 0, cached: false };
  if (claim.claimed !== true) {
    const status = claim.status === "MISS" ? "PROVIDER_MISS"
      : claim.status === "AMBIGUOUS" ? "PROVIDER_AMBIGUOUS" : "PROVIDER_BUSY";
    return { status, courseIds: claim.courseIds ?? [], upstreamCalls: 0, cached: true };
  }

  const client = new GhinReadOnlyClient({ baseUrl, credentials, courseTtlMs: 30 * 60_000 });
  const traceStart = client.getTrace().length;
  try {
    const search = await client.searchCourses(input.query, 10);
    const candidate = candidateForQuery(input.query, search.data);
    if (!candidate?.id) {
      const status = search.data.length ? "AMBIGUOUS" : "MISS";
      const upstreamCalls = client.getTrace().length - traceStart;
      await finishLookup(database, query, status, [], upstreamCalls);
      return { status: status === "MISS" ? "PROVIDER_MISS" : "PROVIDER_AMBIGUOUS", courseIds: [], upstreamCalls, cached: false };
    }
    const details = await client.getCourse(candidate.id);
    const facility = details.data.facilityId
      ? await client.searchFacilities({ facilityId: details.data.facilityId }).then((result) => result.data.find((row) => row.id === details.data.facilityId) ?? null)
      : null;
    const plan = buildGhinCourseSyncPlan({
      course: details.data,
      facility,
      scorePostingTees: [],
      confirmMapping: true,
      observedAt: details.fetchedAt,
    });
    // Authorization above permits shared display. Score posting remains false
    // because no posting tee IDs are fetched or attached by this path.
    plan.facility.visibility = "PUBLIC";
    plan.course.visibility = "PUBLIC";
    const persisted = await persistGhinCourseSyncPlan(database, plan, {
      mode: "APPLY",
      actorId: input.actorId,
      diffSummary: { source: "LAZY_IMPORT", queryHash: createHash("sha256").update(query).digest("hex") },
    });
    invalidateReviewedCourseCatalogCache();
    const upstreamCalls = client.getTrace().length - traceStart;
    await finishLookup(database, query, "SUCCESS", [persisted.courseId], upstreamCalls);
    return { status: "IMPORTED", courseIds: [persisted.courseId], upstreamCalls, cached: false };
  } catch {
    const upstreamCalls = client.getTrace().length - traceStart;
    await finishLookup(database, query, "FAILED", [], upstreamCalls);
    return { status: "PROVIDER_UNAVAILABLE", courseIds: [], upstreamCalls, cached: false };
  } finally {
    client.discardCredentials();
  }
}
