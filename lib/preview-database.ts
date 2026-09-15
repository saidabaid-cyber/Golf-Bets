/** Deployment binding for destructive QA operations. Never accepts the shared DB. */
export function isolatedPreviewDatabaseEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "preview") return false;
  if (env.VERCEL && env.VERCEL_ENV !== "preview") return false;
  const ref = env.PREVIEW_DB_REF || "";
  if (!/^[a-z0-9]{20}$/.test(ref) || ref === "zhqmlpljloumldaczcfp") return false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
    return url.protocol === "https:" && url.hostname === `${ref}.supabase.co`
      && !url.port && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}
