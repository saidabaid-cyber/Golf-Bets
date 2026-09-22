import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { establishedBackyardAccount } from "../../../../lib/account-entry";
import { ONBOARDING_CHECKPOINT_KEY, onboardingCheckpoint } from "../../../../lib/onboarding-checkpoint";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
const unavailable = () => json({
  error: "No pudimos verificar tu cuenta. Reintenta antes de continuar.",
  code: "ACCOUNT_MAPPING_UNAVAILABLE",
}, 503);

type AccountEntryStage =
  | "authenticated_request"
  | "auth_get_user"
  | "account_access_status"
  | "profiles_select"
  | "legal_acceptances_select";

function projectRef(value: string | undefined) {
  try {
    const host = new URL(value || "").hostname;
    return host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : "invalid";
  } catch { return "invalid"; }
}

function safeFailure(error: unknown) {
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    code: typeof detail.code === "string" ? detail.code : "UNEXPECTED_FAILURE",
    status: typeof detail.status === "number" ? detail.status : 503,
  };
}

function logFailure(stage: AccountEntryStage, operation: string, error: unknown) {
  const failure = safeFailure(error);
  console.error("[account-entry] verification_failed", {
    stage,
    operation,
    code: failure.code,
    status: failure.status,
    vercelEnvironment: process.env.VERCEL_ENV || "local",
    expectedProjectRef: process.env.PREVIEW_DB_REF || "unset",
    actualProjectRef: projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL),
  });
}

async function verifyAccount(request: NextRequest) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      authenticatedRequest(request),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("account_auth_timeout")), 8_000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  // Reject even ignored selectors: this endpoint cannot become an email or
  // account-existence oracle. Only the verified session selects the mapping.
  if (new URL(request.url).search) return json({ error: "Solicitud no válida." }, 400);
  try {
    const account = await verifyAccount(request);
    if (!account.ok) {
      if (account.status >= 500) {
        const stage = account.code === "ACCOUNT_STATUS_UNAVAILABLE" ? "account_access_status"
          : account.code === "AUTH_UNAVAILABLE" ? "auth_get_user" : "authenticated_request";
        logFailure(stage, account.code, { code: account.code, status: account.status });
        return unavailable();
      }
      return json({ error: account.error, code: account.code }, account.status);
    }
    const [profileResult, legalResult] = await Promise.allSettled([
      account.client.from("profiles").select("id,onboarding_completed_at").eq("id", account.userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle(),
      account.client.from("legal_acceptances").select("type").eq("user_id", account.userId).in("type", ["terms", "privacy"]).abortSignal(AbortSignal.timeout(8_000)),
    ]);
    if (profileResult.status === "rejected") {
      logFailure("profiles_select", "profiles.select", profileResult.reason);
      return unavailable();
    }
    const profile = profileResult.value;
    if (profile.error) {
      logFailure("profiles_select", "profiles.select", profile.error);
      return unavailable();
    }
    if (legalResult.status === "rejected") {
      logFailure("legal_acceptances_select", "legal_acceptances.select", legalResult.reason);
      return unavailable();
    }
    const legal = legalResult.value;
    if (legal.error) {
      logFailure("legal_acceptances_select", "legal_acceptances.select", legal.error);
      return unavailable();
    }
    return json({ userId: account.userId, profileExists: Boolean(profile.data), existingAccount: establishedBackyardAccount(profile.data, (legal.data || []).map(row => row.type)), onboardingProgress: onboardingCheckpoint(account.userMetadata?.[ONBOARDING_CHECKPOINT_KEY], account.userId) });
  } catch (error) {
    logFailure("authenticated_request", "authenticatedRequest", error);
    return unavailable();
  }
}
