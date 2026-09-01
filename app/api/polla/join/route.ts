import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const body = await request.json().catch(() => null) as { publicId?: string; playerId?: string; pin?: string } | null;
  if (!body?.publicId || !body.playerId || !/^\d{4,6}$/.test(body.pin || "")) return NextResponse.json({ error: "Datos de acceso inválidos." }, { status: 400 });
  const { data, error } = await supabase.rpc("join_polla", { p_public_id: body.publicId, p_player_id: body.playerId, p_pin: body.pin });
  if (error || !data?.[0]) return NextResponse.json({ error: "Nombre o PIN incorrecto." }, { status: 401 });
  return NextResponse.json({ session: data[0] });
}
