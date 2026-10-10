import "server-only";
import type { SocialContext } from "./social-activity.server";
import type { RoundSnapshot } from "./types";
import { SharedLiveError, patchSharedScores, sharedEditablePlayers, type SharedScorePatch } from "./shared-round-live";
import { finalizeSharedRound } from "./shared-round-finalize";
import { syncSharedRoundParticipants } from "./shared-round-participants.server";
import { scheduleSocialPublication } from "./social-publication.server";

export async function sharedLiveRow(ctx: SocialContext, roundId: string) {
  const result = await ctx.client.from("rounds_cloud").select("id,owner_id,version,snapshot").eq("id", roundId).maybeSingle();
  if (result.error) throw new SharedLiveError("READ_FAILED", 503, "No pudimos leer la ronda.");
  if (!result.data) throw new SharedLiveError("NOT_FOUND", 404, "Ronda no disponible.");
  const row = result.data as { id: string; owner_id: string; version: number; snapshot: RoundSnapshot };
  if (row.snapshot.scorekeeping?.version !== 1) throw new SharedLiveError("NOT_FOUND", 404, "Ronda no disponible.");
  if (row.owner_id !== ctx.userId && !row.snapshot.players?.some(p => p.accountUserId === ctx.userId))
    throw new SharedLiveError("FORBIDDEN", 403, "No perteneces a esta ronda.");
  return row;
}
export function liveRowResponse(row: Awaited<ReturnType<typeof sharedLiveRow>>, userId: string) {
  // Financial/private runtime outputs are unnecessary for live capture.
  const { ownerBagSnapshot: _bag, expenses: _expenses, resultDetails: _details, ...snapshot } = row.snapshot;
  void [_bag, _expenses, _details];
  return { id: row.id, version: Number(row.version), ownerId: row.owner_id, snapshot,
    editablePlayerKeys: sharedEditablePlayers(row.snapshot, row.owner_id, userId),
    joined: row.owner_id === userId || Boolean(row.snapshot.sharedLive?.joinedUserIds.includes(userId)) };
}
export async function saveSharedLive(ctx: SocialContext, roundId: string, body: { patches?: SharedScorePatch[]; action?: string; expectedVersion?: number }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await sharedLiveRow(ctx, roundId);
    let snapshot = row.snapshot;
    if (body.action) {
      if (body.action === "join") {
        if (snapshot.lifecycleState !== "live") throw new SharedLiveError("ROUND_CLOSED", 409, "La ronda está cerrada.");
        if (snapshot.sharedLive?.joinedUserIds.includes(ctx.userId)) return { data: liveRowResponse(row, ctx.userId) };
        snapshot = { ...snapshot, sharedLive: { cellVersions: {}, operationIds: [], audit: [], ...snapshot.sharedLive,
          joinedUserIds: [...new Set([...(snapshot.sharedLive?.joinedUserIds || []), ctx.userId])] } };
      } else if (body.action === "cancel" || body.action === "finish") {
        if (row.owner_id !== ctx.userId) throw new SharedLiveError("FORBIDDEN", 403, "Sólo el organizador puede cerrar.");
        if (snapshot.lifecycleState === (body.action === "cancel" ? "cancelled" : "completed")) return { data: liveRowResponse(row, ctx.userId) };
        if (row.version !== body.expectedVersion || snapshot.lifecycleState !== "live") throw new SharedLiveError("STALE_REVISION", 409, "Actualiza la tarjeta antes de cancelar.");
        snapshot = body.action === "finish" ? finalizeSharedRound(snapshot, new Date().toISOString()) : { ...snapshot, lifecycleState: "cancelled", updatedAt: new Date().toISOString() };
      } else throw new SharedLiveError("INVALID_REQUEST", 400, "Acción inválida.");
    } else {
      const result = patchSharedScores(row.id, row.owner_id, Number(row.version), snapshot, ctx.userId, body.patches!, new Date().toISOString());
      if (!result.applied) return { data: liveRowResponse(row, ctx.userId), duplicate: true };
      snapshot = result.snapshot;
    }
    // Authorization is against the canonical roster above. Service credentials
    // stay server-side; a client cannot send a replacement snapshot or actor ID.
    const result = await ctx.admin.rpc("shared_round_live_cas_v1", { p_round_id: row.id, p_expected_version: row.version,
      p_actor: ctx.userId, p_snapshot: snapshot });
    const saved = { error: result.error, data: result.data?.[0] as typeof row | undefined };
    if (saved.error) { console.error("shared_score_write_failed", { code: saved.error.code }); throw new SharedLiveError("WRITE_FAILED", 503, "Captura local conservada; sincronización pendiente."); }
    if (saved.data) {
      let delivery;
      if (body.action === "finish") {
        try { delivery = await syncSharedRoundParticipants(ctx.client, ctx.userId, [snapshot.id]); }
        catch { delivery = { notifications: "PENDING_DELIVERY" }; }
        scheduleSocialPublication(ctx.userId, "round");
      }
      return { data: liveRowResponse(saved.data, ctx.userId), ...(delivery ? { delivery } : {}) };
    }
    // Re-read and run cell-level conflict checks. Never retry a whole snapshot.
  }
  throw new SharedLiveError("STALE_REVISION", 409, "La ronda sigue cambiando. Tu captura se conserva.");
}
