import { buildFilteredGolfInsights, type StatsWindow } from "../features/stats/domain";
import type { RoundSnapshot } from "./types";
export type GolfCoachContext = { category: "putting" | "approach" | "tee"; metric: "putts" | "gir" | "fairways"; period: StatsWindow; holes?: 9 | 18 };
export const coachCategoryLabels = { putting: "Putting", approach: "Approach", tee: "Tee" };
export function golfCoachContextFromSearch(search: string): GolfCoachContext | null {
  const p = new URLSearchParams(search), category=p.get("category"), metric=p.get("metric"), raw=p.get("period");
  if ((category==="putting"&&metric==="putts") || (category==="approach"&&metric==="gir") || (category==="tee"&&metric==="fairways")) {
    const period: StatsWindow | null = ["5","10","20"].includes(raw || "") ? Number(raw) as 5|10|20 : raw==="ALL" || raw==="SEASON" ? raw : null;
    const holes=Number(p.get("holes"));
    return period ? {category,metric,period,...(holes===9||holes===18?{holes}:{})} as GolfCoachContext : null;
  }
  return null;
}
/** Only recorded aggregates are transferred. There is no generated recommendation. */
export function golfCoachMetric(rounds: RoundSnapshot[], context: GolfCoachContext) {
  const insights=buildFilteredGolfInsights(rounds,{window:context.period});
  const scope=context.holes || insights.scoreScopeHoles || (insights.scoredRounds18 ? 18 : 9);
  const putts=insights.recentRounds.filter(r=>r.holeCount===scope&&r.putts!==null).map(r=>r.putts!);
  if(context.metric==="putts")return {value:putts.length?putts.reduce((n,p)=>n+p,0)/putts.length:null,sample:putts.length,unit:`putts / ${scope} hoyos`};
  const hit=context.metric==="gir"?insights.greensInRegulation:insights.fairwaysHit,attempts=context.metric==="gir"?insights.greenAttempts:insights.fairwayAttempts;
  return {value:attempts?hit/attempts*100:null,sample:attempts,unit:"% de hoyos capturados"};
}
