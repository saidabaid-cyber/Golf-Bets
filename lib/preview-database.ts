export const CANONICAL_QA_PROJECT_REF = "bymeopxkxapfizeeqeyb";

const EXPECTED_VERCEL_ENVIRONMENTS = new Set(["development", "preview", "production"]);

function vercelDeploymentMarkerPresent(env: Record<string, string | undefined>): boolean {
  return env.VERCEL !== undefined;
}

/** Deployment binding for destructive QA operations. Accepts only the
 * explicitly authorized canonical QA project, never an arbitrary Supabase ref. */
export function isolatedPreviewDatabaseEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "preview") return false;
  if (vercelDeploymentMarkerPresent(env) && env.VERCEL_ENV !== "preview") return false;
  const ref = env.PREVIEW_DB_REF || "";
  if (ref !== CANONICAL_QA_PROJECT_REF) return false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
    return url.protocol === "https:" && url.hostname === `${ref}.supabase.co`
      && !url.port && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Runtime features may use the normal binding outside Vercel Preview, but a
 * Preview must prove its isolated database ref before exposing cloud/Auth UI. */
export function previewDatabaseFeaturesAvailable(
  env: Record<string, string | undefined> = process.env,
) {
  if (
    vercelDeploymentMarkerPresent(env)
    && !EXPECTED_VERCEL_ENVIRONMENTS.has(env.VERCEL_ENV || "")
  ) return false;

  return env.VERCEL_ENV !== "preview" || isolatedPreviewDatabaseEnabled(env);
}
