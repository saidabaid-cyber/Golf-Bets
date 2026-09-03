import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "../../../../lib/supabase/server";

async function account(request: NextRequest) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const supabase = token ? getSupabaseForUser(token) : null;
  if (!supabase) return { error: "Nube no configurada.", status: 503 } as const;
  const { data: authData } = await supabase.auth.getUser(token);
  if (!authData.user) return { error: "Sesión inválida.", status: 401 } as const;
  return { supabase, userId: authData.user.id } as const;
}

export async function GET(request: NextRequest) {
  const authenticated = await account(request);
  if ("error" in authenticated) return NextResponse.json({ error: authenticated.error }, { status: authenticated.status });
  const { data, error } = await authenticated.supabase.from("rounds_cloud").select("snapshot").eq("owner_id", authenticated.userId).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rounds: (data || []).map((row) => row.snapshot) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const authenticated = await account(request);
  if ("error" in authenticated) return NextResponse.json({ error: authenticated.error }, { status: authenticated.status });
  const { supabase, userId } = authenticated;
  const body = await request.json().catch(() => null) as { round?: { id?: string } } | null;
  if (!body?.round?.id) return NextResponse.json({ error: "Ronda inválida." }, { status: 400 });
  const { data: existing } = await supabase.from("rounds_cloud").select("id").eq("owner_id", userId).eq("local_round_id", body.round.id).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true }, { status: 409 });
  const { data, error } = await supabase.from("rounds_cloud").insert({ owner_id: userId, local_round_id: body.round.id, local_id: body.round.id, snapshot: body.round }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ roundId: data.id }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authenticated = await account(request);
  if ("error" in authenticated) return NextResponse.json({ error: authenticated.error }, { status: authenticated.status });
  const body = await request.json().catch(() => null) as { roundId?: string; confirmation?: boolean } | null;
  if (!body?.roundId || body.confirmation !== true) return NextResponse.json({ error: "Confirmación requerida." }, { status: 400 });
  const deletedAt = new Date().toISOString();
  const { error: tombstoneError } = await authenticated.supabase.from("cloud_deletions").upsert({ owner_id: authenticated.userId, entity_type: "round", local_id: body.roundId, deleted_at: deletedAt }, { onConflict: "owner_id,entity_type,local_id" });
  if (tombstoneError) return NextResponse.json({ error: "No fue posible registrar la eliminación." }, { status: 400 });
  const { error } = await authenticated.supabase.from("rounds_cloud").delete().eq("owner_id", authenticated.userId).eq("local_round_id", body.roundId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}
