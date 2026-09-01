import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseForUser } from "../../../../lib/supabase/server";

function bearer(request: NextRequest) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export async function GET(request: NextRequest) {
  const token = bearer(request);
  const supabase = token ? getSupabaseForUser(token) : null;
  if (!supabase) return NextResponse.json({ error: "Polla Live requiere configuración de nube o sesión." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser(token);
  if (!authData.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  const { data, error } = await supabase.from("tournaments").select("id,public_id,short_code,name,tournament_date,course_name,status,format,holes").eq("created_by", authData.user.id).order("tournament_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ tournaments: data });
}

export async function POST(request: NextRequest) {
  const token = bearer(request);
  const userClient = token ? getSupabaseForUser(token) : null;
  const admin = getSupabaseAdmin();
  if (!userClient || !admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData.user) return NextResponse.json({ error: "Inicia sesión para crear una Polla." }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.courseName !== "string" || !body.courseName.trim()) {
    return NextResponse.json({ error: "Nombre y campo son obligatorios." }, { status: 400 });
  }
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
    hcp_pct: Math.min(100, Math.max(0, Number(body.hcpPct) || 100)),
    handicap_mode: typeof body.handicapMode === "string" ? body.handicapMode : "half_up",
    local_rules: typeof body.localRules === "string" ? body.localRules.slice(0, 5000) : "",
    oyes_holes: Array.isArray(body.oyesHoles) ? body.oyesHoles.map(Number).filter((hole) => hole >= 1 && hole <= 18) : [],
  };
  const { data: tournament, error } = await admin.from("tournaments").insert(insert).select("id,public_id,short_code,name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const adminAccessToken = randomBytes(32).toString("hex");
  const { data: adminAccess } = await admin.from("tournament_access").insert({ tournament_id: tournament.id, user_id: authData.user.id, role: "admin", token_hash: createHash("sha256").update(adminAccessToken).digest("hex") }).select("id").single();
  const rawPlayers = Array.isArray(body.players) ? (body.players as Array<Record<string, unknown>>).slice(0, 200) : [];
  const groups = new Map<string, Array<Record<string, unknown>>>();
  rawPlayers.forEach((player, index) => {
    const name = typeof player.group === "string" && player.group.trim() ? player.group.trim() : `Grupo ${Math.floor(index / 4) + 1}`;
    groups.set(name, [...(groups.get(name) || []), player]);
  });
  const access: Array<{ playerId: string; name: string; group: string; pin: string }> = [];
  for (const [groupName, groupPlayers] of groups) {
    const first = groupPlayers[0];
    const { data: group, error: groupError } = await admin.from("tournament_groups").insert({
      tournament_id: tournament.id,
      name: groupName,
      start_hole: first?.startHole === 10 ? 10 : insert.start_hole,
      tee_time: typeof first?.teeTime === "string" && first.teeTime ? first.teeTime : null,
    }).select("id").single();
    if (groupError) return NextResponse.json({ error: groupError.message, tournament }, { status: 400 });
    for (let index = 0; index < groupPlayers.length; index += 1) {
      const player = groupPlayers[index];
      const pin = String(1000 + Math.floor(Math.random() * 9000));
      const { data: playerId, error: playerError } = await admin.rpc("add_tournament_player", {
        p_tournament_id: tournament.id,
        p_group_id: group.id,
        p_name: String(player.name || "").trim().slice(0, 120),
        p_handicap: Math.min(54, Math.max(-15, Number(player.handicap) || 0)),
        p_pin: pin,
        p_is_scorer: index === 0,
      });
      if (playerError) return NextResponse.json({ error: playerError.message, tournament }, { status: 400 });
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
  return NextResponse.json({ tournament, access, adminSession: { access_token: adminAccessToken, tournament_id: tournament.id, group_id: null, role: "admin", player_name: authData.user.email || "Administrador", access_id: adminAccess?.id } }, { status: 201 });
}
