import { STATISTICS_DELETE_CONFIRMATION, STATISTICS_RESET_STRATEGY, parseStatisticsReset } from "./statistics-reset";

export type StatisticsStoreError = { code?: string; message?: string };
export type StatisticsQuery<T> = { data: T | null; error: StatisticsStoreError | null };
export type StatisticsResetGateway = {
  canonical: (userId: string) => Promise<StatisticsQuery<{ reset_at: string; strategy: string }>>;
  request: (userId: string, requestId: string) => Promise<StatisticsQuery<{ reset_at: string }>>;
  execute: (confirmation: string, requestId: string) => Promise<StatisticsQuery<unknown>>;
};
export type StatisticsApiResult = { status: number; body: Record<string, unknown> };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validStatisticsResetRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

export function parseStatisticsResetRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!Object.keys(body).every(key => ["confirmation", "requestId"].includes(key))) return null;
  return body.confirmation === STATISTICS_DELETE_CONFIRMATION && validStatisticsResetRequestId(body.requestId)
    ? { confirmation: STATISTICS_DELETE_CONFIRMATION, requestId: body.requestId } : null;
}

function schemaPending(error: StatisticsStoreError | null) {
  return ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code || "")
    || /reset_my_statistics|user_statistics_resets|user_statistics_reset_requests|schema cache/i.test(error?.message || "");
}

function unavailable(error: StatisticsStoreError | null, attempted: boolean): StatisticsApiResult {
  return schemaPending(error)
    ? { status: 503, body: { code: "PENDING_CONTROLLED_DB_APPLY", error: "El reset transaccional requiere las migraciones aditivas en una base Preview aislada.", ...(attempted ? {} : { noDataDeleted: true }) } }
    : { status: 503, body: { code: attempted ? "RESET_CONFIRMATION_PENDING" : "STATISTICS_STORE_UNAVAILABLE", error: attempted
      ? "No pude confirmar el reset. Reintenta con la misma solicitud; tu histórico no se borró."
      : "No pude consultar el estado autoritativo de tus estadísticas." } };
}

function canonicalRecord(value: { reset_at: string; strategy: string } | null) {
  return value ? parseStatisticsReset({ resetAt: value.reset_at, strategy: value.strategy }) : null;
}

/** GET never interprets a database error as 'no reset'. */
export async function statisticsResetStatus(gateway: StatisticsResetGateway, userId: string): Promise<StatisticsApiResult> {
  let result: StatisticsQuery<{ reset_at: string; strategy: string }>;
  try { result = await gateway.canonical(userId); }
  catch { return unavailable(null, false); }
  if (result.error) return unavailable(result.error, false);
  const reset = canonicalRecord(result.data);
  if (result.data && !reset) return { status: 503, body: { code: "STATISTICS_STORE_INVALID", error: "El estado de reset no pasó validación." } };
  return { status: 200, body: reset || { resetAt: null, strategy: STATISTICS_RESET_STRATEGY } };
}

function confirmed(request: { reset_at: string } | null, canonical: { reset_at: string; strategy: string } | null, requestId: string): StatisticsApiResult | null {
  const reset = canonicalRecord(canonical);
  if (!request || !reset) return null;
  const requestTime = Date.parse(request.reset_at);
  if (!Number.isFinite(requestTime) || Date.parse(reset.resetAt) < requestTime) return null;
  return { status: 200, body: { ...reset, requestId } };
}

/** A 2xx requires the idempotency row and the canonical monotonic boundary.
 * Timeouts/ambiguous RPC results are reconciled by read-back; otherwise the
 * client retries with the *same* request ID, never assuming no write. */
export async function executeStatisticsReset(value: unknown, gateway: StatisticsResetGateway, userId: string): Promise<StatisticsApiResult> {
  const body = parseStatisticsResetRequest(value);
  if (!body) return { status: 400, body: { code: "STRONG_CONFIRMATION_REQUIRED", error: "Escribe ELIMINAR y envía una solicitud válida para confirmar." } };
  let prior: StatisticsQuery<{ reset_at: string }>;
  let state: StatisticsQuery<{ reset_at: string; strategy: string }>;
  try { [prior, state] = await Promise.all([gateway.request(userId, body.requestId), gateway.canonical(userId)]); }
  catch { return unavailable(null, false); }
  if (prior.error) return unavailable(prior.error, false);
  if (state.error) return unavailable(state.error, false);
  if (prior.data) {
    const completed = confirmed(prior.data, state.data, body.requestId);
    return completed || { status: 503, body: { code: "RESET_CONFIRMATION_PENDING", error: "La solicitud existe, pero el límite de estadísticas aún no pudo confirmarse." } };
  }

  let rpc: StatisticsQuery<unknown> | null = null;
  try { rpc = await gateway.execute(body.confirmation, body.requestId); }
  catch { /* An aborted response can follow a committed transaction. */ }
  let request: StatisticsQuery<{ reset_at: string }>;
  let canonical: StatisticsQuery<{ reset_at: string; strategy: string }>;
  try { [request, canonical] = await Promise.all([gateway.request(userId, body.requestId), gateway.canonical(userId)]); }
  catch { return unavailable(null, true); }
  if (request.error || canonical.error) return unavailable(request.error || canonical.error, true);
  const completed = confirmed(request.data, canonical.data, body.requestId);
  if (completed) return completed;
  if (rpc?.error) return unavailable(rpc.error, true);
  return { status: 503, body: { code: "RESET_CONFIRMATION_PENDING", error: "El servidor no confirmó todavía el reset. Reintenta con la misma solicitud; tu histórico permanece intacto." } };
}
