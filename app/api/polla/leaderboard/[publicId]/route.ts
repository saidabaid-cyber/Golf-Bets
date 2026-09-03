import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";
import { buildPollaLeaderboard, type PollaLeaderboardScope } from "../../../../../lib/polla-live";
import type { HandicapMode } from "../../../../../lib/types";

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) {
  const admin = getSupabaseAdmin("polla");
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const { publicId } = await context.params;
  const identifier = decodeURIComponent(publicId).trim();
  const tournamentQuery = admin.from("tournaments").select("id,public_id,short_code,name,course_name,holes,start_hole,status,format,hcp_pct,handicap_mode,public_leaderboard,course_snapshot");
  const { data: tournament, error: tournamentError } = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(identifier)
    ? await tournamentQuery.eq("public_id", identifier).single()
    : await tournamentQuery.eq("short_code", identifier.toUpperCase()).single();
  if (tournamentError || !tournament?.public_leaderboard) return NextResponse.json({ error: "Leaderboard no disponible." }, { status: 404 });
  const url = new URL(request.url);
  const scopeValue = url.searchParams.get("scope");
  const scope: PollaLeaderboardScope = scopeValue === "front9" || scopeValue === "back9" ? scopeValue : "all";
  const requestedGroupId = url.searchParams.get("groupId") || undefined;
  const [playersResult, scoresResult, oyesResult] = await Promise.all([
    admin.from("tournament_players").select("id,name,handicap,group_members(group_id,tournament_groups(name))").eq("tournament_id", tournament.id),
    admin.from("tournament_scores").select("player_id,hole,score").eq("tournament_id", tournament.id),
    admin.from("tournament_oyes").select("hole,distance_meters,tournament_players(name)").eq("tournament_id", tournament.id).order("hole"),
  ]);
  const firstError = [playersResult, scoresResult, oyesResult].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: "No fue posible actualizar el leaderboard." }, { status: 400 });
  const { data: players } = playersResult;
  const { data: scores } = scoresResult;
  const { data: oyes } = oyesResult;
  const holes = Array.isArray(tournament.course_snapshot) ? tournament.course_snapshot as Array<{ number: number; par: number; strokeIndex?: number }> : [];
  const normalizedPlayers = (players || []).map((player) => {
    const membership = player.group_members?.[0];
    const rawGroup = membership?.tournament_groups as unknown as { name?: string } | Array<{ name?: string }> | null;
    const group = Array.isArray(rawGroup) ? rawGroup[0] : rawGroup;
    return { id: player.id, name: player.name, handicap: Number(player.handicap), groupId: membership?.group_id, groupName: group?.name };
  });
  const validGroupId = requestedGroupId && normalizedPlayers.some((player) => player.groupId === requestedGroupId) ? requestedGroupId : undefined;
  const rows = buildPollaLeaderboard({
    players: normalizedPlayers,
    scores: (scores || []).map((score) => ({ playerId: score.player_id, hole: score.hole, score: score.score })),
    courseSnapshot: holes,
    tournamentHoles: tournament.holes === 9 ? 9 : 18,
    startHole: tournament.start_hole === 10 ? 10 : 1,
    hcpPct: tournament.hcp_pct,
    handicapMode: tournament.handicap_mode as HandicapMode,
    scope,
    groupId: validGroupId,
  });
  const publicOyes = (oyes || []).map((item) => {
    const rawPlayer = item.tournament_players as unknown as { name?: string } | Array<{ name?: string }> | null;
    const player = Array.isArray(rawPlayer) ? rawPlayer[0] : rawPlayer;
    return { hole: item.hole, distanceMeters: Number(item.distance_meters), playerName: player?.name || "Jugador" };
  });
  return NextResponse.json({ tournament: { name: tournament.name, courseName: tournament.course_name, status: tournament.status, format: tournament.format, publicId: tournament.public_id, shortCode: tournament.short_code }, rows, oyes: publicOyes }, { headers: { "cache-control": "public, max-age=0, s-maxage=3, stale-while-revalidate=12" } });
}
