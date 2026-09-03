import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseForUser } from "../../../../../lib/supabase/server";
import { hasPollaScoreConflict } from "../../../../../lib/polla-live";

function bearer(request: NextRequest) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

async function authorize(request: NextRequest, tournamentId: string) {
  const token = bearer(request);
  const userClient = token ? getSupabaseForUser(token, "polla") : null;
  const admin = getSupabaseAdmin("polla");
  if (!userClient || !admin) return { error: "Polla Live requiere configuración de nube.", status: 503 } as const;
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData.user) return { error: "Sesión inválida.", status: 401 } as const;
  const { data: tournament } = await admin.from("tournaments").select("id,created_by,public_id,short_code,name,course_name,status,format,holes,start_hole,course_snapshot,oyes_holes").eq("id", tournamentId).single();
  if (!tournament) return { error: "Polla no encontrada.", status: 404 } as const;
  const { data: delegated } = tournament.created_by === authData.user.id ? { data: null } : await admin.from("tournament_access").select("id,expires_at").eq("tournament_id", tournamentId).eq("user_id", authData.user.id).eq("role", "admin").is("revoked_at", null).maybeSingle();
  const delegatedActive = Boolean(delegated && (!delegated.expires_at || Date.parse(delegated.expires_at) > Date.now()));
  if (tournament.created_by !== authData.user.id && !delegatedActive) return { error: "No tienes permiso de administrador.", status: 403 } as const;
  return { admin, user: authData.user, tournament, isOwner: tournament.created_by === authData.user.id } as const;
}

export async function GET(request: NextRequest, context: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await context.params;
  const access = await authorize(request, tournamentId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { admin, tournament, isOwner } = access;
  const groups = await admin.from("tournament_groups").select("id,name,start_hole,status,confirmed_at,last_score_at").eq("tournament_id", tournamentId).order("name");
  if (groups.error) return NextResponse.json({ error: groups.error.message }, { status: 400 });
  const groupIds = (groups.data || []).map((group) => group.id);
  const [members, scores, audit, administrators] = await Promise.all([
    groupIds.length ? admin.from("group_members").select("group_id,is_scorer,tournament_players(id,name,handicap)").in("group_id", groupIds) : Promise.resolve({ data: [], error: null }),
    admin.from("tournament_scores").select("group_id,player_id,hole,score,updated_at").eq("tournament_id", tournamentId),
    admin.from("score_audit_log").select("id,group_id,player_id,hole,old_score,new_score,changed_by,reason,changed_at").eq("tournament_id", tournamentId).order("changed_at", { ascending: false }).limit(200),
    admin.from("tournament_access").select("id,user_id,role,revoked_at,created_at").eq("tournament_id", tournamentId).not("user_id", "is", null),
  ]);
  const firstError = [members, scores, audit, administrators].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });
  return NextResponse.json({ tournament, isOwner, groups: groups.data || [], members: members.data || [], scores: scores.data || [], audit: audit.data || [], administrators: administrators.data || [] }, { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await context.params;
  const access = await authorize(request, tournamentId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { admin, user, isOwner } = access;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  if (action === "tournamentStatus") {
    const status = body?.status;
    if (status !== "upcoming" && status !== "live" && status !== "finished") return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
    const { error } = await admin.from("tournaments").update({ status, updated_at: new Date().toISOString() }).eq("id", tournamentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else if (action === "groupStatus") {
    const status = body?.status;
    if (typeof body?.groupId !== "string" || (status !== "open" && status !== "confirmed")) return NextResponse.json({ error: "Grupo/estado inválido." }, { status: 400 });
    const { error } = await admin.from("tournament_groups").update({ status, confirmed_at: status === "confirmed" ? new Date().toISOString() : null, confirmed_by: status === "confirmed" ? user.id : null }).eq("id", body.groupId).eq("tournament_id", tournamentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else if (action === "score") {
    const hole = Number(body?.hole); const score = Number(body?.score);
    if (typeof body?.groupId !== "string" || typeof body?.playerId !== "string" || !Number.isInteger(hole) || hole < 1 || hole > 18 || !Number.isInteger(score) || score < 1 || score > 20) return NextResponse.json({ error: "Score inválido." }, { status: 400 });
    const [{ data: group }, { data: member }, { data: current }] = await Promise.all([
      admin.from("tournament_groups").select("id").eq("id", body.groupId).eq("tournament_id", tournamentId).maybeSingle(),
      admin.from("group_members").select("group_id").eq("group_id", body.groupId).eq("tournament_player_id", body.playerId).maybeSingle(),
      admin.from("tournament_scores").select("updated_at").eq("tournament_id", tournamentId).eq("player_id", body.playerId).eq("hole", hole).maybeSingle(),
    ]);
    if (!group || !member) return NextResponse.json({ error: "Jugador/grupo inválido." }, { status: 403 });
    if (hasPollaScoreConflict(typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : undefined, current?.updated_at)) return NextResponse.json({ error: "El score cambió en otro dispositivo.", current }, { status: 409 });
    const { data: saved, error } = await admin.from("tournament_scores").upsert({ tournament_id: tournamentId, group_id: body.groupId, player_id: body.playerId, hole, score, entered_by: user.id }, { onConflict: "tournament_id,player_id,hole" }).select("player_id,hole,score,updated_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (typeof body.reason === "string" && body.reason.trim()) {
      const { data: audit } = await admin.from("score_audit_log").select("id").eq("tournament_id", tournamentId).eq("player_id", body.playerId).eq("hole", hole).order("changed_at", { ascending: false }).limit(1).maybeSingle();
      if (audit) await admin.from("score_audit_log").update({ reason: body.reason.trim().slice(0, 500) }).eq("id", audit.id);
    }
    return NextResponse.json({ score: saved });
  } else if (action === "setScorer") {
    if (typeof body?.groupId !== "string" || typeof body?.playerId !== "string") return NextResponse.json({ error: "Scorer inválido." }, { status: 400 });
    const { data: member } = await admin.from("group_members").select("group_id").eq("group_id", body.groupId).eq("tournament_player_id", body.playerId).maybeSingle();
    if (!member) return NextResponse.json({ error: "El scorer no pertenece al grupo." }, { status: 403 });
    const { error: revokeError } = await admin.from("tournament_access").update({ revoked_at: new Date().toISOString() }).eq("tournament_id", tournamentId).eq("group_id", body.groupId).eq("role", "scorer").is("revoked_at", null);
    if (revokeError) return NextResponse.json({ error: "No fue posible cerrar las sesiones anteriores del scorer." }, { status: 500 });
    const { error: clearError } = await admin.from("group_members").update({ is_scorer: false }).eq("group_id", body.groupId);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 400 });
    const { error } = await admin.from("group_members").update({ is_scorer: true }).eq("group_id", body.groupId).eq("tournament_player_id", body.playerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else if (action === "regeneratePin") {
    if (typeof body?.playerId !== "string") return NextResponse.json({ error: "Jugador inválido." }, { status: 400 });
    const { data: player } = await admin.from("tournament_players").select("id").eq("id", body.playerId).eq("tournament_id", tournamentId).maybeSingle();
    if (!player) return NextResponse.json({ error: "Jugador inválido." }, { status: 404 });
    const pin = String(randomInt(1000, 10000));
    const { error: revokeError } = await admin.from("tournament_access").update({ revoked_at: new Date().toISOString() }).eq("tournament_id", tournamentId).eq("tournament_player_id", body.playerId).is("revoked_at", null);
    if (revokeError) return NextResponse.json({ error: "No fue posible cerrar las sesiones asociadas al PIN anterior." }, { status: 500 });
    const { error } = await admin.rpc("set_tournament_player_pin", { p_player_id: body.playerId, p_pin: pin });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ pin });
  } else if (action === "grantAdmin" || action === "revokeAdmin") {
    if (!isOwner || typeof body?.userId !== "string") return NextResponse.json({ error: "Solo el propietario administra accesos." }, { status: 403 });
    if (body.userId === access.tournament.created_by) return NextResponse.json({ error: "El propietario ya tiene control total." }, { status: 400 });
    if (action === "grantAdmin") {
      const { data: existing } = await admin.from("tournament_access").select("id,revoked_at").eq("tournament_id", tournamentId).eq("user_id", body.userId).eq("role", "admin").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { error } = existing
        ? await admin.from("tournament_access").update({ revoked_at: null }).eq("id", existing.id)
        : await admin.from("tournament_access").insert({ tournament_id: tournamentId, user_id: body.userId, role: "admin" });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    } else {
      const { error } = await admin.from("tournament_access").update({ revoked_at: new Date().toISOString() }).eq("tournament_id", tournamentId).eq("user_id", body.userId).eq("role", "admin");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
  } else return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
