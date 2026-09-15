/** Operator opt-in is scoped to an isolated Preview project, never the shared DB. */
export function socialPreviewEnabled(env: Record<string, string | undefined> = process.env) {
  if (!/^(true|1|on|yes)$/i.test(env.SOCIAL_ACTIVITY_ENABLED || "")) return false;
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "preview") return false;
  const ref = env.SOCIAL_PREVIEW_DB_REF || "";
  if (!/^[a-z0-9]{20}$/.test(ref) || ref === "zhqmlpljloumldaczcfp") return false;
  try { return new URL(env.NEXT_PUBLIC_SUPABASE_URL || "").hostname === `${ref}.supabase.co`; }
  catch { return false; }
}
