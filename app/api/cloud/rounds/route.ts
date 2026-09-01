import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "../../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const supabase = token ? getSupabaseForUser(token) : null;
  if (!supabase) return NextResponse.json({ error: "Nube no configurada." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser(token);
  if (!authData.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  const body = await request.json().catch(() => null) as { round?: { id?: string } } | null;
  if (!body?.round?.id) return NextResponse.json({ error: "Ronda inválida." }, { status: 400 });
  const { data: existing } = await supabase.from("rounds_cloud").select("id").eq("local_round_id", body.round.id).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true }, { status: 409 });
  const { data, error } = await supabase.from("rounds_cloud").insert({ owner_id: authData.user.id, local_round_id: body.round.id, snapshot: body.round }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ roundId: data.id }, { status: 201 });
}
