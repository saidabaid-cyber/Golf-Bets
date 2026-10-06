import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoundSnapshot } from "./types";

export type PendingRoundRecovery = { id: string; version: number; snapshot: RoundSnapshot };
export const PENDING_ROUND_PAGE_SIZE = 20;

/** Explicit owner recovery; never add live cards to the sync/history bundle. */
export async function readPendingOwnerRounds(client: SupabaseClient, userId: string, offset = 0) {
  if (!userId || !Number.isInteger(offset) || offset < 0 || offset > 10_000)
    throw new Error("Página de rondas inválida.");
  const result = await client.from("rounds_cloud").select("id,version,snapshot")
    .eq("owner_id", userId).eq("snapshot->>lifecycleState", "live")
    .not("local_id", "is", null).order("updated_at", { ascending: false }).order("id")
    .range(offset, offset + PENDING_ROUND_PAGE_SIZE - 1);
  if (result.error) throw result.error;
  const rows: PendingRoundRecovery[] = (result.data || []).flatMap(row => {
    const snapshot = row.snapshot as RoundSnapshot;
    if (!snapshot?.id || snapshot.cloudReadOnly || snapshot.lifecycleState !== "live"
      || snapshot.scorekeeping?.version !== 1 || snapshot.scorekeeping.mode !== "owner"
      || snapshot.scorekeeping.organizerAccountUserId !== userId
      || !snapshot.players?.some(player => player.id === snapshot.ownerId && player.accountUserId === userId)
      || !Number.isInteger(Number(row.version)) || Number(row.version) < 1) return [];
    const order = snapshot.order || [];
    const players = snapshot.players || [];
    const missing = order.findIndex(hole => players.some(player => typeof snapshot.scores?.[hole]?.[player.id] !== "number"));
    return [{ id: row.id, version: Number(row.version), snapshot: { ...snapshot,
      resumeHoleIndex: snapshot.resumeHoleIndex ?? (missing < 0 ? Math.max(0, order.length - 1) : missing) } }];
  });
  return { rows, nextOffset: (result.data || []).length === PENDING_ROUND_PAGE_SIZE ? offset + PENDING_ROUND_PAGE_SIZE : null };
}
