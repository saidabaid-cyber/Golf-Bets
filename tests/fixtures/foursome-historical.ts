import type { Course, FoursomeSegment, HoleScore, Player } from "../../lib/types";

export const historicalFoursomePlayers: Player[] = [
  { id: "said", name: "Said", handicap: 0 },
  { id: "cuau", name: "Cuau", handicap: 11 },
  { id: "armando", name: "Armando", handicap: 7 },
  { id: "jesus", name: "Jesús", handicap: 2 },
  { id: "raul", name: "Raúl", handicap: 11 },
];

export const historicalFoursomeCourse: Course = {
  id: "historical-foursome",
  name: "Caso histórico Foursome",
  teeName: "General",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

const rows = [
  [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 3, 4], [2, 2, 3, 3, 4],
  [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 3, 5, 4, 5], [2, 3, 5, 4, 4],
  [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2], [2, 2, 2, 3, 2], [3, 4, 3, 4, 2],
];

export const historicalFoursomeScores: Record<number, HoleScore> = Object.fromEntries(rows.map((values, index) => [
  index + 1,
  Object.fromEntries(historicalFoursomePlayers.map((player, playerIndex) => [player.id, values[playerIndex]])),
]));

export const historicalFoursomeSegments: FoursomeSegment[] = [
  { id: "seg-0", startIndex: 0, endIndex: 5, basePair: ["said", "cuau"] },
  { id: "seg-6", startIndex: 6, endIndex: 11, basePair: ["cuau", "armando"] },
  { id: "seg-12", startIndex: 12, endIndex: 17, basePair: ["jesus", "said"] },
];

export const historicalFoursomeMatchPoints = [1, -1, 2, 2, -2, 1, -1, -2, -3];
