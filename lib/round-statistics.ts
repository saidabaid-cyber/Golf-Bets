import { derivedGreenInRegulation, normalizeAdvancedStats } from "./advanced-stats";
import type { AdvancedStatsByHole, Course, HoleScore, PuttsByHole } from "./types";

export type RoundStatHole = {
  hole: number;
  par: number;
  score: number | null;
  putts: number | null;
  teeDirection: string | null;
  teeClub: string | null;
  greenSideBunkers: number;
  fairwayBunkers: number;
  penaltyAreas: number;
  outOfBounds: number;
  gir: boolean | null;
};

export function buildPlayerRoundStats(input: {
  playerId: string;
  course: Course;
  order: readonly number[];
  scores: Readonly<Record<number, HoleScore>>;
  putts?: PuttsByHole;
  advancedStats?: AdvancedStatsByHole;
}) {
  const stats = normalizeAdvancedStats(input.advancedStats);
  const holes: RoundStatHole[] = input.order.flatMap((holeNumber) => {
    const hole = input.course.holes.find((candidate) => candidate.number === holeNumber);
    if (!hole) return [];
    const score = input.scores[holeNumber]?.[input.playerId];
    const putts = input.putts?.[holeNumber]?.[input.playerId];
    const advanced = stats[holeNumber]?.[input.playerId] || {};
    const greenSideBunkers = advanced.greenSideBunkerCount ?? advanced.bunkerCount ?? 0;
    const fairwayBunkers = advanced.fairwayBunkerCount ?? 0;
    return [{
      hole: holeNumber,
      par: hole.par,
      score: typeof score === "number" ? score : null,
      putts: typeof putts === "number" ? putts : null,
      teeDirection: advanced.teeDirection || null,
      teeClub: advanced.teeClub || null,
      greenSideBunkers,
      fairwayBunkers,
      penaltyAreas: advanced.penaltyAreaCount ?? advanced.penaltyStrokes ?? 0,
      outOfBounds: advanced.outOfBoundsCount ?? (advanced.outOfBounds ? 1 : 0),
      gir: derivedGreenInRegulation(score, putts, hole.par),
    }];
  });
  const front = holes.slice(0, Math.min(9, holes.length));
  const back = holes.slice(9);
  const sum = (rows: readonly RoundStatHole[], field: "score" | "putts") => rows.reduce((total, row) => total + (row[field] ?? 0), 0);
  const captured = (rows: readonly RoundStatHole[], field: "score" | "putts") => rows.filter((row) => row[field] !== null).length;
  const girRows = holes.filter((hole) => hole.gir !== null);
  const driving = holes.filter((hole) => hole.par !== 3 && hole.teeDirection !== null);
  return {
    holes,
    totals: {
      out: { score: sum(front, "score"), putts: sum(front, "putts"), scoreHoles: captured(front, "score"), puttHoles: captured(front, "putts") },
      in: { score: sum(back, "score"), putts: sum(back, "putts"), scoreHoles: captured(back, "score"), puttHoles: captured(back, "putts") },
      total: { score: sum(holes, "score"), putts: sum(holes, "putts"), scoreHoles: captured(holes, "score"), puttHoles: captured(holes, "putts") },
    },
    summary: {
      fairwaysHit: driving.filter((hole) => hole.teeDirection === "center").length,
      fairwayAttempts: driving.length,
      gir: girRows.filter((hole) => hole.gir).length,
      girAttempts: girRows.length,
      putts: sum(holes, "putts"),
      puttHoles: captured(holes, "putts"),
      bunkers: holes.reduce((total, hole) => total + hole.greenSideBunkers + hole.fairwayBunkers, 0),
      penaltyAreas: holes.reduce((total, hole) => total + hole.penaltyAreas, 0),
      outOfBounds: holes.reduce((total, hole) => total + hole.outOfBounds, 0),
    },
  };
}
