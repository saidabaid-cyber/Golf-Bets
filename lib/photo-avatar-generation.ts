import {
  AI_IMAGE_PROCESSING_CONSENT,
  backyardAiProviderConsent,
  type BackyardAiProviderConsent,
} from "./backyard-ai/privacy";

export const PHOTO_AVATAR_GENERATION_ENDPOINT = "/api/profile/avatar-from-photo";
export const PHOTO_AVATAR_GENERATION_STYLE = "backyard-premium-portrait" as const;
export const MAX_PHOTO_AVATAR_VARIANTS = 3;
export const MAX_PHOTO_AVATAR_SOURCE_DATA_URL_LENGTH = 180_000;
export const MAX_GENERATED_AVATAR_DATA_URL_LENGTH = 4_000_000;

export type PhotoAvatarGenerationRequest = {
  sourceImageDataUrl: string;
  style: typeof PHOTO_AVATAR_GENERATION_STYLE;
  variant: number;
  consent: BackyardAiProviderConsent;
};

export type PhotoAvatarGenerationResult = {
  avatarDataUrl: string;
  provider: string;
  model: string;
  variant: number;
};

export type PhotoAvatarGenerationCapability = {
  available: boolean;
  provider: "openai";
  model: string;
  reason?: "disabled" | "missing_config";
};

export class PhotoAvatarGenerationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PhotoAvatarGenerationError";
    this.status = status;
    this.code = code;
  }
}

function generatedAvatarResult(value: unknown): PhotoAvatarGenerationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.avatarDataUrl !== "string"
    || !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(source.avatarDataUrl)
    || source.avatarDataUrl.length > MAX_GENERATED_AVATAR_DATA_URL_LENGTH
    || typeof source.provider !== "string"
    || !source.provider.trim()
    || typeof source.model !== "string"
    || !source.model.trim()
    || !Number.isSafeInteger(source.variant)
    || Number(source.variant) < 1
    || Number(source.variant) > MAX_PHOTO_AVATAR_VARIANTS
  ) return null;
  return {
    avatarDataUrl: source.avatarDataUrl,
    provider: source.provider,
    model: source.model,
    variant: Number(source.variant),
  };
}

async function responseBody(response: Response) {
  return response.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

export async function readPhotoAvatarGenerationCapability(
  fetcher: typeof fetch = fetch,
): Promise<PhotoAvatarGenerationCapability> {
  const response = await fetcher(PHOTO_AVATAR_GENERATION_ENDPOINT, { cache: "no-store" });
  const body = await responseBody(response);
  if (!response.ok || !body || typeof body.available !== "boolean" || body.provider !== "openai" || typeof body.model !== "string") {
    throw new PhotoAvatarGenerationError(response.status || 502, "capability_unavailable", "No pudimos verificar la generación de avatar.");
  }
  const reason = body.reason === "disabled" || body.reason === "missing_config" ? body.reason : undefined;
  return { available: body.available, provider: "openai", model: body.model, ...(reason ? { reason } : {}) };
}

export async function requestPhotoAvatarGeneration(input: {
  sourceImageDataUrl: string;
  variant: number;
  accessToken: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<PhotoAvatarGenerationResult> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(PHOTO_AVATAR_GENERATION_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sourceImageDataUrl: input.sourceImageDataUrl,
      style: PHOTO_AVATAR_GENERATION_STYLE,
      variant: input.variant,
      consent: backyardAiProviderConsent(AI_IMAGE_PROCESSING_CONSENT),
    } satisfies PhotoAvatarGenerationRequest),
    cache: "no-store",
    signal: input.signal,
  });
  const body = await responseBody(response);
  if (!response.ok) {
    throw new PhotoAvatarGenerationError(
      response.status,
      typeof body?.code === "string" ? body.code : "generation_failed",
      typeof body?.error === "string" ? body.error : "No pudimos crear el avatar. Intenta nuevamente.",
    );
  }
  const result = generatedAvatarResult(body);
  if (!result) throw new PhotoAvatarGenerationError(502, "invalid_generation", "No pudimos crear el avatar. Intenta nuevamente.");
  return result;
}
