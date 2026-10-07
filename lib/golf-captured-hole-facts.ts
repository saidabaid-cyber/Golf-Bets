import type { AdvancedHoleStat } from "./types";
import type { SocialScoreHole } from "./social-activity-contract";

/** Allowlist of captured golf facts. No notes, coordinates, inference or peer data. */
export function capturedHoleFacts(stat: AdvancedHoleStat | undefined, par: number): Partial<Omit<SocialScoreHole,"hole"|"par"|"score"|"putts"|"yards">> {
  if (!stat || typeof stat !== "object") return {};
  const facts: Partial<Omit<SocialScoreHole,"hole"|"par"|"score"|"putts"|"yards">> = {};
  if (par > 3 && typeof stat.fairwayHit === "boolean") facts.fairwayHit = stat.fairwayHit;
  if (typeof stat.greenInRegulation === "boolean") facts.greenInRegulation = stat.greenInRegulation;
  if (typeof stat.outOfBounds === "boolean") facts.outOfBounds = stat.outOfBounds;
  for (const key of ["penaltyStrokes", "bunkerCount", "greenSideBunkerCount", "fairwayBunkerCount", "penaltyAreaCount", "outOfBoundsCount"] as const) {
    const value = stat[key];
    if (Number.isInteger(value) && value! >= 0 && value! <= 100) facts[key] = value;
  }
  if (["far_left", "left", "center", "right", "far_right"].includes(stat.teeDirection || "")) facts.teeDirection = stat.teeDirection;
  if (["fairway", "rough", "bunker", "water_ob"].includes(stat.landingLie || "")) facts.landingLie = stat.landingLie;
  if (typeof stat.teeClub === "string" && stat.teeClub.trim()) facts.teeClub = stat.teeClub.trim().slice(0, 64);
  if (Number.isFinite(stat.teeDistance) && stat.teeDistance! > 0 && stat.teeDistance! <= 1000) facts.teeDistance = stat.teeDistance;
  if (Number.isFinite(stat.firstPuttDistanceFeet) && stat.firstPuttDistanceFeet! >= 0 && stat.firstPuttDistanceFeet! <= 1000) facts.firstPuttDistanceFeet = stat.firstPuttDistanceFeet;
  return facts;
}
export const teeDirectionLabel = { far_left: "← Muy a la izquierda", left: "← Izquierda", center: "Centro", right: "Derecha →", far_right: "Muy a la derecha →" } as const;
export const landingLieLabel = { fairway: "Fairway", rough: "Rough", bunker: "Búnker", water_ob: "Agua / OB registrado" } as const;
