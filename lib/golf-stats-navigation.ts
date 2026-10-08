import type { StatsWindow } from "../features/stats/domain";
export type GolfStatsView = "summary" | "scoring" | "putting" | "driving" | "approach";
export function golfStatsSelection(search: string) {
  const params = new URLSearchParams(search), view = params.get("statsView"), period = params.get("statsPeriod");
  return {
    view: (["summary","scoring","putting","driving","approach"].includes(view ?? "") ? view : "summary") as GolfStatsView,
    window: (period === "ALL" || period === "SEASON" ? period : [5,10,20].includes(Number(period)) ? Number(period) : 20) as StatsWindow,
    scope: params.get("statsHoles") === "9" ? 9 as const : params.get("statsHoles") === "18" ? 18 as const : undefined,
    course: (params.get("statsCourse") ?? "").slice(0,240), tee: (params.get("statsTee") ?? "").slice(0,120),
  };
}
