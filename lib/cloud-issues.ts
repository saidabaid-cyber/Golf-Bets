export type CloudIssueDomain = "auth" | "profile" | "legal" | "round" | "files" | "conflict";
export type CloudIssueKind = "offline" | "session_expired" | "permission" | "schema" | "conflict" | "server" | "pending";

export type CloudIssue = {
  domain: CloudIssueDomain;
  kind: CloudIssueKind;
  message: string;
  retryable: boolean;
};

type ErrorDetail = { code?: unknown; status?: unknown; message?: unknown };

export function cloudIssueFromError(domain: CloudIssueDomain, error: unknown, online = true): CloudIssue {
  const detail = (error && typeof error === "object" ? error : {}) as ErrorDetail;
  const code = String(detail.code || "");
  const status = Number(detail.status || 0);
  const message = String(detail.message || (error instanceof Error ? error.message : error || ""));
  const text = `${code} ${message}`.toLowerCase();

  if (domain === "conflict" || status === 409 || code === "CLOUD_FIELD_CONFLICT") {
    return { domain: "conflict", kind: "conflict", retryable: true, message: "Hay un cambio puntual pendiente entre dos dispositivos. Elige cuál conservar; los demás datos siguen sincronizados." };
  }
  if (!online || /failed to fetch|network|offline|timeout|timed out|abort(?:ed|error)?|connection|conexi[oó]n/.test(text)) {
    return { domain, kind: "offline", retryable: true, message: "Trabajando sin conexión · tus cambios están guardados en este dispositivo y quedan pendientes de sincronizar." };
  }
  if ((domain === "auth" && status === 401) || /account_session_missing|refresh_token_(?:not_found|already_used)|invalid refresh token|refresh token.*(?:expired|revoked)|bad_jwt|invalid jwt|user_not_found/.test(text)) {
    return { domain: "auth", kind: "session_expired", retryable: false, message: "La sesión terminó. Tus datos siguen en este dispositivo; vuelve a iniciar sesión para reconectar la nube." };
  }
  if (status === 401) {
    return { domain, kind: "pending", retryable: true, message: "La nube pidió renovar la sesión. Tus cambios siguen guardados en este dispositivo; reintenta la conexión." };
  }
  if (code === "42501" || status === 403 || /permission denied|row-level|\brls\b/.test(text)) {
    return { domain, kind: "permission", retryable: true, message: "Supabase rechazó esta operación para la cuenta actual. Tus datos locales se conservan." };
  }
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /schema cache|column .* does not exist|table .* does not exist/.test(text)) {
    return { domain, kind: "schema", retryable: true, message: "La nube todavía no admite esta operación. Tus datos locales se conservan." };
  }
  if (domain === "files" || /photo|foto|scorecard/.test(text)) {
    return { domain: "files", kind: "pending", retryable: true, message: "La foto sigue guardada en este dispositivo y queda pendiente de sincronizar." };
  }
  const subject = domain === "profile" ? "el perfil" : domain === "legal" ? "las aceptaciones" : "la ronda";
  return { domain, kind: "server", retryable: true, message: `No pudimos sincronizar ${subject}. Tu copia local se conserva.` };
}

export function cloudIssuePriority(issue: CloudIssue) {
  const order: Record<CloudIssueKind, number> = { session_expired: 0, conflict: 1, permission: 2, schema: 3, server: 4, offline: 5, pending: 6 };
  return order[issue.kind];
}
