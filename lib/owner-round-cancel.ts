import type { RoundSnapshot } from "./types";

/** Compare partial cards too: cancellation does not require eighteen scores.
 * Pause/sync timestamps are not changes to the preserved card. */
function cancellationMaterial(round: RoundSnapshot) {
  const value = JSON.parse(JSON.stringify({ ...round, pausedAt: undefined, updatedAt: undefined }));
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(",")}]`;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(item);
  };
  return stable(value);
}

/** Soft-close only the organizer's canonical card. A fresh read cannot replace
 * the revision acknowledged by this device, and finished history is immutable. */
export async function cancelOwnerRound(round: RoundSnapshot, userId: string, accessToken: string,
  storage: Pick<Storage, "getItem" | "setItem">, request: typeof fetch = fetch) {
  if (round.cloudReadOnly || round.id.startsWith("shared:") || round.lifecycleState !== "cancelled"
    || round.scorekeeping?.version !== 1 || round.scorekeeping.mode !== "owner"
    || round.scorekeeping.organizerAccountUserId !== userId)
    throw new Error("Esta ronda no puede cancelarse desde esta cuenta.");
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const response = await request(`/api/cloud/rounds?localRoundId=${encodeURIComponent(round.id)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const existing = await response.json();
  if (!response.ok) throw new Error(existing.error || "No pudimos comprobar la ronda canónica.");
  const key = `backyard-owner-round-revision:${userId}:${round.id}`;
  if (existing.data?.snapshot?.lifecycleState === "cancelled") {
    if (cancellationMaterial(round) !== cancellationMaterial(existing.data.snapshot))
      throw new Error("La ronda de nube ya fue cancelada con otra tarjeta. Tu copia local se conserva.");
    return { roundId: existing.data.id, alreadyCancelled: true };
  }
  if (existing.data && existing.data.snapshot?.lifecycleState !== "live")
    throw new Error("La ronda de nube ya está cerrada. Su histórico no se modificó.");
  const remembered = Number(storage.getItem(key));
  if (existing.data && remembered !== Number(existing.data.version))
    throw new Error("La revisión de nube cambió. Conservamos tu ronda activa; revisa antes de cancelarla.");
  const saved = await request("/api/cloud/rounds", { method: existing.data ? "PUT" : "POST", headers,
    body: JSON.stringify({ round, ...(existing.data ? { expectedVersion: remembered } : {}) }), signal: AbortSignal.timeout(15_000) });
  const result = await saved.json();
  if (result.version) storage.setItem(key, String(result.version));
  if (!saved.ok) throw new Error(result.error || "Cancelación de nube pendiente; tu ronda activa se conserva.");
  return result as { roundId: string; version?: number; alreadyCancelled?: boolean };
}
