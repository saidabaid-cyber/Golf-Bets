import "server-only";
import { authUserFailure } from "./auth-errors";
import { getSupabaseAdmin, getSupabaseForUser } from "./supabase/server";
import { socialPreviewEnabled } from "./social-preview-gate";
import type { SocialContext } from "./social-activity.server";

const headers = { "cache-control": "private, no-store" };
class HttpError extends Error { constructor(public code: string, public status: number, message = "Solicitud Social inválida.") { super(message); } }
export function requiredString(value: unknown, maxLength = 128) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new HttpError("INVALID_REQUEST", 400);
  return value.trim();
}
export function socialId(value: unknown) {
  const id = requiredString(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError("INVALID_REQUEST", 400);
  return id;
}
export async function socialBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError("INVALID_REQUEST", 415);
  if (Number(request.headers.get("content-length") || 0) > 8192) throw new HttpError("INVALID_REQUEST", 413);
  if (!request.body) throw new HttpError("INVALID_REQUEST", 400);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 8192) { await reader.cancel(); throw new HttpError("INVALID_REQUEST", 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError("INVALID_REQUEST", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("INVALID_REQUEST", 400);
  return body as Record<string, unknown>;
}

/** Bearer is verified with Auth, never decoded/trusted from caller-controlled identity. */
export async function socialHttp(request: Request, operation: (context: SocialContext) => Promise<unknown>): Promise<Response> {
  try {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
    if (!token) return Response.json({ code: "AUTH_REQUIRED", error: "Inicia sesión para usar Social." }, { status: 401, headers });
    if (!socialPreviewEnabled()) return Response.json({ code: "PENDING_CONTROLLED_DB_APPLY", error: "Social requiere la migración y habilitación en una DB Preview aislada." }, { status: 503, headers });
    const client = getSupabaseForUser(token); const admin = getSupabaseAdmin("cloud");
    if (!client || !admin) return Response.json({ code: "CLOUD_UNAVAILABLE", error: "La conexión de Social no está configurada." }, { status: 503, headers });
    const { data, error } = await client.auth.getUser(token);
    const failure = authUserFailure(error, !error && Boolean(data.user));
    if (failure) return Response.json(failure, { status: failure.status, headers });
    if (!data.user || data.user.is_anonymous) return Response.json({ code: "AUTH_REQUIRED", error: "Necesitas una cuenta vinculada para usar Social." }, { status: 401, headers });
    const result = await operation({ client, admin, userId: data.user.id });
    return Response.json(result, { headers });
  } catch (error) {
    const safe = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; message?: unknown } : {};
    const code = typeof safe.code === "string" && /^[A-Z_]{3,64}$/.test(safe.code) ? safe.code : "MUTATION_FAILED";
    const status = typeof safe.status === "number" && [400, 401, 403, 404, 409, 413, 415, 429, 503].includes(safe.status) ? safe.status : 503;
    const message = code === "SOCIAL_SCHEMA_PENDING" ? "PENDING_CONTROLLED_DB_APPLY · Falta aplicar Social en la DB Preview aislada."
      : status === 409 ? "La tarjeta cambió o esta acción ya fue registrada. Actualiza para revisar la versión actual."
      : status === 403 ? "Tu cuenta no tiene permiso para esta acción."
      : status === 404 ? "Esta tarjeta ya no está disponible para tu cuenta."
      : status === 400 || status === 413 || status === 415 ? "Revisa los datos. Comentarios: máximo 500 caracteres."
      : "No se pudo confirmar el cambio en Social. Intenta de nuevo.";
    console.error("backyard_social_request_failed", { code, status });
    return Response.json({ code, error: message }, { status, headers });
  }
}
