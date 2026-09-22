import { NextResponse } from "next/server";

import { publicationIsEffective } from "../../../../../lib/admin-control-center";
import { getSupabaseAdmin } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(competitionId)) return NextResponse.json({ error: "Competición inválida." }, { status: 400 });
  const database = getSupabaseAdmin("cloud");
  if (!database) return NextResponse.json({ error: "Reglamento no disponible." }, { status: 503, headers: { "cache-control": "no-store" } });
  const revisions = await database.from("admin_catalog_revisions").select("version,status,payload,effective_from,effective_until").eq("entity_type", "COMPETITION").eq("entity_id", competitionId).eq("status", "PUBLISHED").order("version", { ascending: false }).limit(20);
  if (revisions.error) return NextResponse.json({ error: "No fue posible consultar el reglamento." }, { status: 503 });
  const now = new Date().toISOString();
  const revision = (revisions.data || []).find((row) => publicationIsEffective({ effectiveFrom: row.effective_from, effectiveUntil: row.effective_until }, now));
  const competition = revision?.payload && typeof revision.payload === "object" && !Array.isArray(revision.payload) ? revision.payload as Record<string, unknown> : null;
  if (!revision || !competition || competition.visibility !== "PUBLIC") return NextResponse.json({ error: "Competición no encontrada." }, { status: 404 });
  const ruleSet = await database.from("competition_rule_sets").select("id,title,version,status,competition_rules(id,category,title,body,display_order,active)").eq("competition_id", competitionId).eq("version", revision.version).eq("status", "PUBLISHED").maybeSingle();
  if (ruleSet.error) return NextResponse.json({ error: "No fue posible consultar el reglamento." }, { status: 503 });
  const rules = (ruleSet.data?.competition_rules || []).filter((rule) => rule.active).sort((left, right) => left.display_order - right.display_order);
  return NextResponse.json({ competition, ruleSet: ruleSet.data ? { id: ruleSet.data.id, title: ruleSet.data.title, version: ruleSet.data.version } : null, rules, snapshot: ruleSet.data ? { competitionId, competitionRuleSetId: ruleSet.data.id, competitionRuleVersion: ruleSet.data.version } : null }, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=30" } });
}
