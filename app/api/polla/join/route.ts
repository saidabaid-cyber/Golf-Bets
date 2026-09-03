import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin("polla");
  if (!supabase) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const body = await request.json().catch(() => null) as { publicId?: string; playerId?: string; pin?: string } | null;
  if (!body?.publicId || !body.playerId || !/^\d{4,6}$/.test(body.pin || "")) return NextResponse.json({ error: "Datos de acceso inválidos." }, { status: 400 });
  const identifier = body.publicId.trim();
  let tournamentPublicId = identifier;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(identifier)) {
    const { data: tournament } = await supabase.from("tournaments").select("public_id").eq("short_code", identifier.toUpperCase()).single();
    if (!tournament) return NextResponse.json({ error: "Nombre o PIN incorrecto." }, { status: 401 });
    tournamentPublicId = tournament.public_id;
  }
  const requester = `${request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"}|${request.headers.get("user-agent") || "unknown"}`;
  const requesterHash = createHash("sha256").update(requester).digest("hex");
  const { data, error } = await supabase.rpc("join_polla_secure", { p_public_id: tournamentPublicId, p_player_id: body.playerId, p_pin: body.pin, p_requester_hash: requesterHash });
  if (error?.message?.includes("rate_limited")) return NextResponse.json({ error: "Demasiados intentos. Espera diez minutos e intenta nuevamente." }, { status: 429 });
  if (error || !data?.[0]) return NextResponse.json({ error: "Nombre o PIN incorrecto." }, { status: 401 });
  return NextResponse.json({ session: data[0] }, { headers: { "cache-control": "private, no-store" } });
}
