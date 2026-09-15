import type { RoundSnapshot } from "./types";

export const STATISTICS_DELETE_CONFIRMATION = "ELIMINAR";
export const STATISTICS_RESET_STRATEGY = "RESET_FROM_DATE" as const;

export type StatisticsResetRecord = {
  resetAt: string;
  strategy: typeof STATISTICS_RESET_STRATEGY;
};

export function statisticsResetStorageKey(userId: string) {
  return `backyard-statistics-reset-v1:${userId}`;
}

export function isStatisticsDeleteConfirmation(value: string) {
  return value === STATISTICS_DELETE_CONFIRMATION;
}

export function parseStatisticsReset(value: unknown): StatisticsResetRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.strategy !== STATISTICS_RESET_STRATEGY || typeof source.resetAt !== "string" || !Number.isFinite(Date.parse(source.resetAt))) return null;
  return { resetAt: source.resetAt, strategy: STATISTICS_RESET_STRATEGY };
}

export function readStatisticsReset(storage: Pick<Storage, "getItem">, userId: string) {
  if (!userId || userId === "guest") return null;
  try { return parseStatisticsReset(JSON.parse(storage.getItem(statisticsResetStorageKey(userId)) || "null")); }
  catch { return null; }
}

export function persistStatisticsReset(storage: Pick<Storage, "setItem">, userId: string, reset: StatisticsResetRecord) {
  if (!userId || userId === "guest") throw new Error("authenticated_user_required");
  storage.setItem(statisticsResetStorageKey(userId), JSON.stringify(reset));
  return reset;
}

function roundStatisticsInstant(round: RoundSnapshot) {
  // `updatedAt` is mutable. Editing an old historical round after a reset
  // must never make that round eligible for new derived analytics.
  for (const candidate of [round.completedAt, round.startedAt, round.date]) {
    const parsed = Date.parse(typeof candidate === "string" ? candidate : "");
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

/** A correction to a committed round updates its contents, not its original
 * sporting date. Legacy rounds with only `date` deliberately keep that date
 * instead of acquiring a new completion instant during an edit. */
export function preserveRoundStatisticsOrigin(snapshot: RoundSnapshot, priorRound?: RoundSnapshot | null): RoundSnapshot {
  if (!priorRound || priorRound.id !== snapshot.id) return snapshot;
  return {
    ...snapshot,
    date: priorRound.date,
    startedAt: priorRound.startedAt,
    completedAt: priorRound.completedAt,
  };
}

/** Strategy B: historical rounds remain intact, while only rounds completed
 * after the authenticated reset can feed derived performance analytics. */
export function roundsEligibleForStatistics(rounds: readonly RoundSnapshot[], resetAt: string | null | undefined) {
  const boundary = Date.parse(resetAt || "");
  if (!Number.isFinite(boundary)) return [...rounds];
  return rounds.filter((round) => roundStatisticsInstant(round) > boundary);
}

export async function requestStatisticsReset(accessToken: string | null, confirmation: string, fetcher: typeof fetch = fetch, requestId = crypto.randomUUID()) {
  if (!accessToken) throw new Error("Inicia sesión para eliminar tus estadísticas.");
  if (!isStatisticsDeleteConfirmation(confirmation)) throw new Error("Escribe ELIMINAR para confirmar.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("La solicitud de reset no es válida.");
  let response: Response;
  try {
    response = await fetcher("/api/account/statistics", {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ confirmation, requestId }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    // A timeout may occur after the server committed the transaction. The
    // caller must retry with this SAME requestId rather than creating a new one.
    throw new Error("No pude confirmar el reset. Reintenta la misma solicitud; tus datos no se marcarán como eliminados sin confirmación.");
  }
  const body = await response.json().catch(() => null) as { resetAt?: string; strategy?: string; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || "No se eliminaron las estadísticas. Reintenta.");
  const reset = parseStatisticsReset(body);
  if (!reset) throw new Error("El servidor no confirmó el reset de estadísticas.");
  return reset;
}

export type StatisticsResetStatus =
  | { state: "ready"; reset: StatisticsResetRecord | null }
  | { state: "unavailable"; code: string; error: string };

/** A missing ledger or bad network response is never interpreted as a user
 * having no reset. The UI may retain history but should hide sports analytics
 * until this authoritative lookup succeeds. */
export async function fetchStatisticsResetStatus(accessToken: string | null, fetcher: typeof fetch = fetch): Promise<StatisticsResetStatus> {
  if (!accessToken) return { state: "unavailable", code: "AUTH_REQUIRED", error: "Inicia sesión para consultar el estado de tus estadísticas." };
  let response: Response;
  try {
    response = await fetcher("/api/account/statistics", {
      headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { state: "unavailable", code: "STATISTICS_NETWORK_UNAVAILABLE", error: "No pude confirmar el estado de tus estadísticas. Reintenta cuando haya conexión." };
  }
  const body: unknown = await response.json().catch(() => null);
  const source = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!response.ok) return { state: "unavailable", code: typeof source?.code === "string" ? source.code : "STATISTICS_STORE_UNAVAILABLE",
    error: typeof source?.error === "string" ? source.error : "No pude confirmar el estado de tus estadísticas." };
  if (source?.resetAt === null && source.strategy === STATISTICS_RESET_STRATEGY) return { state: "ready", reset: null };
  const reset = parseStatisticsReset(source);
  return reset ? { state: "ready", reset } : { state: "unavailable", code: "INVALID_RESET_STATE", error: "El servidor no confirmó el estado de tus estadísticas." };
}

/** Compatibility shim. New analytics flows must use the discriminated status. */
export async function fetchStatisticsReset(accessToken: string | null, fetcher: typeof fetch = fetch) {
  const result = await fetchStatisticsResetStatus(accessToken, fetcher);
  if (result.state !== "ready") throw new Error(result.error);
  return result.reset;
}
