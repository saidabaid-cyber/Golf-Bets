import { PROFILE_IMAGE_MAX_DATA_URL_LENGTH } from "./profile-image";
import { acceptRemoteAiProcessingConsent } from "./backyard-ai/consent-client";
import { AI_IMAGE_PROCESSING_CONSENT, AI_PROVIDER_PROCESSING_CONSENT } from "./backyard-ai/privacy";

export const AVATAR_GENERATION_CONSENT_VERSION = "avatar-generation-v1";
export const AVATAR_STYLES = ["realistic", "illustrated", "cartoon", "minimalist"] as const;
export type AvatarStyle = typeof AVATAR_STYLES[number];
export type AvatarGenerationDraft = {
  source: "description" | "photo";
  description: string;
  style: AvatarStyle;
  photoDataUrl?: string;
};
export type AvatarGenerationPreview = { imageDataUrl: string; generationToken: string };
export type AvatarGenerationAvailability = { available: boolean; code?: string; error?: string; missing?: string[] };

async function avatarResponse(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("El servidor devolvió una respuesta inválida. No se cambió tu avatar.");
  const value = payload as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "No se pudo completar la solicitud. Tu avatar sigue intacto.");
  return value;
}

export async function avatarGenerationAvailability(accessToken?: string | null, signal?: AbortSignal): Promise<AvatarGenerationAvailability> {
  const payload = await avatarResponse(await fetch("/api/profile/avatar", { cache: "no-store", signal, headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined }));
  return {
    available: payload.available === true,
    code: typeof payload.code === "string" ? payload.code : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
    missing: Array.isArray(payload.missing) ? payload.missing.filter((entry): entry is string => typeof entry === "string") : undefined,
  };
}

export async function generateProfileAvatar(accessToken: string | null | undefined, userId: string | undefined, draft: AvatarGenerationDraft, consent: boolean, signal?: AbortSignal): Promise<AvatarGenerationPreview> {
  if (!accessToken || !userId) throw new Error("Inicia sesión para crear y guardar tu avatar.");
  if (!consent) throw new Error("Autoriza el envío de esta descripción o foto a OpenAI antes de generar.");
  if (draft.source === "description" && !draft.description.trim()) throw new Error("Describe cómo quieres verte.");
  if (draft.source === "photo" && !draft.photoDataUrl) throw new Error("Selecciona voluntariamente una foto para esta creación.");
  const scope = draft.source === "photo" ? AI_IMAGE_PROCESSING_CONSENT : AI_PROVIDER_PROCESSING_CONSENT;
  const accepted = await acceptRemoteAiProcessingConsent(accessToken, userId, scope, signal);
  if (!accepted.active) throw new Error("No se pudo guardar tu autorización. No se envió contenido al proveedor.");
  signal?.throwIfAborted();
  const payload = await avatarResponse(await fetch("/api/profile/avatar/generate", {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ source: draft.source, description: draft.description.trim(), style: draft.style,
      ...(draft.source === "photo" ? { photoDataUrl: draft.photoDataUrl } : {}), consent: true, consentVersion: AVATAR_GENERATION_CONSENT_VERSION }),
  }));
  if (typeof payload.imageDataUrl !== "string" || payload.imageDataUrl.length > PROFILE_IMAGE_MAX_DATA_URL_LENGTH || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.imageDataUrl)
    || typeof payload.generationToken !== "string" || !payload.generationToken || payload.generationToken.length > 8192) throw new Error("La imagen generada no es válida. No se cambió tu avatar.");
  return { imageDataUrl: payload.imageDataUrl, generationToken: payload.generationToken };
}

export async function commitGeneratedProfileAvatar(accessToken: string | null | undefined, preview: AvatarGenerationPreview, signal?: AbortSignal): Promise<string> {
  if (!accessToken) throw new Error("Inicia sesión para guardar tu avatar.");
  const payload = await avatarResponse(await fetch("/api/profile/avatar/use", {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ...preview, consentVersion: AVATAR_GENERATION_CONSENT_VERSION }),
  }));
  if (payload.avatarType !== "generated_avatar" || typeof payload.avatarUrl !== "string" || payload.avatarUrl.length > 2048) throw new Error("No se confirmó el guardado del avatar. Reintenta.");
  const url = new URL(payload.avatarUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("El servidor devolvió un enlace de avatar inválido.");
  return url.href;
}
