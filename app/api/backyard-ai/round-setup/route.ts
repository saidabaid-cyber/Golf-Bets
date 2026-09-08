import "server-only";

import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

import { backyardAiConfig, publicBackyardAiStatus } from "../../../../lib/backyard-ai/server/config";
import { AI_PROVIDER_PROCESSING_CONSENT, parseBackyardAiProviderConsent } from "../../../../lib/backyard-ai/privacy";
import { validateCanonicalRoundCommand } from "../../../../lib/backyard-ai/runtime/canonical-command-guard";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  backyardAiClientAddress,
  hasOnlyKeys,
  isCrossSiteRequest,
  isJsonRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";
import { classifyBackyardAiFailure, generateBackyardAiJson, type BackyardOpenAiClient } from "../../../../lib/backyard-ai/server/openai-structured";
import { consumeBackyardAiLimit } from "../../../../lib/backyard-ai/server/rate-limit";
import { verifyStoredAiProcessingConsent } from "../../../../lib/backyard-ai/server/processing-consent";
import { consumePersistentRulesAiLimit } from "../../../../lib/rules-ai-rate-limit";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 16_000;
const MAX_INPUT_LENGTH = 2_400;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const GLOBAL_RATE_LIMIT = 100;

type ModelRoundSetup = {
  canonicalCommand: string;
  confidence: number;
  clarification: string | null;
};

const ROUND_SETUP_FORMAT = {
  name: "backyard_round_setup_language",
  description: "A normalized golf round command, never a calculated result.",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      canonicalCommand: { type: "string", minLength: 1, maxLength: MAX_INPUT_LENGTH },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      clarification: { anyOf: [{ type: "string", minLength: 1, maxLength: 300 }, { type: "null" }] },
    },
    required: ["canonicalCommand", "confidence", "clarification"],
  },
};

function json(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

function modelRoundSetup(value: unknown): ModelRoundSetup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!hasOnlyKeys(source, ["canonicalCommand", "confidence", "clarification"])) return null;
  const canonicalCommand = typeof source.canonicalCommand === "string" ? source.canonicalCommand.trim() : "";
  const confidence = source.confidence;
  const clarification = source.clarification;
  if (!canonicalCommand || canonicalCommand.length > MAX_INPUT_LENGTH) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (clarification !== null && (typeof clarification !== "string" || !clarification.trim() || clarification.trim().length > 300)) return null;
  return { canonicalCommand, confidence, clarification: typeof clarification === "string" ? clarification.trim() : null };
}

function logRoundSetupProvider(input: {
  model: string;
  status: "success" | "error";
  latencyMs: number;
  errorCode: string | null;
}) {
  const event = {
    provider: "openai",
    model: input.model,
    status: input.status,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    errorCode: input.errorCode,
  };
  if (input.status === "error") console.error("Backyard Round Setup AI provider", event);
  else console.info("Backyard Round Setup AI provider", event);
}

function instructions() {
  return [
    "You interpret Mexican Spanish golf round setup commands for The Backyard.",
    "Rewrite the user's request as one concise canonical Spanish command while preserving every explicit player name, course, tee, start hole, hole count, handicap basis, stake, participant exclusion, team and rule exactly.",
    "Supported catalog concepts include Skins, Nassau grupal, Nassau individual, Bola Amiga, Conejos, Viboritas, Camellos, Peces, Unidades/Copas, Foursome, Monkey, Loba, Mini Polla, Polla components, Dollar a Stroke, Presiones individuales, Presiones por parejas, Chicago, Vegas and Menos Putts.",
    "Never add a game, amount, player, team, course, handicap, press, carry, multiplier or exclusion that was not explicit.",
    "Never calculate scores, handicaps, bets, balances, money results or settlement.",
    "Preserve memory references such as los mismos del domingo, de siempre, la semana pasada, or la última vez; do not resolve them.",
    "If a term could map to more than one real configuration, preserve it and put exactly one focused question in clarification. Otherwise clarification is null.",
    "Keep unknown game names unchanged so the deterministic catalog validator can reject or clarify them.",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const config = backyardAiConfig(process.env);
  if (!config.enabled) return json({ error: "Backyard AI no está activado.", code: "disabled" }, { status: 503 });
  if (!config.configured) return json({ error: "Backyard AI necesita configuración del servidor.", code: "missing_config" }, { status: 503 });
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "cross_site" }, { status: 403 });
  if (!isJsonRequest(request)) return json({ error: "La solicitud debe usar JSON.", code: "unsupported_media_type" }, { status: 415 });

  const limiterKey = createHmac("sha256", process.env.OPENAI_API_KEY!).update(`round-setup:${backyardAiClientAddress(request)}`).digest("hex");
  if (!consumeBackyardAiLimit(limiterKey, RATE_LIMIT, RATE_WINDOW_MS)) return json({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto.", code: "rate_limit" }, { status: 429 });

  const parsedBody = await readJsonBodyWithLimit(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    if (parsedBody.reason === "too_large") return json({ error: "La instrucción es demasiado grande.", code: "request_too_large" }, { status: 413 });
    return json({ error: "Solicitud inválida.", code: "invalid_request" }, { status: 400 });
  }
  const source = parsedBody.value && typeof parsedBody.value === "object" && !Array.isArray(parsedBody.value) ? parsedBody.value as Record<string, unknown> : null;
  if (!source || !hasOnlyKeys(source, ["input", "consent"])) return json({ error: "Solicitud inválida.", code: "invalid_request" }, { status: 400 });
  if (!parseBackyardAiProviderConsent(source.consent, AI_PROVIDER_PROCESSING_CONSENT)) return json({ error: "Autoriza el procesamiento por IA para continuar.", code: "consent_required" }, { status: 403 });
  if (typeof source.input !== "string") return json({ error: "Dime cómo juegan hoy.", code: "missing_input" }, { status: 400 });
  const input = source.input.trim();
  if (input.length < 2) return json({ error: "Dime cómo juegan hoy.", code: "missing_input" }, { status: 400 });
  if (input.length > MAX_INPUT_LENGTH) return json({ error: "La instrucción es demasiado grande.", code: "input_too_long" }, { status: 413 });
  const storedConsent = await verifyStoredAiProcessingConsent(request, AI_PROVIDER_PROCESSING_CONSENT);
  if (!storedConsent.ok) return json({ error: storedConsent.error, code: storedConsent.code }, { status: storedConsent.status });

  // Invalid or non-consented requests are bounded by the cheap IP burst gate
  // above, but cannot consume the shared provider budget.
  const globalLimiterKey = createHmac("sha256", process.env.OPENAI_API_KEY!).update("round-setup:global-budget").digest("hex");
  if (!consumeBackyardAiLimit(globalLimiterKey, GLOBAL_RATE_LIMIT, RATE_WINDOW_MS)) return json({ error: "Backyard AI alcanzó su capacidad temporal. Intenta más tarde.", code: "global_rate_limit" }, { status: 429 });
  const persistentLimiter = getSupabaseAdmin("cloud");
  if (!persistentLimiter) return json({ error: "El control de uso de Backyard AI necesita configuración del servidor.", code: "rate_limit_config" }, { status: 503 });
  try {
    const allowed = await consumePersistentRulesAiLimit(persistentLimiter, limiterKey, RATE_LIMIT, Math.ceil(RATE_WINDOW_MS / 1_000));
    const globalAllowed = allowed && await consumePersistentRulesAiLimit(persistentLimiter, globalLimiterKey, GLOBAL_RATE_LIMIT, Math.ceil(RATE_WINDOW_MS / 1_000));
    if (!allowed || !globalAllowed) return json({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto.", code: "rate_limit" }, { status: 429 });
  } catch {
    return json({ error: "No pudimos validar el límite de uso. Intenta nuevamente.", code: "rate_limit_unavailable" }, { status: 503 });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 1 }) as unknown as BackyardOpenAiClient;
  const providerStartedAt = Date.now();
  try {
    const rawResult = await generateBackyardAiJson<unknown>({
      client,
      model: config.roundSetupModel,
      instructions: instructions(),
      input,
      format: ROUND_SETUP_FORMAT,
      maxOutputTokens: 1_200,
    });
    const result = modelRoundSetup(rawResult);
    if (!result) {
      logRoundSetupProvider({ model: config.roundSetupModel, status: "error", latencyMs: Date.now() - providerStartedAt, errorCode: "invalid_interpretation" });
      return json({ error: "Backyard AI no pudo interpretar la instrucción.", code: "invalid_interpretation" }, { status: 502 });
    }
    const integrity = validateCanonicalRoundCommand(input, result.canonicalCommand);
    if (!integrity.ok) {
      logRoundSetupProvider({ model: config.roundSetupModel, status: "error", latencyMs: Date.now() - providerStartedAt, errorCode: "canonical_integrity" });
      return json({ error: "La interpretación remota no conservó la instrucción original.", code: "canonical_integrity" }, { status: 502 });
    }
    logRoundSetupProvider({ model: config.roundSetupModel, status: "success", latencyMs: Date.now() - providerStartedAt, errorCode: null });
    return json(result);
  } catch (error) {
    const failure = classifyBackyardAiFailure(error);
    logRoundSetupProvider({ model: config.roundSetupModel, status: "error", latencyMs: Date.now() - providerStartedAt, errorCode: failure.code });
    return json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}

export async function GET() {
  return json(publicBackyardAiStatus(process.env));
}
