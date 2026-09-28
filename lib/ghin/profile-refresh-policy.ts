export const DEFAULT_GHIN_PROFILE_REFRESH_TTL_SECONDS = 6 * 60 * 60;
const MIN_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

export type GhinProfileRefreshPolicy = {
  ttlSeconds: number;
  state: "FRESH" | "STALE" | "UNKNOWN";
  refreshDue: boolean;
  canRefreshWithoutReauth: boolean;
  manualRefreshForcesUpstream: true;
};

export function ghinProfileRefreshTtlSeconds(env: Record<string, string | undefined> = process.env) {
  const parsed = Number(env.GHIN_PROFILE_REFRESH_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_GHIN_PROFILE_REFRESH_TTL_SECONDS;
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.trunc(parsed)));
}

export function ghinProfileRefreshPolicy(input: {
  lastSuccessfulSyncAt: string | null;
  hasUsableSession: boolean;
  now?: number;
  env?: Record<string, string | undefined>;
}): GhinProfileRefreshPolicy {
  const ttlSeconds = ghinProfileRefreshTtlSeconds(input.env);
  const timestamp = input.lastSuccessfulSyncAt ? Date.parse(input.lastSuccessfulSyncAt) : Number.NaN;
  const now = input.now ?? Date.now();
  const state = !Number.isFinite(timestamp) ? "UNKNOWN" : now - timestamp < ttlSeconds * 1_000 ? "FRESH" : "STALE";
  return {
    ttlSeconds,
    state,
    refreshDue: state !== "FRESH",
    canRefreshWithoutReauth: input.hasUsableSession,
    manualRefreshForcesUpstream: true,
  };
}
