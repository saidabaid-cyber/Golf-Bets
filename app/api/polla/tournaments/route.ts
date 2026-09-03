import { randomBytes, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseForUser } from "../../../../lib/supabase/server";
import { normalizePollaHcpPercentage } from "../../../../lib/polla-live";

function bearer(request: NextRequest) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export async function GET(request: NextRequest) {
  const token = bearer(request);
  const supabase = token ? getSupabaseForUser(token, "polla") : null;
  if (!supabase) return NextResponse.json({ error: "Polla Live requiere configuración de nube o sesión." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser(token);
  if (!authData.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  const selection = "id,public_id,short_code,name,tournament_date,course_name,status,format,holes,created_by";
  const [owned, delegatedAccess] = await Promise.all([
    supabase.from("tournaments").select(selection).eq("created_by", authData.user.id).order("tournament_date", { ascending: false }),
    supabase.from("tournament_access").select("tournament_id,expires_at").eq("user_id", authData.user.id).eq("role", "admin").is("revoked_at", null),
  ]);
  if (owned.error || delegatedAccess.error) return NextResponse.json({ error: "No fue posible cargar tus Pollas." }, { status: 400 });
  const now = Date.now();
  const delegatedIds = Array.from(new Set((delegatedAccess.data || [])
    .filter((item) => !item.expires_at || Date.parse(item.expires_at) > now)
    .map((item) => item.tournament_id)));
  const delegated = delegatedIds.length ? await supabase.from("tournaments").select(selection).in("id", delegatedIds).order("tournament_date", { ascending: false }) : { data: [], error: null };
  if (delegated.error) return NextResponse.json({ error: "No fue posible cargar las Pollas administradas." }, { status: 400 });
  const tournaments = Array.from(new Map([...(owned.data || []), ...(delegated.data || [])].map((item) => [item.id, { ...item, isOwner: item.created_by === authData.user!.id }])).values());
  return NextResponse.json({ tournaments });
}

export async function POST(request: NextRequest) {
  const token = bearer(request);
  const userClient = token ? getSupabaseForUser(token, "polla") : null;
  const admin = getSupabaseAdmin("polla");
  if (!userClient || !admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData.user) return NextResponse.json({ error: "Inicia sesión para crear una Polla." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.courseName !== "string" || !body.courseName.trim()) {
    return NextResponse.json({ error: "Nombre y campo son obligatorios." }, { status: 400 });
  }
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
  const shortCode = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  const insert = {
    created_by: authData.user.id,
    short_code: shortCode,
    name: body.name.trim().slice(0, 160),
    tournament_date: body.date,
    course_name: body.courseName.trim().slice(0, 160),
    course_snapshot: body.courseSnapshot || [],
    holes: body.holes === 9 ? 9 : 18,
    start_hole: body.startHole === 10 ? 10 : 1,
    format: body.format === "gross" || body.format === "net" ? body.format : "both",
    hcp_pct: normalizePollaHcpPercentage(body.hcpPct),
    handicap_mode: typeof body.handicapMode === "string" ? body.handicapMode : "half_up",
    local_rules: typeof body.localRules === "string" ? body.localRules.slice(0, 5000) : "",
    oyes_holes: Array.isArray(body.oyesHoles) ? body.oyesHoles.map(Number).filter((hole) => hole >= 1 && hole <= 18) : [],
  };
  const { data: tournament, error } = await admin.from("tournaments").insert(insert).select("id,public_id,short_code,name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (Array.isArray(body.players) && body.players.length > 100) {
    await admin.from("tournaments").delete().eq("id", tournament.id);
    return NextResponse.json({ error: "Polla Live admite hasta 100 jugadores." }, { status: 400 });
  }
  const rawPlayers = Array.isArray(body.players) ? (body.players as Array<Record<string, unknown>>).slice(0, 100) : [];
  if (rawPlayers.length < 3) {
    await admin.from("tournaments").delete().eq("id", tournament.id);
    return NextResponse.json({ error: "Una Polla necesita al menos tres jugadores." }, { status: 400 });
  }
  const groups = new Map<string, Array<Record<string, unknown>>>();
  rawPlayers.forEach((player, index) => {
    const name = typeof player.group === "string" && player.group.trim() ? player.group.trim() : `Grupo ${Math.floor(index / 4) + 1}`;
    groups.set(name, [...(groups.get(name) || []), player]);
  });
  if (Array.from(groups.values()).some((group) => group.length < 3 || group.length > 5)) {
    await admin.from("tournaments").delete().eq("id", tournament.id);
    return NextResponse.json({ error: "Cada grupo debe tener entre 3 y 5 jugadores." }, { status: 400 });
  }
  const access: Array<{ playerId: string; name: string; group: string; pin: string }> = [];
  for (const [groupName, groupPlayers] of groups) {
    const first = groupPlayers[0];
    const { data: group, error: groupError } = await admin.from("tournament_groups").insert({
      tournament_id: tournament.id,
      name: groupName,
      start_hole: first?.startHole === 10 ? 10 : insert.start_hole,
      tee_time: typeof first?.teeTime === "string" && first.teeTime ? first.teeTime : null,
    }).select("id").single();
    if (groupError) { await admin.from("tournaments").delete().eq("id", tournament.id); return NextResponse.json({ error: groupError.message }, { status: 400 }); }
    for (let index = 0; index < groupPlayers.length; index += 1) {
      const player = groupPlayers[index];
      const pin = String(randomInt(1000, 10000));
      const { data: playerId, error: playerError } = await admin.rpc("add_tournament_player", {
        p_tournament_id: tournament.id,
        p_group_id: group.id,
        p_name: String(player.name || "").trim().slice(0, 120),
        p_handicap: Math.min(54, Math.max(-15, Number(player.handicap) || 0)),
        p_pin: pin,
        p_is_scorer: index === 0,
      });
      if (playerError) { await admin.from("tournaments").delete().eq("id", tournament.id); return NextResponse.json({ error: playerError.message }, { status: 400 }); }
      access.push({ playerId, name: String(player.name || ""), group: groupName, pin });
    }
  }
  const prizes = Array.isArray(body.prizes) ? (body.prizes as Array<Record<string, unknown>>).slice(0, 30) : [];
  if (prizes.length) await admin.from("tournament_prizes").insert(prizes.map((prize, index) => ({
    tournament_id: tournament.id,
    position: Math.max(1, Number(prize.position) || index + 1),
    category: prize.category === "gross" || prize.category === "other" ? prize.category : "net",
    money: Number(prize.money) || null,
    percentage: Number(prize.percentage) || null,
    description: typeof prize.description === "string" ? prize.description.slice(0, 300) : null,
  })));
  return NextResponse.json({ tournament, access }, { status: 201 });
}
