import { roundMaterialPayload } from "./round-achievements";
import type { RoundSnapshot } from "./types";

/** Close this canonical card independently of unrelated history sync conflicts.
 * The remembered revision is mandatory: a fresh GET never authorizes overwriting
 * another device's capture. Completed cards are only checked, never rewritten. */
export async function finalizeOwnerRound(round: RoundSnapshot, userId: string, accessToken: string,
  storage: Pick<Storage, "getItem" | "setItem">, request: typeof fetch = fetch) {
  if (round.cloudReadOnly || round.id.startsWith("shared:") || round.lifecycleState !== "completed"
    || !round.completedAt || round.scorekeeping?.version !== 1 || round.scorekeeping.mode !== "owner")
    throw new Error("La tarjeta no puede cerrarse desde este dispositivo.");
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const response = await request(`/api/cloud/rounds?localRoundId=${encodeURIComponent(round.id)}`, { headers, cache: "no-store" });
  const existing = await response.json();
  if (!response.ok) throw new Error(existing.error || "No pudimos comprobar la ronda canónica.");
  const key = `backyard-owner-round-revision:${userId}:${round.id}`;
  if (existing.data?.snapshot?.lifecycleState === "completed") {
    const localMaterial = roundMaterialPayload(round, userId);
    if (!localMaterial || localMaterial !== roundMaterialPayload(existing.data.snapshot, userId))
      throw new Error("La tarjeta de nube ya está cerrada. Revisa sus resultados; tu copia local se conserva.");
    return { roundId: existing.data.id, alreadyCompleted: true, delivery: undefined };
  }
  const remembered = Number(storage.getItem(key));
  if (existing.data && remembered !== Number(existing.data.version))
    throw new Error("La revisión de nube cambió. Conservamos tu tarjeta local; revisa la nube antes de cerrarla.");
  const saved = await request("/api/cloud/rounds", { method: existing.data ? "PUT" : "POST", headers,
    body: JSON.stringify({ round, ...(existing.data ? { expectedVersion: remembered } : {}) }) });
  const result = await saved.json();
  if (result.version) storage.setItem(key, String(result.version));
  if (!saved.ok) throw new Error(result.error || "Cierre de nube pendiente; tu tarjeta local se conserva.");
  return result as { roundId: string; version?: number; alreadyCompleted?: boolean; delivery?: { notifications?: string } };
}
