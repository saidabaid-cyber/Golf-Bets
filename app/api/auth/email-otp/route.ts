import "server-only";

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authCallbackUrl } from "../../../../lib/auth-flow";
import { processEmailOtpEntry, emailOtpFailure, EMAIL_RATE_LIMIT_MESSAGE, type EmailEntryIntent } from "../../../../lib/auth-email-entry";
import { isValidEmail } from "../../../../lib/account-state";
import { resolveBrowserAppOrigin } from "../../../../lib/app-origin";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  backyardAiClientAddress,
  hasOnlyKeys,
  isCrossSiteRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";
import { SlidingWindowRateLimiter } from "../../../../lib/ghin/core";
import { getSupabaseAdmin, getSupabasePublic } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const limiter = new SlidingWindowRateLimiter<string>({ limit: 5, windowMs: 15 * 60_000 });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, {
  status,
  headers: { ...BACKYARD_AI_PRIVATE_HEADERS, ...headers },
});

function safeKey(request: Request, email: string) {
  return createHash("sha256")
    .update(`${backyardAiClientAddress(request)}\n${email.trim().toLocaleLowerCase("en-US")}`)
    .digest("hex");
}

function safeError(error: unknown) {
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    code: typeof detail.code === "string" ? detail.code : "OTP_SEND_FAILED",
    status: typeof detail.status === "number" ? detail.status : null,
  };
}

export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ code: "CROSS_SITE", error: "Solicitud no permitida." }, 403);
  const parsed = await readJsonBodyWithLimit(request, 1_024);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return json({ code: "INVALID_REQUEST", error: "Solicitud inválida." }, 400);
  }
  const source = parsed.value as Record<string, unknown>;
  if (!hasOnlyKeys(source, ["email", "intent"]) || typeof source.email !== "string"
    || (source.intent !== "login" && source.intent !== "create") || !isValidEmail(source.email)) {
    return json({ code: "INVALID_REQUEST", error: "Escribe un correo electrónico válido." }, 400);
  }

  const email = source.email.trim().toLocaleLowerCase("en-US");
  const intent = source.intent as EmailEntryIntent;
  const limit = limiter.consume(safeKey(request, email));
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil(limit.retryAfterMs / 1_000));
    return json({ code: "RATE_LIMITED", error: EMAIL_RATE_LIMIT_MESSAGE }, 429, { "retry-after": String(retryAfter) });
  }

  const admin = getSupabaseAdmin("cloud", 10_000);
  const auth = getSupabasePublic("cloud");
  if (!admin || !auth) return json({ code: "AUTH_UNAVAILABLE", error: "Acceso con correo pendiente de configuración." }, 503);

  let redirectTo: string;
  try {
    redirectTo = authCallbackUrl(resolveBrowserAppOrigin(new URL(request.url).origin, process.env.NEXT_PUBLIC_APP_ORIGIN));
  } catch {
    return json({ code: "ORIGIN_MISMATCH", error: "No pudimos validar este origen." }, 503);
  }

  try {
    const result = await processEmailOtpEntry({
      email,
      intent,
      accountExists: async (candidate) => {
        const lookup = await admin.rpc("account_email_exists_v1", { p_email: candidate });
        if (lookup.error || typeof lookup.data !== "boolean") throw lookup.error || new Error("account_lookup_invalid");
        return lookup.data;
      },
      sendOtp: async (candidate, requestedIntent) => {
        const sent = await auth.auth.signInWithOtp({
          email: candidate,
          options: { shouldCreateUser: requestedIntent === "create", emailRedirectTo: redirectTo },
        });
        if (sent.error) throw sent.error;
      },
    });
    if (!result.sent) return result.code === "ACCOUNT_ALREADY_EXISTS"
      ? json({ code: result.code, error: "Ya existe una cuenta con este correo. Inicia sesión para continuar." }, 409)
      : json({ code: result.code, error: "No encontramos una cuenta con este correo." }, 404);
    return json({ sent: true });
  } catch (error) {
    const safe = safeError(error);
    console.error("[email-otp] command_failed", { intent, code: safe.code, upstreamStatus: safe.status });
    const failure = emailOtpFailure(error);
    return json({ code: failure.code, error: failure.message }, failure.status,
      failure.status === 429 ? { "retry-after": "60" } : {});
  }
}
