import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoundSnapshot } from "./types";
import { getSupabaseAdmin } from "./supabase/server";
import { linkedRoundPlayers, participantCard } from "./shared-round-participants";
import { roundMaterialFingerprint } from "./round-achievements";
import { SocialServiceError, type SocialContext } from "./social-activity.server";

function eventId(roundId: string, userId: string, type: string) {
  const hash = createHash("sha256").update(JSON.stringify(["shared-round-v1", roundId, userId, type])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Server-authenticated author and canonical revision, not a client label. */
export async function auditOwnerScores(client: SupabaseClient, ownerId: string, row: { id: string; version: number; snapshot: RoundSnapshot }) {
  const previous = await client.from("live_round_operations_v2").select("player_key,hole,payload,resulting_version")
    .eq("round_id", row.id).eq("operation_kind", "SCORE_SET").order("resulting_version", { ascending: false }).limit(500);
  if (previous.error) throw previous.error;
  const latest = new Map<string, number | null>();
  for (const item of previous.data || []) {
    const cell = `${item.player_key}:${item.hole}`;
    if (!latest.has(cell)) latest.set(cell, item.payload?.score == null ? null : Number(item.payload.score));
  }
  const operations = [];
  for (const [cell, previousScore] of latest) {
    const colon = cell.lastIndexOf(":");
    const playerKey = cell.slice(0, colon), hole = Number(cell.slice(colon + 1));
    if (previousScore === null || row.snapshot.scores?.[hole]?.[playerKey] != null
      || !row.snapshot.players?.some(player => player.id === playerKey)) continue;
    operations.push({ id: eventId(row.id, ownerId, `score:${row.version}:${playerKey}:${hole}`), round_id: row.id,
      actor_id: ownerId, operation_kind: "SCORE_SET", player_key: playerKey, hole, payload: { score: null, source: "CANONICAL_OWNER_SAVE" },
      base_version: Math.max(0, Number(row.version) - 1), resulting_version: Number(row.version) });
  }
  for (const [holeText, scores] of Object.entries(row.snapshot.scores || {})) {
    const hole = Number(holeText);
    if (!Number.isInteger(hole) || hole < 1 || hole > 18) continue;
    for (const [playerKey, score] of Object.entries(scores || {})) {
      if (!row.snapshot.players?.some(player => player.id === playerKey) || typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 20) continue;
      if (latest.get(`${playerKey}:${hole}`) === score) continue;
      operations.push({ id: eventId(row.id, ownerId, `score:${row.version}:${playerKey}:${hole}`), round_id: row.id,
        actor_id: ownerId, operation_kind: "SCORE_SET", player_key: playerKey, hole, payload: { score, source: "CANONICAL_OWNER_SAVE" },
        base_version: Math.max(0, Number(row.version) - 1), resulting_version: Number(row.version) });
    }
  }
  if (operations.length) {
    const saved = await client.from("live_round_operations_v2").upsert(operations, { onConflict: "id", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
  }
}

/** Only project an owner-authenticated canonical row. This grants card access,
 * never SELF_CONFIRMED attribution or score-writing permission to another user. */
export async function syncSharedRoundParticipants(client: SupabaseClient, ownerId: string, localIds: string[]) {
  const delivery = { notifications: "DELIVERED" as "DELIVERED" | "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS" };
  if (!localIds.length) return delivery;
  const admin = getSupabaseAdmin("cloud");
  if (!admin) throw new Error("SHARED_ROUND_UNAVAILABLE");
  const result = await client.from("rounds_cloud").select("id,owner_id,snapshot,version").eq("owner_id", ownerId).in("local_id", [...new Set(localIds)]);
  if (result.error) throw result.error;
  for (const row of result.data || []) {
    const snapshot = row.snapshot as RoundSnapshot;
    // Legacy history is not enrolled or notified merely by synchronizing it.
    if (snapshot.scorekeeping?.version !== 1) continue;
    if (!["live", "completed"].includes(snapshot.lifecycleState || "")) continue;
    const linked = linkedRoundPlayers(snapshot);
    await auditOwnerScores(client, ownerId, { id: row.id, version: Number(row.version), snapshot });
    // VIEWER is deliberately read-only until a real participant write transport
    // is available. The owner retains the existing owner scorekeeper permission.
    const participants = linked.map(player => ({ round_id: row.id, user_id: player.accountUserId,
      player_key: player.id, role: player.accountUserId === ownerId ? "ORGANIZER" : "VIEWER" }));
    const existing = await client.from("round_participants_v2").select("id,user_id").eq("round_id", row.id);
    if (existing.error) throw existing.error;
    // The existing uniqueness constraint is a partial index: PostgREST's
    // column-only ON CONFLICT cannot target it. Insert missing rows and tolerate
    // a concurrent retry winning that same unique identity.
    for (const participant of participants) {
      const previous = (existing.data || []).find(item => item.user_id === participant.user_id);
      const saved = previous
        ? await client.from("round_participants_v2").update({ player_key: participant.player_key }).eq("id", previous.id)
        : await client.from("round_participants_v2").insert(participant);
      if (saved.error && saved.error.code !== "23505") throw saved.error;
    }
    const stale = (existing.data || []).filter(item => item.user_id && !linked.some(player => player.accountUserId === item.user_id));
    if (stale.length) {
      const removed = await client.from("round_participants_v2").delete().eq("round_id", row.id).in("id", stale.map(item => item.id));
      if (removed.error) throw removed.error;
    }
    const type = snapshot.lifecycleState === "completed" ? "scorecard_ready" : "round_started";
    const recipients = linked.filter(player => player.accountUserId !== ownerId);
    const preferences = recipients.length ? await admin.from("notification_preferences_v2").select("user_id,in_app")
      .eq("event_type", type).in("user_id", recipients.map(player => player.accountUserId!)) : { data: [], error: null };
    if (preferences.error?.code === "42501") {
      // DEV deliberately withholds these privileges from service_role. Do not
      // bypass recipient preferences or fail an already saved canonical card.
      delivery.notifications = "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS";
      continue;
    }
    if (preferences.error) throw preferences.error;
    const notifications = recipients.filter(player => !(preferences.data || []).some(preference => preference.user_id === player.accountUserId && preference.in_app === false)).map(player => ({
      id: eventId(row.id, player.accountUserId!, type), recipient_id: player.accountUserId,
      event_type: type, resource_type: type === "scorecard_ready" ? "SCORECARD" : "ROUND", resource_id: row.id,
    }));
    if (notifications.length) {
      // A retry does not duplicate the notification or reset its read marker.
      const notified = await admin.from("notification_events_v2").upsert(notifications, { onConflict: "recipient_id,id", ignoreDuplicates: true });
      if (notified.error?.code === "42501") delivery.notifications = "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS";
      else if (notified.error) throw notified.error;
    }
  }
  return delivery;
}

export async function readSharedRoundCard(ctx: SocialContext, identifier: string, local = false) {
  let query = ctx.client.from("rounds_cloud").select("id,owner_id,snapshot,version");
  query = local ? query.eq("owner_id", ctx.userId).eq("local_id", identifier) : query.eq("id", identifier);
  const { data: row, error } = await query.maybeSingle();
  if (error) throw error;
  if (!row) throw new SocialServiceError("NOT_FOUND", 404, "Tarjeta no disponible.");
  const snapshot = row.snapshot as RoundSnapshot;
  if (ctx.userId !== row.owner_id && !snapshot.players?.some(player => player.accountUserId === ctx.userId))
    throw new SocialServiceError("PARTICIPANT_NOT_LINKED", 403, "No participaste en esta ronda.");
  // RLS card access and the canonical player match above authorize only this
  // roster's status projection. The links table itself remains self-readable.
  const links = await ctx.admin.from("social_round_account_links_v3").select("user_id,player_key,verified_by").eq("round_id", row.id);
  if (links.error) throw links.error;
  const confirmed = new Set((links.data || []).filter(link => link.verified_by === "SELF_CONFIRMED"
    && snapshot.players?.some(player => player.id === link.player_key && player.accountUserId === link.user_id)).map(link => String(link.user_id)));
  const hash = await roundMaterialFingerprint(snapshot, row.owner_id);
  return { data: participantCard(row.id, row.owner_id, Number(row.version), hash || "", snapshot, ctx.userId, confirmed) };
}
