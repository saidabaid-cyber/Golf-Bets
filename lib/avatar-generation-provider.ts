import type { AvatarActionResult } from "./avatar-generation-service";

/** OpenAI exceptions may contain prompts or request details. Report only a
 * small safe category, never the exception message or response body. */
export function classifyAvatarProviderFailure(error: unknown): AvatarActionResult {
  const source = error && typeof error === "object" ? error as { status?: unknown; name?: unknown } : null;
  const status = typeof source?.status === "number" ? source.status : null;
  const name = typeof source?.name === "string" ? source.name : "";
  if (name === "APIConnectionTimeoutError" || name === "AbortError") {
    return { status: 504, body: { code: "IMAGE_PROVIDER_TIMEOUT", error: "El proveedor tardó demasiado. Reintenta la generación." } };
  }
  if (status === 429) {
    return { status: 429, body: { code: "IMAGE_PROVIDER_QUOTA", error: "El proveedor alcanzó su límite temporal. Intenta más tarde." } };
  }
  if ([400, 401, 403, 404].includes(status || 0) || name === "APIConnectionError") {
    return { status: 503, body: { code: "BLOCKED_EXTERNAL_IMAGE_PROVIDER", error: "El proveedor de imagen no está autorizado o disponible para este Preview." } };
  }
  return { status: 502, body: { code: "IMAGE_GENERATION_FAILED", error: "El proveedor no pudo crear el avatar. Reintenta o cambia la descripción." } };
}
