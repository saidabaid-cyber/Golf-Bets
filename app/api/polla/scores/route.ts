import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Acceso requerido." }, { status: 401 });
  const { data: accessRows, error: accessError } = await admin.rpc("resolve_polla_access", { p_token: token });
  const access = accessRows?.[0];
  if (accessError || !access || (access.role !== "admin" && access.role !== "scorer")) return NextResponse.json({ error: "Acceso inválido." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const hole = Number(body?.hole);
  const score = Number(body?.score);
  if (!body?.playerId || !body.groupId || hole < 1 || hole > 18 || score < 1 || score > 20) return NextResponse.json({ error: "Score inválido." }, { status: 400 });
  if (access.role === "scorer" && access.group_id !== body.groupId) return NextResponse.json({ error: "Solo puedes editar tu grupo." }, { status: 403 });

  const { data: group } = await admin.from("tournament_groups").select("status").eq("id", body.groupId).eq("tournament_id", access.tournament_id).single();
  if (!group || (group.status === "confirmed" && access.role !== "admin")) return NextResponse.json({ error: "La tarjeta está cerrada." }, { status: 423 });
  const { data: current } = await admin.from("tournament_scores").select("score,updated_at").eq("tournament_id", access.tournament_id).eq("player_id", body.playerId).eq("hole", hole).maybeSingle();
  if (body.baseUpdatedAt && current?.updated_at && body.baseUpdatedAt !== current.updated_at) return NextResponse.json({ error: "El score cambió en otro dispositivo.", current }, { status: 409 });

  const { data, error } = await admin.from("tournament_scores").upsert({
    tournament_id: access.tournament_id,
    group_id: body.groupId,
    player_id: body.playerId,
    hole,
    score,
    access_id: access.access_id,
  }, { onConflict: "tournament_id,player_id,hole" }).select("player_id,hole,score,updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (access.role === "admin" && typeof body.reason === "string" && body.reason.trim()) {
    const { data: audit } = await admin.from("score_audit_log").select("id").eq("tournament_id", access.tournament_id).eq("player_id", body.playerId).eq("hole", hole).order("changed_at", { ascending: false }).limit(1).maybeSingle();
    if (audit) await admin.from("score_audit_log").update({ reason: body.reason.trim().slice(0, 500) }).eq("id", audit.id);
  }
  return NextResponse.json({ score: data });
}
