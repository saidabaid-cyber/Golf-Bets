import "server-only";

import { createHmac } from "node:crypto";
import OpenAI, { toFile } from "openai";
import type { NextRequest } from "next/server";

import { avatarGenerationConfig, type GeneratedImage, type GenerateAvatarRequest } from "./avatar-generation";
import { optimizeGeneratedAvatarDataUrl } from "./avatar-generation-image";
import { type AvatarGenerationDeps } from "./avatar-generation-service";
import { reconcileGeneratedAvatarUpload } from "./avatar-generation-storage";
import { consumeBackyardAiLimit } from "./backyard-ai/server/rate-limit";
import { verifyStoredAiProcessingConsent } from "./backyard-ai/server/processing-consent";
import { consumePersistentRulesAiLimit } from "./rules-ai-rate-limit";
import { authenticatedRequest } from "./server-auth";
import { getSupabaseAdmin } from "./supabase/server";

const GENERATE_USER_LIMIT = 3;
const GENERATE_USER_WINDOW_SECONDS = 86_400;
const GENERATE_GLOBAL_LIMIT = 50;
const GENERATE_GLOBAL_WINDOW_SECONDS = 86_400;
const USE_USER_LIMIT = 10;
const USE_USER_WINDOW_SECONDS = 3_600;
const PROVIDER_TIMEOUT_MS = 60_000;

function styleInstruction(style: GenerateAvatarRequest["style"]) {
  switch (style) {
    case "realistic": return "a tasteful realistic portrait";
    case "illustrated": return "a refined editorial illustration";
    case "cartoon": return "a friendly, polished cartoon portrait";
    case "minimalist": return "a minimalist portrait with clean shapes";
  }
}

function avatarPrompt(input: GenerateAvatarRequest) {
  const userDescription = input.description ? `Requested details: ${input.description}` : "";
  return [
    `Create one square golf-inspired personal avatar in the style of ${styleInstruction(input.style)}.`,
    "Use an original composition and a neutral background. No words, brands, logos, watermarks or unsupported personal details.",
    input.source === "photo"
      ? "Use only the voluntarily supplied reference image for appearance; preserve recognizable likeness without inferring identity or sensitive traits."
      : "No reference photo is provided; represent only the details supplied by the user.",
    userDescription,
  ].filter(Boolean).join("\n");
}

function providerUserId(userId: string, secret: string) {
  return createHmac("sha256", secret).update(`avatar-provider:${userId}`).digest("hex");
}

/** Constructs adapters; no provider call or Storage write happens here. All
 * access is bound to the current isolated Preview config. */
export function avatarGenerationDeps(request: NextRequest): AvatarGenerationDeps {
  const config = avatarGenerationConfig(process.env);
  const admin = config.available ? getSupabaseAdmin("cloud") : null;
  return {
    config,
    optimize: optimizeGeneratedAvatarDataUrl,
    authenticate: async () => {
      try {
        const result = await authenticatedRequest(request);
        return result.ok ? { ok: true, userId: result.userId }
          : { ok: false, status: result.status, code: result.code, error: result.error };
      } catch {
        return { ok: false, status: 503, code: "AUTH_UNAVAILABLE", error: "No pude verificar tu sesión en Preview." };
      }
    },
    verifyConsent: async scope => {
      try {
        const result = await verifyStoredAiProcessingConsent(request, scope);
        return result.ok && result.authenticated && result.userId
          ? { ok: true, userId: result.userId }
          : result.ok
            ? { ok: false, status: 403, code: "CONSENT_REQUIRED", error: "No pude confirmar tu autorización para IA." }
            : { ok: false, status: result.status, code: result.code, error: result.error };
      } catch {
        return { ok: false, status: 503, code: "CONSENT_UNAVAILABLE", error: "No pude verificar tu autorización de IA." };
      }
    },
    publicBucket: async () => {
      if (!admin) return { ok: false, status: 503, code: "STORAGE_UNAVAILABLE", error: "Storage aislado de Preview no está disponible." };
      try {
        const { data, error } = await admin.storage.getBucket(config.bucket);
        return !error && data && data.public === true && data.id === config.bucket
          ? { ok: true }
          : { ok: false, status: 503, code: "PUBLIC_BUCKET_REQUIRED", error: "El bucket público de avatar no está listo en Preview." };
      } catch {
        return { ok: false, status: 503, code: "STORAGE_UNAVAILABLE", error: "No pude confirmar el bucket de avatar." };
      }
    },
    consumeLimit: async (userId, action) => {
      if (!admin) throw new Error("rate_limit_admin_unavailable");
      const key = (suffix: string) => createHmac("sha256", config.signingSecret).update(`avatar-rate:${suffix}`).digest("hex");
      const userKey = key(`${action}:user:${userId}`);
      const localLimit = action === "generate" ? GENERATE_USER_LIMIT : USE_USER_LIMIT;
      if (!consumeBackyardAiLimit(userKey, localLimit, 60_000)) return false;
      const userAllowed = await consumePersistentRulesAiLimit(admin, userKey,
        action === "generate" ? GENERATE_USER_LIMIT : USE_USER_LIMIT,
        action === "generate" ? GENERATE_USER_WINDOW_SECONDS : USE_USER_WINDOW_SECONDS);
      if (!userAllowed) return false;
      return action === "use" || await consumePersistentRulesAiLimit(admin,
        key("generate:global"), GENERATE_GLOBAL_LIMIT, GENERATE_GLOBAL_WINDOW_SECONDS);
    },
    generate: async (input: GenerateAvatarRequest & { userId: string; photo?: GeneratedImage }) => {
      const client = new OpenAI({ apiKey: config.apiKey, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 0 });
      const common = {
        model: config.model,
        prompt: avatarPrompt(input),
        n: 1,
        size: "1024x1024" as const,
        quality: "medium" as const,
        output_format: "webp" as const,
        output_compression: 60,
        user: providerUserId(input.userId, config.signingSecret),
      };
      const result = input.source === "photo" && input.photo
        ? await client.images.edit({ ...common, image: await toFile(input.photo.bytes, "avatar-reference.webp", { type: "image/webp" }) })
        : await client.images.generate(common);
      const encoded = result.data?.[0]?.b64_json;
      if (typeof encoded !== "string" || encoded.length > 2_700_000 || encoded.length === 0) throw new Error("invalid_provider_payload");
      return `data:image/webp;base64,${encoded}`;
    },
    upload: async (path, image) => {
      if (!admin) throw new Error("avatar_storage_unavailable");
      const storage = admin.storage.from(config.bucket);
      return reconcileGeneratedAvatarUpload(path, image, {
        upload: async () => {
          const result = await storage.upload(path, image.bytes, {
            contentType: image.mime,
            cacheControl: "31536000",
            upsert: false,
          });
          return { path: result.data?.path || null, error: result.error };
        },
        download: async () => {
          const result = await storage.download(path);
          if (result.error || !result.data || result.data.size > 134_900) return null;
          return Buffer.from(await result.data.arrayBuffer());
        },
        publicUrl: () => storage.getPublicUrl(path).data.publicUrl,
      });
    },
  };
}
