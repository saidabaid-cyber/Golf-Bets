import { isolatedPreviewDatabaseEnabled } from "./preview-database";

/** Operator opt-in is scoped to an isolated Preview project, never the shared DB. */
export function socialPreviewEnabled(env: Record<string, string | undefined> = process.env) {
  if (!/^(true|1|on|yes)$/i.test(env.SOCIAL_ACTIVITY_ENABLED || "")) return false;
  if (env.PREVIEW_DB_REF && env.SOCIAL_PREVIEW_DB_REF && env.PREVIEW_DB_REF !== env.SOCIAL_PREVIEW_DB_REF) return false;
  return isolatedPreviewDatabaseEnabled({
    ...env, PREVIEW_DB_REF: env.PREVIEW_DB_REF || env.SOCIAL_PREVIEW_DB_REF,
  });
}
