import "server-only";
import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { AI_PROVIDER_PROCESSING_CONSENT, parseBackyardAiProviderConsent } from "../../../../lib/backyard-ai/privacy";
import { BACKYARD_AI_PRIVATE_HEADERS, backyardAiClientAddress, hasOnlyKeys, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";
import { verifyStoredAiProcessingConsent } from "../../../../lib/backyard-ai/server/processing-consent";
import { consumeBackyardAiLimit } from "../../../../lib/backyard-ai/server/rate-limit";
import { answerRulesWithProvider, classifyRulesAiFailure, publicRulesAiStatus, rulesAiConfig, rulesAiProviderSecret } from "../../../../lib/rules-ai";
import { createGeminiRulesProvider, createOpenAiRulesProvider } from "../../../../lib/rules-ai-providers";
import { consumePersistentRulesAiLimit } from "../../../../lib/rules-ai-rate-limit";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

const LIMIT = 8;
const WINDOW_SECONDS = 60;
const MAX_REQUEST_BYTES = 24_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

export async function POST(request: NextRequest) {
  const config = rulesAiConfig(process.env);
  if (!config.enabled) {
    return json({ error: "La consulta con IA no está activada.", code: "disabled" }, { status: 503 });
  }
  if (!config.configured) {
    return json({ error: "Falta configurar el proveedor o el control de uso del reglamento.", code: "missing_config" }, { status: 503 });
  }
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "cross_site" }, { status: 403 });
  if (!isJsonRequest(request)) return json({ error: "La solicitud debe usar JSON.", code: "unsupported_media_type" }, { status: 415 });

  const parsed = await readJsonBodyWithLimit(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return json(
      { error: parsed.reason === "too_large" ? "La consulta supera el tamaño permitido." : "Solicitud inválida.", code: parsed.reason === "too_large" ? "request_too_large" : "invalid_request" },
      { status: parsed.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : null;
  if (!body || !hasOnlyKeys(body, ["question", "courseName", "consent"])) {
    return json({ error: "Solicitud inválida.", code: "invalid_request" }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const courseName = typeof body.courseName === "string" ? body.courseName.trim() : "";
  if (question.length < 8 || question.length > 1200 || courseName.length > 120) {
    return json({ error: "Describe la situación con un poco más de detalle.", code: "invalid_request" }, { status: 400 });
  }
  if (!parseBackyardAiProviderConsent(body.consent, AI_PROVIDER_PROCESSING_CONSENT)) {
    return json({ error: "Autoriza el procesamiento de texto por IA para continuar.", code: "consent_required" }, { status: 403 });
  }
  const storedConsent = await verifyStoredAiProcessingConsent(request, AI_PROVIDER_PROCESSING_CONSENT);
  if (!storedConsent.ok) return json({ error: storedConsent.error, code: storedConsent.code }, { status: storedConsent.status });

  const limiterKey = createHmac("sha256", rulesAiProviderSecret(process.env))
    .update(`rules-ai:${backyardAiClientAddress(request)}`)
    .digest("hex");
  if (!consumeBackyardAiLimit(limiterKey, LIMIT, WINDOW_SECONDS * 1_000)) {
    return json({ error: "Demasiadas consultas. Intenta de nuevo en un minuto.", code: "rate_limit" }, { status: 429 });
  }
  const limiter = getSupabaseAdmin("cloud");
  if (!limiter) return json({ error: "El control de uso de la IA necesita configuración del servidor.", code: "rate_limit_config" }, { status: 503 });
  try {
    const allowed = await consumePersistentRulesAiLimit(limiter, limiterKey, LIMIT, WINDOW_SECONDS);
    if (!allowed) return json({ error: "Demasiadas consultas. Intenta de nuevo en un minuto.", code: "rate_limit" }, { status: 429 });
  } catch {
    return json({ error: "No pudimos validar el límite de consultas. Intenta nuevamente.", code: "rate_limit_unavailable" }, { status: 503 });
  }

  const provider = config.provider === "gemini"
    ? createGeminiRulesProvider({ apiKey: process.env.GEMINI_API_KEY! })
    : createOpenAiRulesProvider(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 }));
  const startedAt = Date.now();
  try {
    // Local rules are resolved from the canonical server corpus. The client
    // selects context only; it cannot inject evidence into the provider prompt.
    const result = await answerRulesWithProvider({ provider, env: process.env, question, courseName });
    console.info("Rules AI provider", { provider: config.provider, model: config.model, status: "success", latencyMs: Date.now() - startedAt, evidenceCount: result.evidence.length });
    return json(result);
  } catch (error) {
    const failure = classifyRulesAiFailure(error, config.provider);
    console.error("Rules AI provider", { provider: config.provider, model: config.model, status: "error", latencyMs: Date.now() - startedAt, errorCode: failure.code });
    return json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}

export async function GET() {
  return json(publicRulesAiStatus(process.env));
}
