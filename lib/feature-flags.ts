function enabled(value: string | undefined, fallback = true) {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

/** Server-side feature switches. Public Supabase values are still required. */
export const cloudServerEnabled = enabled(process.env.CLOUD_ENABLED);
export const pollaLiveServerEnabled = enabled(process.env.POLLA_LIVE_ENABLED);
export const authSocialServerEnabled = enabled(process.env.AUTH_SOCIAL_ENABLED);

export function isFeatureEnabled(value: string | undefined, fallback = true) {
  return enabled(value, fallback);
}
