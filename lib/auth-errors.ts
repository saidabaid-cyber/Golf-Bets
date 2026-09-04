type AuthErrorDetail = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
};

/**
 * Only Supabase Auth's definitive rejection signals mean that a session is no
 * longer recoverable. Network, timeout, gateway and PostgREST failures must
 * stay retryable and must never sign the user out.
 */
export function isDefinitiveAuthFailure(error: unknown) {
  const detail = (error && typeof error === "object" ? error : {}) as AuthErrorDetail;
  const status = Number(detail.status || 0);
  const text = `${String(detail.code || "")} ${String(detail.message || "")}`.toLowerCase();
  if (status === 401) return true;
  return /refresh_token_(?:not_found|already_used)|invalid refresh token|refresh token.*(?:expired|revoked)|bad_jwt|invalid jwt|user_not_found/.test(text);
}

export function authUserFailure(error: unknown, hasUser: boolean) {
  if (hasUser) return null;
  if (!error || isDefinitiveAuthFailure(error)) {
    return { status: 401 as const, code: "AUTH_REQUIRED", error: "La sesión terminó. Vuelve a iniciar sesión para conectar la nube." };
  }
  return { status: 503 as const, code: "AUTH_UNAVAILABLE", error: "No pudimos validar la sesión en este momento. Tu copia local se conserva; reintenta." };
}
