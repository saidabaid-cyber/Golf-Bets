import type { RoundSnapshot } from "./types";
import { ownerRoundCaptureMaterial, ownerRoundExclusive } from "./owner-round-sync";

/** Compare partial cards too: cancellation does not require eighteen scores.
 * Pause/sync timestamps are not changes to the preserved card. */
export function cancellationMaterial(round: RoundSnapshot) {
  return ownerRoundCaptureMaterial({ ...round, lifecycleState: "live" });
}

export class OwnerRoundCancellationConflict extends Error {
  constructor(public readonly snapshot: RoundSnapshot, public readonly version: number) {
    super("La tarjeta de nube cambió. Revisa la versión vigente antes de confirmar la cancelación; tu copia local se conserva.");
    this.name = "OwnerRoundCancellationConflict";
  }
}

/** Soft-close only the organizer's canonical card. A newer revision requires
 * equal capture inputs or explicit review; finished history is immutable. */
export async function cancelOwnerRound(round: RoundSnapshot, userId: string, accessToken: string,
  storage: Pick<Storage, "getItem" | "setItem">, request: typeof fetch = fetch) {
  if (round.cloudReadOnly || round.id.startsWith("shared:") || round.lifecycleState !== "cancelled"
    || round.scorekeeping?.version !== 1 || round.scorekeeping.mode !== "owner"
    || round.scorekeeping.organizerAccountUserId !== userId)
    throw new Error("Esta ronda no puede cancelarse desde esta cuenta.");
  const key = `backyard-owner-round-revision:${userId}:${round.id}`;
  return ownerRoundExclusive(key, async () => {
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const response = await request(`/api/cloud/rounds?localRoundId=${encodeURIComponent(round.id)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const existing = await response.json();
  if (!response.ok) throw new Error(existing.error || "No pudimos comprobar la ronda canónica.");
  if (existing.data?.snapshot?.lifecycleState === "cancelled") {
    if (cancellationMaterial(round) !== cancellationMaterial(existing.data.snapshot))
      throw new Error("La ronda de nube ya fue cancelada con otra tarjeta. Tu copia local se conserva.");
    const cleanup = await request("/api/cloud/rounds", { method: "PUT", headers,
      body: JSON.stringify({ round, expectedVersion: Number(existing.data.version) }), signal: AbortSignal.timeout(15_000) });
    const result = await cleanup.json();
    if (!cleanup.ok) throw new Error(result.error || "La tarjeta está cancelada; falta confirmar la limpieza del borrador.");
    storage.setItem(key, String(existing.data.version));
    return { roundId: existing.data.id, alreadyCancelled: true };
  }
  if (existing.data && existing.data.snapshot?.lifecycleState !== "live")
    throw new Error("La ronda de nube ya está cerrada. Su histórico no se modificó.");
  let remembered = Number(storage.getItem(key));
  if (existing.data && remembered !== Number(existing.data.version)) {
    const remote = existing.data.snapshot as RoundSnapshot;
    const version = Number(existing.data.version);
    if (remote?.id !== round.id || remote.cloudReadOnly || remote.scorekeeping?.version !== 1
      || remote.scorekeeping.mode !== "owner" || remote.scorekeeping.organizerAccountUserId !== userId
      || !Number.isInteger(version) || version < 1)
      throw new Error("La revisión de nube cambió. Conservamos tu ronda activa; no pudimos verificar su tarjeta vigente.");
    if (cancellationMaterial(remote) !== cancellationMaterial(round))
      throw new OwnerRoundCancellationConflict(structuredClone(remote), version);
    // Equality of every capture input, not the GET alone, proves the newer
    // revision is the same card (e.g. a parked history-sync acknowledgement).
    remembered = version;
    storage.setItem(key, String(version));
  }
  const saved = await request("/api/cloud/rounds", { method: existing.data ? "PUT" : "POST", headers,
    body: JSON.stringify({ round, ...(existing.data ? { expectedVersion: remembered } : {}) }), signal: AbortSignal.timeout(15_000) });
  const result = await saved.json();
  if (saved.status === 409) {
    // A race after the read still needs a NEW explicit review, never a retry
    // that silently substitutes a later revision.
    const reread = await request(`/api/cloud/rounds?localRoundId=${encodeURIComponent(round.id)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const latest = await reread.json();
    const remote = latest.data?.snapshot as RoundSnapshot | undefined;
    if (reread.ok && remote?.id === round.id && remote.lifecycleState === "live"
      && !remote.cloudReadOnly && remote.scorekeeping?.mode === "owner"
      && remote.scorekeeping.organizerAccountUserId === userId
      && Number.isInteger(Number(latest.data.version)) && Number(latest.data.version) > 0)
      throw new OwnerRoundCancellationConflict(structuredClone(remote), Number(latest.data.version));
  }
  if (!saved.ok) throw new Error(result.error || "Cancelación de nube pendiente; tu ronda activa se conserva.");
  if (result.version) storage.setItem(key, String(result.version));
  return result as { roundId: string; version?: number; alreadyCancelled?: boolean };
  });
}
