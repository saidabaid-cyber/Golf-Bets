import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "../../../../lib/supabase/server";
import { authUserFailure } from "../../../../lib/auth-errors";
import { scheduleSocialPublication } from "../../../../lib/social-publication.server";
import { readCloudRoundHistory } from "../../../../lib/cloud-sync-service";
import { hasCompletedRoundPublicationCandidate } from "../../../../lib/social-publication-policy";
import { syncSharedRoundParticipants } from "../../../../lib/shared-round-participants.server";
import { linkedRoundPlayers } from "../../../../lib/shared-round-participants";
import type { RoundSnapshot } from "../../../../lib/types";

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
    const localId = new URL(request.url).searchParams.get("localRoundId");
    if (localId) {
      const row = await authenticated.supabase.from("rounds_cloud").select("id,version,snapshot").eq("owner_id", authenticated.userId).eq("local_id", localId).maybeSingle();
      if (row.error) throw row.error;
      return NextResponse.json({ data: row.data }, { headers: { "cache-control": "private, no-store" } });
    }
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
  try { linkedRoundPlayers(body.round as RoundSnapshot); }
  catch { return NextResponse.json({ error: "Identidades de jugadores inválidas o duplicadas." }, { status: 400 }); }
  const { data: existing } = await supabase.from("rounds_cloud").select("id").eq("owner_id", userId).eq("local_round_id", body.round.id).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true }, { status: 409 });
  const { data, error } = await supabase.from("rounds_cloud").insert({ owner_id: userId, local_round_id: body.round.id, local_id: body.round.id, snapshot: body.round }).select("id,version").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  let delivery;
  try { delivery = await syncSharedRoundParticipants(supabase, userId, [body.round.id]); }
  catch { return NextResponse.json({ roundId: data.id, error: "Ronda guardada; la entrega a participantes sigue pendiente." }, { status: 503 }); }
  if (hasCompletedRoundPublicationCandidate([body.round])) scheduleSocialPublication(userId, "round");
  return NextResponse.json({ roundId: data.id, version: Number(data.version), delivery }, { status: 201 });
}

/** Owner scorekeeper only. A stale device must reconcile; never silently win. */
export async function PUT(request: NextRequest) {
  const authenticated = await account(request);
  if ("error" in authenticated) return NextResponse.json({ error: authenticated.error }, { status: authenticated.status });
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) return NextResponse.json({ error: "Tarjeta demasiado grande." }, { status: 413 });
  const body = await request.json().catch(() => null) as { round?: RoundSnapshot; expectedVersion?: number } | null;
  const round = body?.round;
  if (!round?.id || round.cloudReadOnly || round.id.startsWith("shared:") || !["live", "completed", "cancelled"].includes(round.lifecycleState || "")
    || (round.lifecycleState === "completed" && !round.completedAt)
    || round.scorekeeping?.mode !== "owner" || !Number.isInteger(body?.expectedVersion) || Number(body?.expectedVersion) < 1)
    return NextResponse.json({ error: "Ronda o revisión inválida." }, { status: 400 });
  try { linkedRoundPlayers(round); } catch { return NextResponse.json({ error: "Jugadores duplicados." }, { status: 400 }); }
  const existing = await authenticated.supabase.from("rounds_cloud").select("id,version,snapshot").eq("owner_id", authenticated.userId).eq("local_id", round.id).maybeSingle();
  if (existing.error) return NextResponse.json({ error: "No pudimos consultar la ronda." }, { status: 503 });
  if (!existing.data) return NextResponse.json({ error: "Ronda no disponible." }, { status: 404 });
  if (Number(existing.data.version) !== body?.expectedVersion || existing.data.snapshot?.lifecycleState !== "live")
    return NextResponse.json({ code: "STALE_REVISION", error: "Otro dispositivo cambió o cerró la ronda. Conserva tu borrador y revisa la tarjeta de nube antes de continuar." }, { status: 409 });
  const saved = await authenticated.supabase.from("rounds_cloud").update({ snapshot: round, updated_at: new Date().toISOString() })
    .eq("id", existing.data.id).eq("owner_id", authenticated.userId).eq("version", body.expectedVersion).select("id,version").maybeSingle();
  if (saved.error) return NextResponse.json({ error: "Captura conservada localmente; nube pendiente." }, { status: 503 });
  if (!saved.data) return NextResponse.json({ code: "STALE_REVISION", error: "La ronda cambió durante la escritura. Revisa antes de reintentar." }, { status: 409 });
  let delivery;
  try { delivery = await syncSharedRoundParticipants(authenticated.supabase, authenticated.userId, [round.id]); }
  catch { return NextResponse.json({ version: Number(saved.data.version), error: "Scores guardados; la entrega a participantes sigue pendiente." }, { status: 503 }); }
  if (hasCompletedRoundPublicationCandidate([round])) scheduleSocialPublication(authenticated.userId, "round");
  return NextResponse.json({ roundId: saved.data.id, version: Number(saved.data.version), delivery });
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
