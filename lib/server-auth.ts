import "server-only";
import type { NextRequest } from "next/server";
import { authUserFailure } from "./auth-errors";
import { getSupabaseForUser } from "./supabase/server";
import { accountAccessFailure } from "./account-access.server";

export function bearerToken(request: NextRequest) {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1] || "";
}

export async function authenticatedRequest(request: NextRequest, options: { allowLifecycleRecovery?: boolean } = {}) {
  const token = bearerToken(request);
  if (!token) return { ok: false as const, status: 401, code: "AUTH_REQUIRED", error: "Inicia sesión para continuar." };
  const client = getSupabaseForUser(token);
  if (!client) return { ok: false as const, status: 503, code: "CLOUD_UNAVAILABLE", error: "La nube de Preview no está disponible." };
  const { data, error } = await client.auth.getUser(token);
  const failure = authUserFailure(error, !error && Boolean(data.user));
  if (failure || !data.user) return { ok: false as const, status: failure?.status ?? 401, code: failure?.code ?? "AUTH_REQUIRED", error: failure?.error ?? "La sesión terminó." };
  if (data.user.is_anonymous) return { ok: false as const, status: 401, code: "AUTH_REQUIRED", error: "Inicia sesión con tu cuenta para continuar." };
  if (!options.allowLifecycleRecovery) {
    const accessFailure = await accountAccessFailure(client);
    if (accessFailure) return { ok: false as const, ...accessFailure };
  }
  return { ok: true as const, userId: data.user.id, token, client, userMetadata: data.user.user_metadata };
}
