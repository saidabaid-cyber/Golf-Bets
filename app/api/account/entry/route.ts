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
    if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
    const [profile, legal] = await Promise.all([
      account.client.from("profiles").select("id,onboarding_completed_at").eq("id", account.userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle(),
      account.client.from("legal_acceptances").select("type").eq("user_id", account.userId).in("type", ["terms", "privacy"]).abortSignal(AbortSignal.timeout(8_000)),
    ]);
    if (profile.error || legal.error) throw new Error("account_mapping_unavailable");
    return json({ userId: account.userId, profileExists: Boolean(profile.data), existingAccount: establishedBackyardAccount(profile.data, (legal.data || []).map(row => row.type)), onboardingProgress: onboardingCheckpoint(account.userMetadata?.[ONBOARDING_CHECKPOINT_KEY], account.userId) });
  } catch {
    return json({ error: "No pudimos verificar tu cuenta. Reintenta antes de continuar.", code: "ACCOUNT_MAPPING_UNAVAILABLE" }, 503);
  }
}
