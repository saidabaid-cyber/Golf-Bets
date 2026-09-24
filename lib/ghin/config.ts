export type GhinPreviewCapabilities = {
  previewOnly: boolean;
  masterEnabled: boolean;
  golferLookup: boolean;
  courseLookup: boolean;
  courseSyncDryRun: boolean;
  credentialsConfigured: boolean;
  apiBaseUrl: string | null;
};

const ALLOWED_GHIN_HOSTS = new Set(["api.ghin.com", "api2.ghin.com"]);
const EXPLICIT_TRUE = new Set(["1", "true", "on", "yes"]);

function enabled(value: string | undefined) {
  return typeof value === "string" && EXPLICIT_TRUE.has(value.trim().toLocaleLowerCase("en-US"));
}

export function normalizeGhinApiBaseUrl(value: string | undefined) {
  const candidate = value?.trim() || "https://api.ghin.com/api/v1";
  try {
    const url = new URL(candidate);
    const path = url.pathname.replace(/\/+$/, "");
    if (url.protocol !== "https:" || !ALLOWED_GHIN_HOSTS.has(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash
      || path !== "/api/v1") return null;
    return `https://${url.hostname}/api/v1`;
  } catch {
    return null;
  }
}

/**
 * GHIN is hard-locked to Vercel Preview. The existing registry flag remains
 * the master switch; each network capability additionally requires a separate
 * server-only opt-in so a stale deployment variable cannot enable everything.
 */
export function resolveGhinPreviewCapabilities(
  env: Record<string, string | undefined>,
): GhinPreviewCapabilities {
  const previewOnly = env.VERCEL_ENV === "preview";
  const masterEnabled = previewOnly && enabled(env.NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION);
  const golferLookup = masterEnabled && enabled(env.GHIN_GOLFER_LOOKUP_ENABLED);
  const courseLookup = masterEnabled && enabled(env.GHIN_COURSE_LOOKUP_ENABLED);
  return {
    previewOnly,
    masterEnabled,
    golferLookup,
    courseLookup,
    courseSyncDryRun: courseLookup && enabled(env.GHIN_COURSE_SYNC_ENABLED),
    credentialsConfigured: Boolean(env.GHIN_TEST_LOGIN?.trim() && env.GHIN_TEST_PASSWORD),
    apiBaseUrl: normalizeGhinApiBaseUrl(env.GHIN_API_BASE_URL),
  };
}
