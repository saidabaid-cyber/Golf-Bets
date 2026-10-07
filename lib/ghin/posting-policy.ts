import { isolatedPreviewDatabaseEnabled } from "../preview-database";
import { resolveGhinPreviewCapabilities } from "./config";

/** This never grants access to the environment-owned diagnostic credentials. */
export function ghinOwnedPostingEnvironment(env: Record<string, string | undefined>) {
  const c = resolveGhinPreviewCapabilities(env);
  return c.previewOnly && c.scorePostingEnabled && c.golferLookup
    && env.VERCEL_GIT_COMMIT_REF === "integration/backyard-current"
    && isolatedPreviewDatabaseEnabled(env) && !!c.apiBaseUrl;
}
