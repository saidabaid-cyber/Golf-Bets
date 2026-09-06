function enabled(value: string | undefined, fallback = true) {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

const EXPLICIT_ENABLE_VALUES = new Set(["1", "true", "on", "yes"]);

/** Security-sensitive features stay disabled unless an operator opts in explicitly. */
export function isExplicitFeatureEnabled(value: string | undefined) {
  return typeof value === "string" && EXPLICIT_ENABLE_VALUES.has(value.trim().toLowerCase());
}

/** Server-side feature switches. Public Supabase values are still required. */
export const cloudServerEnabled = enabled(process.env.CLOUD_ENABLED);
export const pollaLiveServerEnabled = isExplicitFeatureEnabled(process.env.POLLA_LIVE_ENABLED);
export const authSocialServerEnabled = enabled(process.env.AUTH_SOCIAL_ENABLED);
/** Equipment cloud storage is additive and must never target the shared
 * database until the isolated Beta migration has been applied deliberately. */
export const equipmentCloudServerEnabled = isExplicitFeatureEnabled(process.env.EQUIPMENT_CLOUD_ENABLED);

export function isFeatureEnabled(value: string | undefined, fallback = true) {
  return enabled(value, fallback);
}
