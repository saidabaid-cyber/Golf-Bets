import { golfCoachContextFromSearch, type GolfCoachContext } from "./golf-coach-context";
export type GolfObjectSource = "activity" | "history" | "shared";
export type GolfObject =
  | { kind: "player"; id: string }
  | { kind: "round-options"; id: string; source: "history" }
  | { [K in "round" | "hole" | "course"]: { kind: K; id: string; source: GolfObjectSource; hole?: number } }["round" | "hole" | "course"]
  | { kind: "equipment" | "achievement" | "leaderboard" | "activity"; id: string; item?: string }
  | { kind: "analysis"; id: "mine" }
  | { kind: "statistics"; id: "mine" }
  | { kind: "rules"; id: "mine" }
  | { kind: "coach"; id: "mine"; context: GolfCoachContext };
const reference = /^[A-Za-z0-9:_-]{1,128}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = ["object", "objectId", "objectSource", "hole", "item", "category", "metric", "period", "holes"];
export function golfObjectFromSearch(search: string): GolfObject | null {
  const p = new URLSearchParams(search), kind = p.get("object"), id = p.get("objectId");
  if (!id || !reference.test(id)) return null;
  if (kind === "player") return uuid.test(id) ? { kind, id } : null;
  if (kind === "round-options") return p.get("objectSource") === "history" ? {kind,id,source:"history"} : null;
  if (kind === "analysis" || kind === "statistics" || kind === "rules") return id === "mine" ? { kind, id } : null;
  if (kind === "coach" && id === "mine") { const context=golfCoachContextFromSearch(search); return context?{kind,id,context}:null; }
  if (kind === "round" || kind === "hole" || kind === "course") {
    const source = p.get("objectSource");
    if (source !== "history" && source !== "activity" && source !== "shared") return null;
    if (source !== "history" && !uuid.test(id)) return null;
    const hole = Number(p.get("hole"));
    if (kind === "hole" && (!Number.isInteger(hole) || hole < 1 || hole > 18)) return null;
    return { kind, id, source, ...(kind === "hole" ? { hole } : {}) };
  }
  if (["equipment", "achievement", "leaderboard", "activity"].includes(kind || "") && uuid.test(id))
    return { kind: kind as "equipment", id, ...(p.get("item") ? { item: p.get("item")!.slice(0,120) } : {}) };
  return null;
}
export function golfObjectHref(object: GolfObject | null, search: string) {
  const params = new URLSearchParams(search);
  keys.forEach(key => params.delete(key));
  if (object) {
    params.set("object", object.kind); params.set("objectId", object.id);
    if ("source" in object) params.set("objectSource", object.source);
    if ("hole" in object && object.hole) params.set("hole", String(object.hole));
    if ("item" in object && object.item) params.set("item", object.item);
    if (object.kind === "coach") Object.entries(object.context).forEach(([key,value])=>params.set(key,String(value)));
  }
  return `/${params.size ? `?${params}` : ""}`;
}
export type GolfObjectFrame = { key: string; object: GolfObject; scroll: number };
/** Pop only to a known frame; a direct link never grants access to its data. */
export function restoreGolfObjectFrames(frames: readonly GolfObjectFrame[], key: string | null, object: GolfObject | null): GolfObjectFrame[] {
  if (!object) return [];
  const position = key ? frames.findIndex(frame => frame.key === key) : -1;
  return position < 0 ? [{ key: key || "direct", object, scroll: 0 }] : frames.slice(0, position + 1);
}
