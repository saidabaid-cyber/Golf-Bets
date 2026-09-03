import type { Course, HoleScore, Player } from "./types";

export type ScoreRows = Record<number, HoleScore>;

/** Capture is a draft. Only commitHoleCapture may replace an official row.
 * Missing values suggest par; explicitly cleared inputs remain empty. */
export function holeCapture(scores: ScoreRows, edits: ScoreRows, hole: Pick<Course["holes"][number], "number" | "par">, players: Player[]): HoleScore {
  return Object.fromEntries(players.map(player => {
    const row = edits[hole.number] || {};
    const value = Object.hasOwn(row, player.id) ? row[player.id] : scores[hole.number]?.[player.id] ?? hole.par;
    return [player.id, value];
  }));
}

export function editCapturedScore(edits: ScoreRows, hole: number, player: string, value: number | null): ScoreRows {
  return { ...edits, [hole]: { ...edits[hole], [player]: value === null ? null : Math.max(1, Math.trunc(value)) } };
}

/** A suggested par is not a played score. The row is ready only after it was
 * previously saved or every player explicitly confirmed/edited this hole. */
export function isHoleCaptureComplete(scores: ScoreRows, edits: ScoreRows, hole: number, players: Player[]): boolean {
  if (!players.length) return false;
  const saved = players.every(player => typeof scores[hole]?.[player.id] === "number");
  const explicitlyCaptured = players.every(player => typeof edits[hole]?.[player.id] === "number");
  return saved || explicitlyCaptured;
}

export function commitHoleCapture(scores: ScoreRows, edits: ScoreRows, hole: Pick<Course["holes"][number], "number" | "par">, players: Player[]) {
  const row = holeCapture(scores, edits, hole, players);
  if (!players.length || Object.values(row).some(value => typeof value !== "number" || !Number.isInteger(value) || value < 1)) return null;
  const remaining = { ...edits };
  delete remaining[hole.number];
  return { scores: { ...scores, [hole.number]: { ...scores[hole.number], ...row } }, edits: remaining };
}
