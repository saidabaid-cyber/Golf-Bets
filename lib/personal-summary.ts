import type { calculatePersonalBets } from "./engine";

type PersonalResult = ReturnType<typeof calculatePersonalBets>["results"][number];

function selectedHoleComponents(result: PersonalResult, hole: number) {
  const active = result.liveComponents.filter(component => component.holes.includes(hole));
  return active.filter(component => !component.key.endsWith("18") || !active.some(other => other.kind === component.kind && !other.key.endsWith("18")));
}

export function personalHoleStatus(result: PersonalResult, ownerName: string, rivalName: string, hole: number) {
  return selectedHoleComponents(result, hole).map(component => {
    const value = component.kind === "match" ? component.matchState : component.medalDiff;
    const label = component.kind === "match" ? "Match" : "Medal";
    if (!component.playedHoles) return `${label}: sin hoyos guardados`;
    if (value === 0) return `${label}: AS`;
    const leader = value > 0 ? ownerName : rivalName;
    return `${label}: ${leader} ${component.kind === "match" ? `${Math.abs(value)} UP` : `+${Math.abs(value)}`}`;
  });
}

export function personalHoleSummary(result: PersonalResult, ownerName: string, rivalName: string, hole: number) {
  const status = personalHoleStatus(result, ownerName, rivalName, hole);
  return status.length ? `PERSONAL · ${ownerName} vs ${rivalName}\n${status.join(" · ")}` : "";
}

export function monkeyHoleSummary(players: Array<{ id: string; name: string }>, points: Record<string, number>) {
  return `Monkey: ${players.map(player => `${player.name} ${points[player.id] || 0} pts`).join(" · ")}`;
}
