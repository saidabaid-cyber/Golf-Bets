import type { AdvancedHoleStat, AdvancedStatsByHole, ScoreCaptureMode } from "./types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function normalizeScoreCaptureMode(value: unknown): ScoreCaptureMode {
  return value === "advanced" ? "advanced" : "quick";
}

export function normalizeAdvancedStats(value: unknown): AdvancedStatsByHole {
  const source = record(value);
  if (!source) return {};
  const normalized: AdvancedStatsByHole = {};
  for (const [rawHole, rawPlayers] of Object.entries(source)) {
    const hole = Number(rawHole);
    const playerRows = record(rawPlayers);
    if (!Number.isInteger(hole) || hole < 1 || hole > 18 || !playerRows) continue;
    const nextPlayers: Record<string, AdvancedHoleStat> = {};
    for (const [playerId, rawStat] of Object.entries(playerRows)) {
      const stat = record(rawStat);
      if (!playerId.trim() || !stat) continue;
      const next: AdvancedHoleStat = {};
      if (typeof stat.fairwayHit === "boolean") next.fairwayHit = stat.fairwayHit;
      if (typeof stat.greenInRegulation === "boolean") next.greenInRegulation = stat.greenInRegulation;
      if (typeof stat.penaltyStrokes === "number" && Number.isInteger(stat.penaltyStrokes) && stat.penaltyStrokes >= 0 && stat.penaltyStrokes <= 50) {
        next.penaltyStrokes = stat.penaltyStrokes;
      }
      if (stat.teeDirection === "far_left" || stat.teeDirection === "left" || stat.teeDirection === "center" || stat.teeDirection === "right" || stat.teeDirection === "far_right") next.teeDirection = stat.teeDirection;
      if (stat.landingLie === "fairway" || stat.landingLie === "rough" || stat.landingLie === "bunker" || stat.landingLie === "water_ob") next.landingLie = stat.landingLie;
      if (typeof stat.teeClub === "string" && stat.teeClub.trim()) next.teeClub = stat.teeClub.trim().slice(0, 40);
      if (typeof stat.teeDistance === "number" && Number.isFinite(stat.teeDistance) && stat.teeDistance >= 0 && stat.teeDistance <= 600) next.teeDistance = stat.teeDistance;
      if (typeof stat.firstPuttDistanceFeet === "number" && Number.isFinite(stat.firstPuttDistanceFeet) && stat.firstPuttDistanceFeet >= 0 && stat.firstPuttDistanceFeet <= 300) next.firstPuttDistanceFeet = stat.firstPuttDistanceFeet;
      if (typeof stat.bunkerCount === "number" && Number.isInteger(stat.bunkerCount) && stat.bunkerCount >= 0 && stat.bunkerCount <= 20) next.bunkerCount = stat.bunkerCount;
      if (typeof stat.greenSideBunkerCount === "number" && Number.isInteger(stat.greenSideBunkerCount) && stat.greenSideBunkerCount >= 0 && stat.greenSideBunkerCount <= 20) next.greenSideBunkerCount = stat.greenSideBunkerCount;
      if (typeof stat.fairwayBunkerCount === "number" && Number.isInteger(stat.fairwayBunkerCount) && stat.fairwayBunkerCount >= 0 && stat.fairwayBunkerCount <= 20) next.fairwayBunkerCount = stat.fairwayBunkerCount;
      if (typeof stat.penaltyAreaCount === "number" && Number.isInteger(stat.penaltyAreaCount) && stat.penaltyAreaCount >= 0 && stat.penaltyAreaCount <= 20) next.penaltyAreaCount = stat.penaltyAreaCount;
      if (typeof stat.outOfBounds === "boolean") next.outOfBounds = stat.outOfBounds;
      if (typeof stat.outOfBoundsCount === "number" && Number.isInteger(stat.outOfBoundsCount) && stat.outOfBoundsCount >= 0 && stat.outOfBoundsCount <= 20) next.outOfBoundsCount = stat.outOfBoundsCount;
      if (typeof stat.notes === "string" && stat.notes.trim()) next.notes = stat.notes.trim().slice(0, 500);
      if (Object.keys(next).length) nextPlayers[playerId] = next;
    }
    if (Object.keys(nextPlayers).length) normalized[hole] = nextPlayers;
  }
  return normalized;
}

export function updateAdvancedHoleStat(
  stats: AdvancedStatsByHole,
  hole: number,
  playerId: string,
  patch: Partial<AdvancedHoleStat>,
): AdvancedStatsByHole {
  const row = { ...(stats[hole] || {}) };
  const next = { ...(row[playerId] || {}), ...patch };
  for (const key of Object.keys(next) as Array<keyof AdvancedHoleStat>) {
    if (next[key] === undefined) delete next[key];
  }
  if (Object.keys(next).length) row[playerId] = next;
  else delete row[playerId];
  if (!Object.keys(row).length) {
    const withoutHole = { ...stats };
    delete withoutHole[hole];
    return withoutHole;
  }
  return { ...stats, [hole]: row };
}

export type PlayerAdvancedStatsSummary = {
  capturedHoles: number;
  fairwaysHit: number;
  fairwayAttempts: number;
  greensInRegulation: number;
  greenAttempts: number;
  penaltyStrokes: number;
  penaltyHoles: number;
};

/** GIR is a deterministic golf fact when both score and putts are known. */
export function derivedGreenInRegulation(score: number | null | undefined, putts: number | null | undefined, par: number) {
  if (!Number.isInteger(score) || !Number.isInteger(putts) || !Number.isInteger(par) || (score as number) < 1 || (putts as number) < 0 || par < 1) return null;
  // Zero putts means the ball was holed from outside the putting green. It is
  // valid capture, but cannot be counted as a green reached in regulation.
  if (putts === 0) return false;
  return (score as number) - (putts as number) <= par - 2;
}

export function summarizePlayerAdvancedStats(
  stats: AdvancedStatsByHole | null | undefined,
  playerId: string,
  order: number[],
): PlayerAdvancedStatsSummary {
  const safeStats = normalizeAdvancedStats(stats);
  const captured = new Set<number>();
  let fairwaysHit = 0;
  let fairwayAttempts = 0;
  let greensInRegulation = 0;
  let greenAttempts = 0;
  let penaltyStrokes = 0;
  let penaltyHoles = 0;
  for (const hole of order) {
    const value = safeStats[hole]?.[playerId];
    if (!value) continue;
    if (typeof value.fairwayHit === "boolean") {
      fairwayAttempts += 1;
      if (value.fairwayHit) fairwaysHit += 1;
      captured.add(hole);
    }
    if (typeof value.greenInRegulation === "boolean") {
      greenAttempts += 1;
      if (value.greenInRegulation) greensInRegulation += 1;
      captured.add(hole);
    }
    if (typeof value.penaltyStrokes === "number") {
      penaltyStrokes += value.penaltyStrokes;
      penaltyHoles += 1;
      captured.add(hole);
    }
    if (typeof value.firstPuttDistanceFeet === "number" || typeof value.bunkerCount === "number" || typeof value.greenSideBunkerCount === "number" || typeof value.fairwayBunkerCount === "number" || typeof value.penaltyAreaCount === "number" || typeof value.teeDirection === "string" || typeof value.teeClub === "string" || typeof value.outOfBounds === "boolean" || typeof value.outOfBoundsCount === "number" || typeof value.notes === "string") {
      captured.add(hole);
    }
  }
  return { capturedHoles: captured.size, fairwaysHit, fairwayAttempts, greensInRegulation, greenAttempts, penaltyStrokes, penaltyHoles };
}
