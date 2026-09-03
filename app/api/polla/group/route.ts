import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

async function accessFor(request: NextRequest) {
  const admin = getSupabaseAdmin("polla");
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!admin || !token) return { admin, access: null };
  const { data } = await admin.rpc("resolve_polla_access", { p_token: token });
  return { admin, access: data?.[0] || null };
}

export async function GET(request: NextRequest) {
  const { admin, access } = await accessFor(request);
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  if (!access?.group_id) return NextResponse.json({ error: "Acceso inválido." }, { status: 403 });
  const [groupResult, membersResult, scoresResult] = await Promise.all([
    admin.from("tournament_groups").select("id,name,start_hole,status,last_score_at,tournaments(name,holes,course_snapshot,oyes_holes)").eq("id", access.group_id).single(),
    admin.from("group_members").select("is_scorer,tournament_players(id,name,handicap)").eq("group_id", access.group_id),
    admin.from("tournament_scores").select("player_id,hole,score,updated_at").eq("tournament_id", access.tournament_id).eq("group_id", access.group_id),
  ]);
  const firstError = [groupResult, membersResult, scoresResult].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: "No fue posible cargar la tarjeta del grupo." }, { status: 400 });
  const { data: group } = groupResult;
  const { data: members } = membersResult;
  const { data: scores } = scoresResult;
  return NextResponse.json({ group, members, scores });
}

export async function POST(request: NextRequest) {
  const { admin, access } = await accessFor(request);
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  if (!access?.group_id || (access.role !== "scorer" && access.role !== "admin")) return NextResponse.json({ error: "Acceso inválido." }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "confirm") return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  const { error } = await admin.from("tournament_groups").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", access.group_id).eq("status", "open");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ confirmed: true });
}
