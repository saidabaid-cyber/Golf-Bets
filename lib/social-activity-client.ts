/** Authenticated, non-optimistic transport: a failed write never looks saved. */
export class SocialActivityError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) { super(message); }
}

export async function socialRequest<T>(path: string, accessToken: string, options: {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
} = {}): Promise<T> {
  if (!accessToken) throw new SocialActivityError("Inicia sesión para usar Social.", "AUTH_REQUIRED", 401);
  if (!path.startsWith("/api/social/") && path !== "/api/account/completion" && path.split("?")[0] !== "/api/groups/users") throw new SocialActivityError("Ruta Social inválida.", "INVALID_PATH", 400);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const response = await (options.fetcher || fetch)(path, {
      method: options.method || "GET",
      headers: { Authorization: `Bearer ${accessToken}`, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
      cache: "no-store", signal: controller.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new SocialActivityError(
        typeof result?.error === "string" ? result.error : "No se pudo guardar el cambio. Intenta de nuevo.",
        typeof result?.code === "string" ? result.code : "SOCIAL_REQUEST_FAILED", response.status,
      );
    }
    if (!result || typeof result !== "object") throw new SocialActivityError("Respuesta Social incompleta.", "INVALID_RESPONSE", 502);
    return result as T;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function socialErrorMessage(error: unknown) {
  if (error instanceof SocialActivityError) return ["PENDING_CONTROLLED_DB_APPLY", "SOCIAL_SCHEMA_PENDING"].includes(error.code)
    ? "Social no está disponible en este momento. No se confirmó el cambio; intenta más tarde."
    : error.message;
  if (error instanceof Error && error.name === "AbortError") return "La solicitud tardó demasiado. Revisa la conexión y vuelve a intentar.";
  return "No se pudo conectar con Social. No se confirmó el cambio.";
}
