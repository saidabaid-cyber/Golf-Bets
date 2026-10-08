export type ScorecardView = { kind: "round" } | { kind: "card" } | { kind: "hole"; hole: number; playerId: string };
export function scorecardViewFromSearch(search: string, roundId: string, holes: readonly number[], players: readonly string[]): ScorecardView {
  const params = new URLSearchParams(search);
  if (params.get("card") !== roundId) return { kind: "round" };
  const hole = Number(params.get("cardHole")), playerId = params.get("cardPlayer") ?? "";
  return holes.includes(hole) && players.includes(playerId) ? { kind: "hole", hole, playerId } : { kind: "card" };
}
export function scorecardViewHref(search: string, roundId: string, view: ScorecardView) {
  const params = new URLSearchParams(search);
  ["card", "cardHole", "cardPlayer"].forEach(key => params.delete(key));
  if (view.kind !== "round") params.set("card", roundId);
  if (view.kind === "hole") { params.set("cardHole", String(view.hole)); params.set("cardPlayer", view.playerId); }
  return `/${params.size ? `?${params}` : ""}`;
}
