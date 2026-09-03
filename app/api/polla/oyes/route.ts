import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { normalizeOyesDistance } from "../../../../lib/polla-live";

export async function POST(request: NextRequest) {
  const admin = getSupabaseAdmin("polla");
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: accessRows } = token ? await admin.rpc("resolve_polla_access", { p_token: token }) : { data: null };
  const access = accessRows?.[0];
  if (!access || (access.role !== "admin" && access.role !== "scorer")) return NextResponse.json({ error: "Acceso inválido." }, { status: 403 });
  const body = await request.json().catch(() => null) as { playerId?: string; hole?: number; value?: number; unit?: "m" | "cm" | "ft_in"; inches?: number } | null;
  const hole = Number(body?.hole);
  if (!body?.playerId || !Number.isInteger(hole) || hole < 1 || hole > 18 || !body.unit) return NextResponse.json({ error: "Oyes inválido." }, { status: 400 });
  let meters: number;
  try { meters = normalizeOyesDistance(Number(body.value), body.unit, Number(body.inches || 0)); }
  catch { return NextResponse.json({ error: "Distancia inválida." }, { status: 400 }); }
  const [{ data: membership }, { data: tournament }, { data: group }] = await Promise.all([
    admin.from("group_members").select("group_id").eq("group_id", access.group_id).eq("tournament_player_id", body.playerId).maybeSingle(),
    admin.from("tournaments").select("oyes_holes").eq("id", access.tournament_id).single(),
    admin.from("tournament_groups").select("status").eq("id", access.group_id).single(),
  ]);
  if (!membership || !tournament?.oyes_holes?.includes(hole)) return NextResponse.json({ error: "Este jugador/hoyo no pertenece a Oyes." }, { status: 403 });
  if (group?.status === "confirmed" && access.role !== "admin") return NextResponse.json({ error: "La tarjeta está cerrada." }, { status: 423 });
  const { data, error } = await admin.rpc("record_tournament_oyes", {
    p_tournament_id: access.tournament_id,
    p_hole: hole,
    p_player_id: body.playerId,
    p_distance_meters: meters,
    p_access_id: access.access_id,
    p_force: access.role === "admin",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const result = data?.[0];
  return NextResponse.json({ oyes: result, retained: result?.accepted === false });
}
