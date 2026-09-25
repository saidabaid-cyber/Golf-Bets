import { isolatedPreviewDatabaseEnabled } from "../../preview-database";

export const DEFAULT_BACKYARD_AI_MODEL = "gpt-5.4-mini";
export const DEFAULT_SCORECARD_AI_MODEL = "gpt-5.4-mini";

export type BackyardAiEnvironment = Record<string, string | undefined>;

export type AiProcessingConsentLedgerAccess =
  | { allowed: true; reason: "guest" | "not_preview" | "preview_bound" }
  | { allowed: false; reason: "preview_binding_missing" | "preview_binding_mismatch" };

function enabledFlag(value: string | undefined) {
  return ["1", "true", "on", "enabled"].includes(value?.trim().toLocaleLowerCase("en-US") || "");
}

function enabledByDefault(value: string | undefined) {
  return !["0", "false", "off", "no"].includes(value?.trim().toLocaleLowerCase("en-US") || "");
}

function modelId(value: string | undefined) {
  const clean = value?.trim() || "";
  return clean.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(clean) ? clean : "";
}

/**
 * Authenticated Preview traffic must deliberately bind the new consent ledger
 * to the isolated Supabase URL configured for that Preview. This prevents an
 * inherited cloud URL from silently writing the ledger in Production. Guest
 * processing has no server ledger and therefore does not need this binding.
 */
export function aiProcessingConsentLedgerAccess(
  env: BackyardAiEnvironment,
  authenticated: boolean,
): AiProcessingConsentLedgerAccess {
  if (!authenticated) return { allowed: true, reason: "guest" };
  if (env.VERCEL_ENV?.trim().toLocaleLowerCase("en-US") !== "preview") {
    return { allowed: true, reason: "not_preview" };
  }
  // PREVIEW_DB_REF is already the canonical, fail-closed binding used by the
  // rest of the authenticated Preview APIs. Requiring a second URL variable
  // made the consent ledger unavailable even when the same isolated QA
  // project had already been proved by ref + exact hostname.
  if (!env.PREVIEW_DB_REF) return { allowed: false, reason: "preview_binding_missing" };
  return isolatedPreviewDatabaseEnabled(env)
    ? { allowed: true, reason: "preview_bound" }
    : { allowed: false, reason: "preview_binding_mismatch" };
}

export function backyardAiConfig(env: BackyardAiEnvironment) {
  const enabled = enabledFlag(env.BACKYARD_AI_ENABLED);
  const providerConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const limiterConfigured = enabledByDefault(env.CLOUD_ENABLED)
    && Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim())
    && Boolean((env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim());
  const configured = providerConfigured && limiterConfigured;
  return {
    enabled,
    configured,
    providerConfigured,
    limiterConfigured,
    ready: enabled && configured,
    roundSetupModel: modelId(env.OPENAI_BACKYARD_MODEL) || modelId(env.OPENAI_RULES_MODEL) || DEFAULT_BACKYARD_AI_MODEL,
    scorecardModel: modelId(env.OPENAI_SCORECARD_MODEL) || modelId(env.OPENAI_BACKYARD_MODEL) || modelId(env.OPENAI_RULES_MODEL) || DEFAULT_SCORECARD_AI_MODEL,
  };
}

export function publicBackyardAiStatus(env: BackyardAiEnvironment) {
  const config = backyardAiConfig(env);
  return {
    enabled: config.enabled,
    configured: config.configured,
    state: config.ready ? "ready" as const : !config.enabled ? "disabled" as const : "missing_config" as const,
  };
}
