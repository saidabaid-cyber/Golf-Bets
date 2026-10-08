import { normalizeAdvancedStats, updateAdvancedHoleStat } from "./advanced-stats";
import { commitHoleCapture, editCapturedScore, type ScoreRows } from "./score-capture";
import type { AdvancedHoleStat, AdvancedStatsByHole, Course, Hole, Player, PuttsByHole, RoundLifecycleState } from "./types";

export type GolfResult = "eagle" | "birdie" | "par" | "bogey" | "double" | "pending";
export const GOLF_RESULT_LABELS: Record<GolfResult, string> = {
  eagle: "Eagle o mejor", birdie: "Birdie", par: "Par", bogey: "Bogey", double: "Doble bogey o más", pending: "Sin score",
};
export function recordedNumber(value: unknown, min = 0, max = 100): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}
export function golfResult(score: unknown, par: unknown): GolfResult {
  const gross = recordedNumber(score, 1), target = recordedNumber(par, 3, 6);
  if (gross === null || target === null) return "pending";
  const delta = gross - target;
  return delta <= -2 ? "eagle" : delta === -1 ? "birdie" : delta === 0 ? "par" : delta === 1 ? "bogey" : "double";
}
export const toParText = (value: number | null) => value === null ? "—" : value === 0 ? "E" : `${value > 0 ? "+" : "−"}${Math.abs(value)}`;
export type ScorecardCell = {
  hole: Hole; score: number | null; putts: number | null; stat: AdvancedHoleStat;
  fir: boolean | null; gir: boolean | null; result: GolfResult;
};
export type RecordedTotal = { value: number | null; captured: number; possible: number };
export type ScorecardSummary = {
  par: number; gross: number | null; toPar: number | null; scored: number; holes: number;
  putts: RecordedTotal; fir: RecordedTotal; gir: RecordedTotal; penalties: RecordedTotal;
};
export function scorecardCells(input: { course: Course; playerId: string; order: readonly number[]; scores: ScoreRows; putts?: PuttsByHole; advancedStats?: AdvancedStatsByHole }): ScorecardCell[] {
  const definitions = new Map((input.course.playerHoleCards?.[input.playerId] ?? input.course.holes).map(h => [h.number, h]));
  const stats = normalizeAdvancedStats(input.advancedStats);
  return [...new Set(input.order)].flatMap(number => {
    const hole = definitions.get(number);
    if (!hole || recordedNumber(hole.par, 3, 6) === null) return [];
    const score = recordedNumber(input.scores[number]?.[input.playerId], 1);
    const stat = stats[number]?.[input.playerId] ?? {};
    return [{ hole, score, putts: recordedNumber(input.putts?.[number]?.[input.playerId], 0, 50), stat,
      fir: hole.par === 3 || typeof stat.fairwayHit !== "boolean" ? null : stat.fairwayHit,
      // Only a captured GIR is displayed. A final score alone proves nothing.
      gir: typeof stat.greenInRegulation === "boolean" ? stat.greenInRegulation : null,
      result: golfResult(score, hole.par) }];
  });
}
function total(values: Array<number | null>, possible = values.length): RecordedTotal {
  const recorded = values.filter((value): value is number => value !== null);
  return { value: recorded.length ? recorded.reduce((sum, value) => sum + value, 0) : null, captured: recorded.length, possible };
}
export function summarizeScorecard(cells: readonly ScorecardCell[]): ScorecardSummary {
  const entered = cells.filter(cell => cell.score !== null);
  const gross = entered.length ? entered.reduce((sum, cell) => sum + cell.score!, 0) : null;
  const fairways = cells.filter(cell => cell.hole.par !== 3);
  return { par: cells.reduce((sum, cell) => sum + cell.hole.par, 0), gross,
    toPar: gross === null ? null : gross - entered.reduce((sum, cell) => sum + cell.hole.par, 0), scored: entered.length, holes: cells.length,
    putts: total(cells.map(cell => cell.putts)),
    fir: total(fairways.map(cell => cell.fir === null ? null : Number(cell.fir)), fairways.length),
    gir: total(cells.map(cell => cell.gir === null ? null : Number(cell.gir))),
    penalties: total(cells.map(cell => recordedNumber(cell.stat.penaltyStrokes, 0, 50))) };
}
export type QuickHoleDraft = { score: number | null; putts: number | null; advanced: AdvancedHoleStat };
export type QuickEditAccess = {
  currentDraft: boolean; roundId: string; lifecycle?: RoundLifecycleState; readOnly: boolean; closed: boolean;
  ownerId: string; accountUserId?: string; organizerAccountUserId?: string;
};
export function canQuickEditPlayer(access: QuickEditAccess, player: Player) {
  if (!access.currentDraft || access.readOnly || access.closed || access.lifecycle === "cancelled"
    || /^(shared:|ghin:)/i.test(access.roundId) || player.id !== access.ownerId) return false;
  if (access.organizerAccountUserId && access.organizerAccountUserId !== access.accountUserId) return false;
  // Account-linked players must belong to this session; local guests use the existing owner workspace.
  return !player.accountUserId || player.accountUserId === access.accountUserId;
}
export function quickDraftErrors(draft: QuickHoleDraft) {
  const errors: string[] = [];
  if (recordedNumber(draft.score, 1) === null) errors.push("Captura un score entre 1 y 100.");
  if (draft.putts !== null && recordedNumber(draft.putts, 0, 50) === null) errors.push("Revisa los putts: usa un valor entre 0 y 50.");
  if (draft.putts !== null && draft.score !== null && draft.putts > draft.score) errors.push("Los putts no pueden superar el score.");
  for (const [key, max, label, integer] of [
    ["penaltyStrokes", 50, "penalidades", true], ["bunkerCount", 20, "bunker", true],
    ["penaltyAreaCount", 20, "área de penalidad", true], ["outOfBoundsCount", 20, "OB", true],
    ["teeDistance", 600, "distancia de salida", false], ["firstPuttDistanceFeet", 300, "primer putt", false],
  ] as const) {
    const value = draft.advanced[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value)))) errors.push(`Revisa ${label}: usa un valor entre 0 y ${max}.`);
  }
  return errors;
}
/** Compose one confirmed hole through the existing capture/normalization domain.
 * The caller persists the whole draft with the existing durability/outbox boundary. */
export function prepareQuickHole(input: { access: QuickEditAccess; player: Player; hole: Hole; scores: ScoreRows; edits: ScoreRows; putts: PuttsByHole; advancedStats: AdvancedStatsByHole; draft: QuickHoleDraft }) {
  if (!canQuickEditPlayer(input.access, input.player)) throw new Error("Esta tarjeta es de solo lectura.");
  const errors = quickDraftErrors(input.draft);
  if (errors.length) throw new Error(errors.join(" "));
  const { number } = input.hole, id = input.player.id;
  const committed = commitHoleCapture(input.scores, editCapturedScore(input.edits, number, id, input.draft.score), input.hole, [input.player]);
  if (!committed) throw new Error("No pudimos confirmar el score del hoyo.");
  // commitHoleCapture clears the hole draft; preserve pending edits belonging to other players.
  const otherEdits = { ...(input.edits[number] ?? {}) }; delete otherEdits[id];
  if (Object.keys(otherEdits).length) committed.edits[number] = otherEdits;
  const puttRow = { ...(input.putts[number] ?? {}) };
  if (input.draft.putts === null) delete puttRow[id]; else puttRow[id] = input.draft.putts;
  const nextPutts = { ...input.putts, [number]: puttRow };
  const prior = input.advancedStats[number]?.[id] ?? {};
  const safe = normalizeAdvancedStats({ [number]: { [id]: input.draft.advanced } })[number]?.[id] ?? {};
  if (input.hole.par === 3) delete safe.fairwayHit;
  const patch: Partial<AdvancedHoleStat> = { ...Object.fromEntries(Object.keys(prior).map(key => [key, undefined])), ...safe };
  return { ...committed, putts: nextPutts, advancedStats: updateAdvancedHoleStat(input.advancedStats, number, id, patch) };
}
