/** Public, non-secret hostname baked only into the authorized DEV preview.
 * No tokens, telemetry requests or runtime environment mutations. */
export function cloudDiagnosticPreviewHost(env: Readonly<Record<string, string | undefined>>) {
  return env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === "integration/backyard-current"
    && /^[a-z0-9.-]+\.vercel\.app$/.test(env.VERCEL_URL || "") ? env.VERCEL_URL! : "";
}
export function cloudDiagnosticHostAllowed(hostname: string, previewHost = "") {
  return hostname === "dev.thebackyard.com.mx" || Boolean(previewHost && hostname === previewHost);
}
