import { STORAGE_KEYS, readStoredJson } from "./round-utils";

export const ROUND_REVIEW_NOTICE = "Ronda terminada. Aún no está guardada en Histórico. Revisa los resultados y, cuando estén correctos, pulsa ‘Guardar en Histórico’ al final de esa pantalla.";

export function persistPendingRoundReview(
  storage: Pick<Storage, "getItem" | "setItem">,
  draft: Record<string, unknown>,
) {
  const pending: Record<string, unknown> = { ...draft, reviewPending: true };
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(pending));
  const verified = readStoredJson<Record<string, unknown> | null>(storage as Storage, STORAGE_KEYS.draft, null);
  if (!verified || verified.roundId !== pending.roundId || verified.reviewPending !== true) {
    throw new Error("No se pudo comprobar la ronda pendiente de revisión.");
  }
  return pending;
}
