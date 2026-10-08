import type { Player, RoundSnapshot } from "./types";

/** Consult a missing saved card through existing authenticated reads. This must
 * never merge cloud data into the local workspace or resolve a sync conflict. */
export async function readMissingHistoricalRound(
  roundId: string, accountUserId: string, accessToken: string,
  signal?: AbortSignal, request: typeof fetch = fetch,
): Promise<RoundSnapshot | null> {
  if (!roundId || roundId.length > 200 || !accountUserId || !accessToken) return null;
  const shared = roundId.startsWith("shared:");
  if (shared && !/^shared:[a-f0-9-]{36}$/i.test(roundId)) return null;
  const response = await request(shared ? "/api/cloud/rounds" : `/api/cloud/rounds?localRoundId=${encodeURIComponent(roundId)}`, {
    method: "GET", headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal,
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Inicia sesión de nuevo para consultar esta tarjeta." : "No pudimos consultar esta tarjeta. Intenta de nuevo.");
  const result = await response.json().catch(() => { throw new Error("No pudimos consultar esta tarjeta. Intenta de nuevo."); });
  const row = result?.data;
  const snapshot = shared ? (Array.isArray(result?.rounds) ? result.rounds.find((value: RoundSnapshot) => value?.id === roundId) : null) : row?.snapshot;
  if (!snapshot || snapshot.id !== roundId || !["completed", "cancelled"].includes(snapshot.lifecycleState)
    || !Array.isArray(snapshot.players) || snapshot.players.filter((player: Player) => player?.accountUserId === accountUserId).length !== 1) return null;
  // Owner-scoped GET authorizes an owned card. Shared cards must additionally
  // carry the server's independently confirmed participant projection.
  if (shared && (!snapshot.cloudReadOnly || snapshot.cloudParticipant?.accountUserId !== accountUserId
    || snapshot.cloudRoundId !== roundId.slice(7))) return null;
  if (!shared && (typeof row.id !== "string" || !Number.isInteger(row.version) || row.version < 1)) return null;
  return { ...snapshot, cloudReadOnly: true, cloudRoundId: shared ? snapshot.cloudRoundId : row.id,
    cloudSourceLocalId: shared ? snapshot.cloudSourceLocalId : roundId };
}
