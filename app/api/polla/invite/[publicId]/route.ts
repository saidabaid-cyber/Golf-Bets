import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ publicId: string }> }) {
  const admin = getSupabaseAdmin("polla");
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const { publicId } = await context.params;
  const identifier = decodeURIComponent(publicId).trim();
  const query = admin.from("tournaments").select("id,public_id,short_code,name,course_name,tournament_date,status");
  const { data: tournament, error: tournamentError } = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(identifier)
    ? await query.eq("public_id", identifier).single()
    : await query.eq("short_code", identifier.toUpperCase()).single();
  if (tournamentError || !tournament) return NextResponse.json({ error: "Polla no encontrada." }, { status: 404 });
  const { data: players, error: playersError } = await admin.from("tournament_players").select("id,name,handicap,group_members(group_id,tournament_groups(name))").eq("tournament_id", tournament.id).order("name");
  if (playersError) return NextResponse.json({ error: "No fue posible cargar los participantes." }, { status: 400 });
  return NextResponse.json({ tournament, players: (players || []).map((player) => ({ id: player.id, name: player.name, handicap: player.handicap, group: player.group_members?.[0]?.tournament_groups })) }, { headers: { "cache-control": "private, no-store" } });
}
