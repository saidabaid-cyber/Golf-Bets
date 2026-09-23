import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "../../../../lib/supabase/server";
import { authUserFailure } from "../../../../lib/auth-errors";
import { scheduleSocialPublication } from "../../../../lib/social-publication.server";
import { readCloudRoundHistory } from "../../../../lib/cloud-sync-service";
import { hasCompletedRoundPublicationCandidate } from "../../../../lib/social-publication-policy";

async function account(request: NextRequest) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Inicia sesión para consultar tus rondas en Supabase.", status: 401 } as const;
  const supabase = token ? getSupabaseForUser(token) : null;
  if (!supabase) return { error: "Nube no configurada.", status: 503 } as const;
  const { data: authData, error } = await supabase.auth.getUser(token);
  const user = authData.user;
  const failure = authUserFailure(error, Boolean(user));
  if (failure) return failure;
  if (!user) return { error: "La sesión terminó. Vuelve a iniciar sesión para conectar la nube.", status: 401, code: "AUTH_REQUIRED" } as const;
  return { supabase, userId: user.id } as const;
}

export async function GET(request: NextRequest) {
  const authenticated = await account(request);
  if ("error" in authenticated) return NextResponse.json({ error: authenticated.error, code: authenticated.code || "AUTH_REQUIRED" }, { status: authenticated.status });
  try {
    const rounds = await readCloudRoundHistory(authenticated.supabase, authenticated.userId);
    return NextResponse.json({ rounds }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos consultar tus rondas. Intenta de nuevo." }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const authenticated = await account(request);
  if ("error" in authenticated) return NextResponse.json({ error: authenticated.error, code: authenticated.code || "AUTH_REQUIRED" }, { status: authenticated.status });
  const { supabase, userId } = authenticated;
  const body = await request.json().catch(() => null) as { round?: { id?: string; cloudReadOnly?: boolean } } | null;
  if (typeof body?.round?.id !== "string" || !body.round.id) return NextResponse.json({ error: "Ronda inválida." }, { status: 400 });
  if (body.round.cloudReadOnly || body.round.id.startsWith("shared:")) return NextResponse.json({ error: "Esta tarjeta compartida es de sólo lectura." }, { status: 403 });
  const { data: existing } = await supabase.from("rounds_cloud").select("id").eq("owner_id", userId).eq("local_round_id", body.round.id).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true }, { status: 409 });
  const { data, error } = await supabase.from("rounds_cloud").insert({ owner_id: userId, local_round_id: body.round.id, local_id: body.round.id, snapshot: body.round }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (hasCompletedRoundPublicationCandidate([body.round])) scheduleSocialPublication(userId, "round");
  return NextResponse.json({ roundId: data.id }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authenticated = await account(request);
  if ("error" in authenticated) return NextResponse.json({ error: authenticated.error, code: authenticated.code || "AUTH_REQUIRED" }, { status: authenticated.status });
  const body = await request.json().catch(() => null) as { roundId?: string; confirmation?: boolean } | null;
  if (!body?.roundId || body.confirmation !== true) return NextResponse.json({ error: "Confirmación requerida." }, { status: 400 });
  const deletedAt = new Date().toISOString();
  const { error: tombstoneError } = await authenticated.supabase.from("cloud_deletions").upsert({ owner_id: authenticated.userId, entity_type: "round", local_id: body.roundId, deleted_at: deletedAt }, { onConflict: "owner_id,entity_type,local_id" });
  if (tombstoneError) return NextResponse.json({ error: "No fue posible registrar la eliminación." }, { status: 400 });
  const { error } = await authenticated.supabase.from("rounds_cloud").delete().eq("owner_id", authenticated.userId).eq("local_round_id", body.roundId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}
