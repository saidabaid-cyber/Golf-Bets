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
  for (const candidate of [round.completedAt, round.updatedAt, round.startedAt, round.date]) {
    const parsed = Date.parse(typeof candidate === "string" ? candidate : "");
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

/** Strategy B: historical rounds remain intact, while only rounds completed
 * after the authenticated reset can feed derived performance analytics. */
export function roundsEligibleForStatistics(rounds: readonly RoundSnapshot[], resetAt: string | null | undefined) {
  const boundary = Date.parse(resetAt || "");
  if (!Number.isFinite(boundary)) return [...rounds];
  return rounds.filter((round) => roundStatisticsInstant(round) > boundary);
}

export async function requestStatisticsReset(accessToken: string | null, confirmation: string, fetcher: typeof fetch = fetch) {
  if (!accessToken) throw new Error("Inicia sesión para eliminar tus estadísticas.");
  if (!isStatisticsDeleteConfirmation(confirmation)) throw new Error("Escribe ELIMINAR para confirmar.");
  const response = await fetcher("/api/account/statistics", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ confirmation }),
  });
  const body = await response.json().catch(() => null) as { resetAt?: string; strategy?: string; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || "No se eliminaron las estadísticas. Reintenta.");
  const reset = parseStatisticsReset(body);
  if (!reset) throw new Error("El servidor no confirmó el reset de estadísticas.");
  return reset;
}

export async function fetchStatisticsReset(accessToken: string | null, fetcher: typeof fetch = fetch) {
  if (!accessToken) return null;
  const response = await fetcher("/api/account/statistics", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) return null;
  return parseStatisticsReset(await response.json().catch(() => null));
}
