import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";
import { playingHandicap, strokeAllowanceForHole } from "../../../../../lib/engine";
import type { HandicapMode } from "../../../../../lib/types";

export async function GET(_request: Request, context: { params: Promise<{ publicId: string }> }) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Polla Live requiere configuración de nube." }, { status: 503 });
  const { publicId } = await context.params;
  const { data: tournament } = await admin.from("tournaments").select("id,name,course_name,holes,status,format,hcp_pct,handicap_mode,public_leaderboard,course_snapshot").eq("public_id", publicId).single();
  if (!tournament?.public_leaderboard) return NextResponse.json({ error: "Leaderboard no disponible." }, { status: 404 });
  const [{ data: players }, { data: scores }] = await Promise.all([
    admin.from("tournament_players").select("id,name,handicap").eq("tournament_id", tournament.id),
    admin.from("tournament_scores").select("player_id,hole,score").eq("tournament_id", tournament.id),
  ]);
  const holes = Array.isArray(tournament.course_snapshot) ? tournament.course_snapshot as Array<{ number: number; par: number; strokeIndex?: number }> : [];
  const parByHole = new Map(holes.map((hole) => [hole.number, hole.par]));
  const strokeIndexByHole = new Map(holes.map((hole) => [hole.number, hole.strokeIndex || hole.number]));
  const rows = (players || []).map((player) => {
    const own = (scores || []).filter((score) => score.player_id === player.id);
    const gross = own.reduce((sum, score) => sum + score.score, 0);
    const par = own.reduce((sum, score) => sum + (parByHole.get(score.hole) || 4), 0);
    const played = own.length;
    const mode = tournament.handicap_mode as HandicapMode;
    const playingHcp = playingHandicap(Math.max(0, Number(player.handicap)), tournament.hcp_pct, mode);
    const allowance = own.reduce((sum, score) => sum + strokeAllowanceForHole(playingHcp, strokeIndexByHole.get(score.hole) || score.hole, mode), 0);
    return { playerId: player.id, name: player.name, handicap: Number(player.handicap), gross, net: gross - allowance, relativeToPar: gross - par, thru: played, finished: played === tournament.holes };
  });
  return NextResponse.json({ tournament: { name: tournament.name, courseName: tournament.course_name, status: tournament.status, format: tournament.format }, rows });
}
