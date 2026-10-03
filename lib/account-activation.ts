export type AccountActivation = { status: "active" | "deactivated"; available: boolean };
export function parseAccountActivation(value: unknown): AccountActivation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return (row.status === "active" || row.status === "deactivated") && typeof row.available === "boolean" ? { status: row.status, available: row.available } : null;
}
export async function requestAccountActivation(token: string, action?: "deactivate" | "reactivate", requestId?: string, signal?: AbortSignal, transport: typeof fetch = fetch) {
  const response = await transport("/api/account/activation", { method: action ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, ...(action ? { "content-type": "application/json" } : {}) },
    ...(action ? { body: JSON.stringify({ action, requestId }) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), cache: "no-store", redirect: "error" });
  const body = await response.json().catch(() => null);
  const parsed = parseAccountActivation(body);
  if (!response.ok || !parsed || (action && (!parsed.available || parsed.status !== (action === "deactivate" ? "deactivated" : "active")))) throw new Error(body?.error || "No se confirmó el estado de tu cuenta. Intenta nuevamente.");
  return parsed;
}
