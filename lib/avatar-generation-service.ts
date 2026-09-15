import { randomUUID } from "node:crypto";
import {
  AVATAR_GENERATION_CONSENT_VERSION,
  GENERATION_TOKEN_TTL_MS,
  MAX_GENERATED_AVATAR_BYTES,
  MAX_GENERATED_AVATAR_DATA_URL_LENGTH,
  canonicalGeneratedAvatarUrl,
  createGenerationToken,
  decodeAvatarDataUrl,
  generatedAvatarPath,
  parseGenerateAvatarRequest,
  parseUseAvatarRequest,
  verifyGenerationToken,
  type AvatarGenerationConfig,
  type AvatarSource,
  type GenerateAvatarRequest,
  type GeneratedImage,
} from "./avatar-generation";
import { AI_IMAGE_PROCESSING_CONSENT, AI_PROVIDER_PROCESSING_CONSENT, type BackyardAiProcessingConsentScope } from "./backyard-ai/privacy";
import { MAX_PERSISTABLE_AVATAR_DATA_URL_LENGTH } from "./avatar-generation-image";
import { classifyAvatarProviderFailure } from "./avatar-generation-provider";

export type AvatarActionResult = { status: number; body: Record<string, unknown> };
type CheckFailure = { ok: false; status: number; code: string; error: string };
type AuthCheck = { ok: true; userId: string } | CheckFailure;
type ConsentCheck = { ok: true; userId: string } | CheckFailure;
type BucketCheck = { ok: true } | CheckFailure;

export type AvatarGenerationDeps = {
  config: AvatarGenerationConfig;
  authenticate: () => Promise<AuthCheck>;
  verifyConsent: (scope: BackyardAiProcessingConsentScope) => Promise<ConsentCheck>;
  publicBucket: () => Promise<BucketCheck>;
  consumeLimit: (userId: string, action: "generate" | "use") => Promise<boolean>;
  generate: (input: GenerateAvatarRequest & { userId: string; photo?: GeneratedImage }) => Promise<string>;
  optimize: (providerDataUrl: string) => Promise<string>;
  upload: (path: string, image: GeneratedImage) => Promise<{ path: string; publicUrl: string }>;
  now?: () => number;
  assetId?: () => string;
};

const blocked = (missing: string[] = []): AvatarActionResult => ({
  status: 503,
  body: {
    available: false,
    code: "BLOCKED_EXTERNAL_IMAGE_PROVIDER",
    error: "La generación de avatar necesita un proveedor y Storage aislados de Preview.",
    missing,
  },
});

function failure(result: CheckFailure): AvatarActionResult {
  return { status: result.status, body: { code: result.code, error: result.error } };
}

function consentScope(source: AvatarSource): BackyardAiProcessingConsentScope {
  return source === "photo" ? AI_IMAGE_PROCESSING_CONSENT : AI_PROVIDER_PROCESSING_CONSENT;
}

/** Environment and bucket readiness are reported without paying for an image.
 * Consent remains a separate user choice; unavailable config gets 200 so the
 * UI can display the exact external boundary rather than a fake "Próximamente". */
export async function avatarCapabilities(deps: AvatarGenerationDeps): Promise<AvatarActionResult> {
  if (!deps.config.available) return { status: 200, body: blocked(deps.config.missing).body };
  const account = await deps.authenticate();
  if (!account.ok) return failure(account);
  const bucket = await deps.publicBucket();
  if (!bucket.ok) return { status: 200, body: blocked(["BACKYARD_AVATAR_STORAGE_BUCKET (public bucket)"]).body };
  return { status: 200, body: { available: true, code: "READY", error: null, missing: [] } };
}

export async function generateAvatarCandidate(value: unknown, deps: AvatarGenerationDeps): Promise<AvatarActionResult> {
  if (!deps.config.available) return blocked(deps.config.missing);
  const account = await deps.authenticate();
  if (!account.ok) return failure(account);
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: 400, body: { code: "INVALID_REQUEST", error: "Revisa las opciones de tu avatar." } };
  const source = value as Record<string, unknown>;
  if (source.consent !== true || source.consentVersion !== AVATAR_GENERATION_CONSENT_VERSION) {
    return { status: 403, body: { code: "CONSENT_REQUIRED", error: "Autoriza explícitamente este procesamiento de avatar por IA." } };
  }
  const parsed = parseGenerateAvatarRequest(value);
  if (!parsed) return { status: 400, body: { code: "INVALID_REQUEST", error: "Revisa la descripción o la foto seleccionada de tu avatar." } };
  const consent = await deps.verifyConsent(consentScope(parsed.source));
  if (!consent.ok) return failure(consent);
  if (consent.userId !== account.userId) return { status: 403, body: { code: "CONSENT_IDENTITY_MISMATCH", error: "No pude confirmar la autorización de esta cuenta." } };
  const bucket = await deps.publicBucket();
  if (!bucket.ok) return blocked(["BACKYARD_AVATAR_STORAGE_BUCKET (public bucket)"]);
  let allowed: boolean;
  try { allowed = await deps.consumeLimit(account.userId, "generate"); }
  catch { return { status: 503, body: { code: "RATE_LIMIT_UNAVAILABLE", error: "No pudimos verificar el límite de uso. Intenta más tarde." } }; }
  if (!allowed) return { status: 429, body: { code: "RATE_LIMIT", error: "Alcanzaste el límite temporal de generación. Intenta más tarde." } };
  let photo: GeneratedImage | undefined;
  if (parsed.source === "photo") {
    try {
      const optimizedPhoto = await deps.optimize(parsed.photoDataUrl!);
      photo = decodeAvatarDataUrl(optimizedPhoto, MAX_PERSISTABLE_AVATAR_DATA_URL_LENGTH, 134_900) || undefined;
    } catch { /* Reject a corrupt or decompression-bomb reference before OpenAI. */ }
    if (!photo || photo.mime !== "image/webp") {
      return { status: 400, body: { code: "INVALID_PHOTO", error: "Elige una foto válida para crear el avatar." } };
    }
  }
  let rawImage: string;
  try { rawImage = await deps.generate({ ...parsed, userId: account.userId, ...(photo ? { photo } : {}) }); }
  catch (error) { return classifyAvatarProviderFailure(error); }
  if (!decodeAvatarDataUrl(rawImage, MAX_GENERATED_AVATAR_DATA_URL_LENGTH, MAX_GENERATED_AVATAR_BYTES)) {
    return { status: 502, body: { code: "INVALID_PROVIDER_IMAGE", error: "El proveedor no entregó una imagen de avatar válida." } };
  }
  let optimized: string;
  try { optimized = await deps.optimize(rawImage); }
  catch { return { status: 502, body: { code: "AVATAR_OPTIMIZATION_FAILED", error: "No pude preparar esta imagen para tu perfil. Genera otro avatar." } }; }
  const image = decodeAvatarDataUrl(optimized, MAX_PERSISTABLE_AVATAR_DATA_URL_LENGTH, 134_900);
  if (!image || image.mime !== "image/webp") {
    return { status: 502, body: { code: "INVALID_OPTIMIZED_IMAGE", error: "La imagen optimizada no es válida para tu perfil." } };
  }
  const token = createGenerationToken({
    v: 1,
    uid: account.userId,
    aid: (deps.assetId || randomUUID)(),
    src: parsed.source,
    mime: image.mime,
    hash: image.hash,
    exp: (deps.now || Date.now)() + GENERATION_TOKEN_TTL_MS,
  }, deps.config.signingSecret);
  return { status: 200, body: { imageDataUrl: image.dataUrl, generationToken: token } };
}

/** Only the explicit USAR action uploads. Never writes profiles.avatar_url;
 * the existing profile-save flow remains the single canonical account write. */
export async function commitGeneratedAvatar(value: unknown, deps: AvatarGenerationDeps): Promise<AvatarActionResult> {
  if (!deps.config.available) return blocked(deps.config.missing);
  const account = await deps.authenticate();
  if (!account.ok) return failure(account);
  const parsed = parseUseAvatarRequest(value);
  if (!parsed) return { status: 400, body: { code: "INVALID_REQUEST", error: "El avatar generado no es válido. Genera otro." } };
  if (parsed.image.mime !== "image/webp" || parsed.image.dataUrl.length > MAX_PERSISTABLE_AVATAR_DATA_URL_LENGTH
    || parsed.image.bytes.length > 134_900) {
    return { status: 400, body: { code: "INVALID_REQUEST", error: "El avatar generado es demasiado grande. Genera otro." } };
  }
  const proof = verifyGenerationToken(parsed.token, deps.config.signingSecret, account.userId, parsed.image, (deps.now || Date.now)());
  if (!proof) return { status: 403, body: { code: "GENERATION_PROOF_INVALID", error: "La vista previa expiró o fue modificada. Genera otro avatar." } };
  const consent = await deps.verifyConsent(consentScope(proof.src));
  if (!consent.ok) return failure(consent);
  if (consent.userId !== account.userId) return { status: 403, body: { code: "CONSENT_IDENTITY_MISMATCH", error: "No pude confirmar la autorización de esta cuenta." } };
  const bucket = await deps.publicBucket();
  if (!bucket.ok) return blocked(["BACKYARD_AVATAR_STORAGE_BUCKET (public bucket)"]);
  let allowed: boolean;
  try { allowed = await deps.consumeLimit(account.userId, "use"); }
  catch { return { status: 503, body: { code: "RATE_LIMIT_UNAVAILABLE", error: "No pudimos verificar el límite de uso. Intenta más tarde." } }; }
  if (!allowed) return { status: 429, body: { code: "RATE_LIMIT", error: "Demasiados intentos de guardar avatar. Intenta más tarde." } };
  const path = generatedAvatarPath(account.userId, proof.aid, parsed.image.extension);
  let uploaded: { path: string; publicUrl: string };
  try { uploaded = await deps.upload(path, parsed.image); }
  catch { return { status: 503, body: { code: "AVATAR_STORAGE_UNAVAILABLE", error: "No se confirmó el guardado del avatar. Tu perfil no cambió." } }; }
  const url = uploaded.path === path
    ? canonicalGeneratedAvatarUrl(uploaded.publicUrl, deps.config.supabaseOrigin, deps.config.bucket, path)
    : null;
  if (!url) return { status: 502, body: { code: "AVATAR_STORAGE_UNCONFIRMED", error: "Storage no confirmó una URL estable para este avatar. Tu perfil no cambió." } };
  return { status: 200, body: { avatarUrl: url, avatarType: "generated_avatar", assetId: proof.aid } };
}
