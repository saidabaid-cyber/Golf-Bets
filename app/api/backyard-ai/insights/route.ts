import "server-only";

import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { parseGolfInsightInput, validateGolfInsightExplanation } from "../../../../features/ai/insights";
import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";
import { AI_PROVIDER_PROCESSING_CONSENT, parseBackyardAiProviderConsent } from "../../../../lib/backyard-ai/privacy";
import { backyardAiConfig, publicBackyardAiStatus } from "../../../../lib/backyard-ai/server/config";
import { BACKYARD_AI_PRIVATE_HEADERS, backyardAiClientAddress, hasOnlyKeys, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";
import { classifyBackyardAiFailure, generateBackyardAiJson, type BackyardOpenAiClient } from "../../../../lib/backyard-ai/server/openai-structured";
import { verifyStoredAiProcessingConsent } from "../../../../lib/backyard-ai/server/processing-consent";
import { consumeBackyardAiLimit } from "../../../../lib/backyard-ai/server/rate-limit";
import { consumePersistentRulesAiLimit } from "../../../../lib/rules-ai-rate-limit";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRIVATE = BACKYARD_AI_PRIVATE_HEADERS;
const FORMAT = { name: "backyard_golf_insight", description: "A concise explanation of already-calculated golf aggregates.", schema: { type: "object", additionalProperties: false, properties: { summary: { type: "string", minLength: 1, maxLength: 400 }, observations: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 240 } }, caveat: { type: "string", minLength: 1, maxLength: 240 } }, required: ["summary", "observations", "caveat"] } };

function json(body: unknown, init: ResponseInit = {}) { return NextResponse.json(body, { ...init, headers: PRIVATE }); }

export async function GET() {
  return json({ ...publicBackyardAiStatus(process.env), featureEnabled: serverPhase2FeatureFlags().ai_insights });
}

export async function POST(request: NextRequest) {
  if (!serverPhase2FeatureFlags().ai_insights) return json({ error: "AI Insights está desactivado.", code: "feature_disabled" }, { status: 404 });
  const config = backyardAiConfig(process.env);
  if (!config.enabled || !config.configured) return json({ error: "Backyard AI necesita configuración del servidor.", code: config.enabled ? "missing_config" : "disabled" }, { status: 503 });
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "cross_site" }, { status: 403 });
  if (!isJsonRequest(request)) return json({ error: "La solicitud debe usar JSON.", code: "unsupported_media_type" }, { status: 415 });
  const parsed = await readJsonBodyWithLimit(request, 18_000);
  if (!parsed.ok) return json({ error: parsed.reason === "too_large" ? "La muestra es demasiado grande." : "Solicitud inválida.", code: parsed.reason === "too_large" ? "request_too_large" : "invalid_request" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const source = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : null;
  if (!source || !hasOnlyKeys(source, ["aggregates", "consent"])) return json({ error: "Solicitud inválida.", code: "invalid_request" }, { status: 400 });
  if (!parseBackyardAiProviderConsent(source.consent, AI_PROVIDER_PROCESSING_CONSENT)) return json({ error: "Autoriza el procesamiento por IA para continuar.", code: "consent_required" }, { status: 403 });
  const aggregates = parseGolfInsightInput(source.aggregates);
  if (!aggregates || aggregates.sampleRounds < 1) return json({ error: "No hay una muestra suficiente para explicar.", code: "invalid_aggregates" }, { status: 422 });
  const stored = await verifyStoredAiProcessingConsent(request, AI_PROVIDER_PROCESSING_CONSENT);
  if (!stored.ok) return json({ error: stored.error, code: stored.code }, { status: stored.status });

  const limiterKey = createHmac("sha256", process.env.OPENAI_API_KEY!).update(`insights:${backyardAiClientAddress(request)}`).digest("hex");
  if (!consumeBackyardAiLimit(limiterKey, 10, 60_000)) return json({ error: "Demasiadas solicitudes. Intenta más tarde.", code: "rate_limit" }, { status: 429 });
  const persistent = getSupabaseAdmin("cloud");
  if (!persistent) return json({ error: "El control de uso necesita configuración.", code: "rate_limit_config" }, { status: 503 });
  try { if (!await consumePersistentRulesAiLimit(persistent, limiterKey, 10, 60)) return json({ error: "Demasiadas solicitudes. Intenta más tarde.", code: "rate_limit" }, { status: 429 }); }
  catch { return json({ error: "No pudimos validar el límite de uso.", code: "rate_limit_unavailable" }, { status: 503 }); }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 }) as unknown as BackyardOpenAiClient;
  const startedAt = Date.now();
  try {
    const result = validateGolfInsightExplanation(await generateBackyardAiJson<unknown>({ client, model: config.roundSetupModel, instructions: "Explain only the supplied golf aggregates in concise Mexican Spanish. Never infer missing data, causation, handicaps, winners, balances or money. Mention the sample limitation.", input: JSON.stringify(aggregates), format: FORMAT, maxOutputTokens: 700 }));
    if (!result) return json({ error: "La explicación no pasó validación.", code: "invalid_schema" }, { status: 502 });
    console.info("Backyard Golf Insights provider", { provider: "openai", model: config.roundSetupModel, status: "success", latencyMs: Date.now() - startedAt, errorCode: null });
    return json(result);
  } catch (error) {
    const failure = classifyBackyardAiFailure(error);
    console.error("Backyard Golf Insights provider", { provider: "openai", model: config.roundSetupModel, status: "error", latencyMs: Date.now() - startedAt, errorCode: failure.code });
    return json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
