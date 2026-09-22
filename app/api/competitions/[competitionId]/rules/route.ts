import { NextResponse } from "next/server";

import { getSupabasePublic } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(competitionId)) return NextResponse.json({ error: "Competición inválida." }, { status: 400 });
  const database = getSupabasePublic("cloud");
  if (!database) return NextResponse.json({ error: "Reglamento no disponible." }, { status: 503, headers: { "cache-control": "no-store" } });
  const result = await database.rpc("player_competition_rules_v1", { requested_competition_id: competitionId, effective_at: new Date().toISOString() });
  if (result.error) return NextResponse.json({ error: "No fue posible consultar el reglamento." }, { status: 503 });
  const projection = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data as Record<string, unknown> : null;
  if (!projection) return NextResponse.json({ error: "Competición no encontrada." }, { status: 404 });
  const ruleSet = projection.ruleSet && typeof projection.ruleSet === "object" && !Array.isArray(projection.ruleSet) ? projection.ruleSet as Record<string, unknown> : null;
  return NextResponse.json({ ...projection, snapshot: ruleSet ? { competitionId, competitionRuleSetId: ruleSet.id, competitionRuleVersion: ruleSet.version } : null }, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=30" } });
}
