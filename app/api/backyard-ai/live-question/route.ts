import "server-only";

import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { classifyLiveQuestion, parseLiveQuestionFacts, validateLiveQuestionExplanation } from "../../../../features/ai/live-questions";
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
const FORMAT = { name: "backyard_live_round_answer", description: "A concise explanation of deterministic live-round facts.", schema: { type: "object", additionalProperties: false, properties: { answer: { type: "string", minLength: 1, maxLength: 500 } }, required: ["answer"] } };
const json = (body: unknown, init: ResponseInit = {}) => NextResponse.json(body, { ...init, headers: BACKYARD_AI_PRIVATE_HEADERS });

export async function GET() {
  return json({ ...publicBackyardAiStatus(process.env), featureEnabled: serverPhase2FeatureFlags().ai_insights });
}

export async function POST(request: NextRequest) {
  if (!serverPhase2FeatureFlags().ai_insights) return json({ error: "Las preguntas de ronda están desactivadas.", code: "feature_disabled" }, { status: 404 });
  const config = backyardAiConfig(process.env);
  if (!config.enabled || !config.configured) return json({ error: "Backyard AI necesita configuración del servidor.", code: config.enabled ? "missing_config" : "disabled" }, { status: 503 });
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "cross_site" }, { status: 403 });
  if (!isJsonRequest(request)) return json({ error: "La solicitud debe usar JSON.", code: "unsupported_media_type" }, { status: 415 });
  const parsed = await readJsonBodyWithLimit(request, 14_000);
  if (!parsed.ok) return json({ error: "Solicitud inválida.", code: parsed.reason === "too_large" ? "request_too_large" : "invalid_request" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const source = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : null;
  if (!source || !hasOnlyKeys(source, ["question", "facts", "consent"]) || typeof source.question !== "string") return json({ error: "Solicitud inválida.", code: "invalid_request" }, { status: 400 });
  const question = source.question.trim();
  const kind = classifyLiveQuestion(question);
  const facts = parseLiveQuestionFacts(source.facts);
  if (!kind || question.length > 180 || !facts || facts.kind !== kind) return json({ error: "Pregunta o hechos no reconocidos.", code: "invalid_facts" }, { status: 422 });
  if (!parseBackyardAiProviderConsent(source.consent, AI_PROVIDER_PROCESSING_CONSENT)) return json({ error: "Autoriza el procesamiento por IA para continuar.", code: "consent_required" }, { status: 403 });
  const stored = await verifyStoredAiProcessingConsent(request, AI_PROVIDER_PROCESSING_CONSENT);
  if (!stored.ok) return json({ error: stored.error, code: stored.code }, { status: stored.status });
  const limiterKey = createHmac("sha256", process.env.OPENAI_API_KEY!).update(`live-question:${backyardAiClientAddress(request)}`).digest("hex");
  if (!consumeBackyardAiLimit(limiterKey, 12, 60_000)) return json({ error: "Demasiadas solicitudes. Intenta más tarde.", code: "rate_limit" }, { status: 429 });
  const persistent = getSupabaseAdmin("cloud");
  if (!persistent) return json({ error: "El control de uso necesita configuración.", code: "rate_limit_config" }, { status: 503 });
  try { if (!await consumePersistentRulesAiLimit(persistent, limiterKey, 12, 60)) return json({ error: "Demasiadas solicitudes. Intenta más tarde.", code: "rate_limit" }, { status: 429 }); }
  catch { return json({ error: "No pudimos validar el límite de uso.", code: "rate_limit_unavailable" }, { status: 503 }); }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 }) as unknown as BackyardOpenAiClient;
  const startedAt = Date.now();
  try {
    const result = validateLiveQuestionExplanation(await generateBackyardAiJson<unknown>({ client, model: config.roundSetupModel, instructions: "Answer in concise Mexican Spanish using only the supplied deterministic facts. The status may be provisional. Never recalculate or invent scores, handicaps, winners, balances, money, names or missing events.", input: JSON.stringify({ question, facts }), format: FORMAT, maxOutputTokens: 300 }));
    if (!result) return json({ error: "La explicación no pasó validación.", code: "invalid_schema" }, { status: 502 });
    console.info("Backyard Live Question provider", { provider: "openai", model: config.roundSetupModel, status: "success", latencyMs: Date.now() - startedAt, errorCode: null });
    return json(result);
  } catch (error) {
    const failure = classifyBackyardAiFailure(error);
    console.error("Backyard Live Question provider", { provider: "openai", model: config.roundSetupModel, status: "error", latencyMs: Date.now() - startedAt, errorCode: failure.code });
    return json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
