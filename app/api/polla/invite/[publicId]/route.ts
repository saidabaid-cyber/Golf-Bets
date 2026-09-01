import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ publicId: string }> }) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const { publicId } = await context.params;
  const { data: tournament } = await admin.from("tournaments").select("id,name,course_name,tournament_date,status").eq("public_id", publicId).single();
  if (!tournament) return NextResponse.json({ error: "Polla no encontrada." }, { status: 404 });
  const { data: players } = await admin.from("tournament_players").select("id,name,handicap,group_members(group_id,tournament_groups(name))").eq("tournament_id", tournament.id).order("name");
  return NextResponse.json({ tournament, players: (players || []).map((player) => ({ id: player.id, name: player.name, handicap: player.handicap, group: player.group_members?.[0]?.tournament_groups })) });
}
