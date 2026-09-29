import "server-only";

import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  MAX_PHOTO_AVATAR_VARIANTS,
  PHOTO_AVATAR_GENERATION_STYLE,
} from "../../../../lib/photo-avatar-generation";
import {
  generatePremiumGolfAvatar,
  parsePhotoAvatarSourceDataUrl,
} from "../../../../lib/photo-avatar-generation.server";
import {
  AI_IMAGE_PROCESSING_CONSENT,
  parseBackyardAiProviderConsent,
} from "../../../../lib/backyard-ai/privacy";
import { backyardAiConfig } from "../../../../lib/backyard-ai/server/config";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  hasOnlyKeys,
  isCrossSiteRequest,
  isJsonRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";
import { classifyBackyardAiFailure } from "../../../../lib/backyard-ai/server/openai-structured";
import { verifyStoredAiProcessingConsent } from "../../../../lib/backyard-ai/server/processing-consent";
import { consumeBackyardAiLimit } from "../../../../lib/backyard-ai/server/rate-limit";
import { consumePersistentRulesAiLimit } from "../../../../lib/rules-ai-rate-limit";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_REQUEST_BYTES = 200_000;
const GENERATION_LIMIT = 3;
const GENERATION_WINDOW_SECONDS = 3_600;

function json(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...BACKYARD_AI_PRIVATE_HEADERS, ...init.headers } });
}

function capability() {
  const config = backyardAiConfig(process.env);
  return {
    available: config.ready,
    provider: "openai" as const,
    model: config.avatarImageModel,
    ...(!config.enabled ? { reason: "disabled" as const } : !config.configured ? { reason: "missing_config" as const } : {}),
  };
}

export async function GET() {
  return json(capability());
}

export async function POST(request: NextRequest) {
  const config = backyardAiConfig(process.env);
  if (!config.enabled) return json({ error: "La generación de avatar no está activada en este entorno.", code: "disabled" }, { status: 503 });
  if (!config.providerConfigured) return json({ error: "La generación de avatar necesita OPENAI_API_KEY en el servidor.", code: "missing_provider_config" }, { status: 503 });
  if (!config.limiterConfigured) return json({ error: "La generación de avatar necesita el control de uso del servidor.", code: "missing_config" }, { status: 503 });
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "cross_site" }, { status: 403 });
  if (!isJsonRequest(request)) return json({ error: "La solicitud debe usar JSON.", code: "unsupported_media_type" }, { status: 415 });
  const parsed = await readJsonBodyWithLimit(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return json({
    error: parsed.reason === "too_large" ? "La foto preparada supera el tamaño permitido." : "Solicitud inválida.",
    code: parsed.reason === "too_large" ? "request_too_large" : "invalid_request",
  }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const source = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : null;
  if (
    !source
    || !hasOnlyKeys(source, ["sourceImageDataUrl", "style", "variant", "consent"])
    || source.style !== PHOTO_AVATAR_GENERATION_STYLE
    || !Number.isSafeInteger(source.variant)
    || Number(source.variant) < 1
    || Number(source.variant) > MAX_PHOTO_AVATAR_VARIANTS
  ) return json({ error: "Solicitud inválida.", code: "invalid_request" }, { status: 400 });
  if (!parseBackyardAiProviderConsent(source.consent, AI_IMAGE_PROCESSING_CONSENT)) {
    return json({ error: "Autoriza el procesamiento de la foto para continuar.", code: "consent_required" }, { status: 403 });
  }
  const storedConsent = await verifyStoredAiProcessingConsent(request, AI_IMAGE_PROCESSING_CONSENT);
  if (!storedConsent.ok) return json({ error: storedConsent.error, code: storedConsent.code }, { status: storedConsent.status });
  if (!storedConsent.authenticated || !storedConsent.userId) {
    return json({ error: "Inicia sesión para crear y guardar tu avatar.", code: "auth_required" }, { status: 401 });
  }
  const photo = parsePhotoAvatarSourceDataUrl(source.sourceImageDataUrl);
  if (!photo) return json({ error: "La foto preparada no es válida.", code: "invalid_photo" }, { status: 400 });

  const key = process.env.OPENAI_API_KEY!.trim();
  const limiterKey = createHmac("sha256", key).update(`profile-avatar:${storedConsent.userId}`).digest("hex");
  if (!consumeBackyardAiLimit(limiterKey, GENERATION_LIMIT, GENERATION_WINDOW_SECONDS * 1_000)) {
    return json({ error: "Alcanzaste el límite de variantes por ahora. Intenta más tarde.", code: "rate_limit" }, { status: 429 });
  }
  const persistentLimiter = getSupabaseAdmin("cloud");
  if (!persistentLimiter) return json({ error: "El control de uso necesita configuración.", code: "rate_limit_config" }, { status: 503 });
  try {
    if (!await consumePersistentRulesAiLimit(persistentLimiter, limiterKey, GENERATION_LIMIT, GENERATION_WINDOW_SECONDS)) {
      return json({ error: "Alcanzaste el límite de variantes por ahora. Intenta más tarde.", code: "rate_limit" }, { status: 429 });
    }
  } catch {
    return json({ error: "No pudimos validar el límite de uso.", code: "rate_limit_unavailable" }, { status: 503 });
  }

  const variant = Number(source.variant);
  const userHash = createHmac("sha256", key).update(`avatar-user:${storedConsent.userId}`).digest("hex");
  const startedAt = Date.now();
  try {
    const avatarDataUrl = await generatePremiumGolfAvatar({
      apiKey: key,
      model: config.avatarImageModel,
      source: photo,
      variant,
      userHash,
    });
    console.info("Backyard profile avatar provider", {
      provider: "openai",
      model: config.avatarImageModel,
      status: "success",
      latencyMs: Date.now() - startedAt,
      variant,
    });
    return json({ avatarDataUrl, provider: "openai", model: config.avatarImageModel, variant });
  } catch (error) {
    const failure = classifyBackyardAiFailure(error);
    console.error("Backyard profile avatar provider", {
      provider: "openai",
      model: config.avatarImageModel,
      status: "error",
      latencyMs: Date.now() - startedAt,
      errorCode: failure.code,
      variant,
    });
    return json({ error: "No pudimos crear el avatar. Intenta nuevamente.", code: failure.code }, { status: failure.status });
  }
}
