const SCORECARD_BRANCH = "ux/scorecard-premium-v1";
const SCORECARD_HOST = "golf-bets-git-ux-scorecard-premium-v1-saha8.vercel.app";
const DEV_REF = "bymeopxkxapfizeeqeyb";

/** Build-time public origin binding for this authorized Preview only.
 * Reuses the existing browser binding; it never enables the admin module. */
export function scorecardPreviewBinding(env: Readonly<Record<string, string | undefined>>) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview"
    || env.VERCEL_GIT_COMMIT_REF !== SCORECARD_BRANCH || env.VERCEL_BRANCH_URL !== SCORECARD_HOST
    || env.CLOUD_ENABLED !== "true" || env.AUTH_SOCIAL_ENABLED !== "true"
    || env.PREVIEW_DB_REF !== DEV_REF || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${DEV_REF}.supabase.co`) return null;
  return { ref: DEV_REF, target: "dev", branchOrigin: `https://${SCORECARD_HOST}` };
}
