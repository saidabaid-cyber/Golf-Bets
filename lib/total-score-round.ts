import type { Course, Player, RoundSnapshot } from "./types";
import { initialBets } from "./new-round-bets";
import { assignTeeToEveryPlayer } from "./player-tee-assignments";

export function totalScoreOrder(holes: 9 | 18, start: 1 | 10) {
  return Array.from({ length: holes }, (_, i) => ((start - 1 + i) % 18) + 1);
}
export function validTotalOnly(round: RoundSnapshot, accountUserId: string): boolean {
  const capture = round.totalScoreCapture;
  return Boolean(capture?.version === 1 && !capture.holesCompletedAt && Number.isInteger(capture.grossTotal)
    && round.lifecycleState === "completed" && [9,18].includes(round.roundHoles || 0)
    && capture.grossTotal >= round.roundHoles! && capture.grossTotal <= round.roundHoles! * 30
    && round.players?.length === 1 && round.players[0].id === round.ownerId && round.players[0].accountUserId === accountUserId
    && round.scores && Object.keys(round.scores).length === 0 && round.courseSnapshot
    && JSON.stringify(round.order) === JSON.stringify(totalScoreOrder(round.roundHoles!, round.startHole === 10 ? 10 : 1)));
}
export function createTotalScoreRound(input: { id: string; course: Course; player: Player; date: string; holes: 9 | 18; start: 1 | 10; total: number; now: string }): RoundSnapshot {
  const { id, course, player, date, holes, start, total, now } = input;
  if (!id || !player.accountUserId || !player.name.trim() || !course.name.trim() || !course.teeName.trim()) throw new Error("Selecciona campo, tee y jugador.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date > now.slice(0,10)) throw new Error("Elige una fecha válida, no futura.");
  if (![9,18].includes(holes) || ![1,10].includes(start) || !Number.isInteger(total) || total < holes || total > holes * 30) throw new Error("Revisa hoyos y total de golpes.");
  const order = totalScoreOrder(holes, start);
  if (order.some(number => !course.holes.some(h => h.number === number))) throw new Error("El campo no tiene datos para esta vuelta. Selecciona una vuelta disponible.");
  return {
    id, snapshotVersion: 2, lifecycleState: "completed", date, completedAt: now, updatedAt: now,
    courseName: course.name, teeName: course.teeName, courseSnapshot: structuredClone(course),
    ownerId: player.id, ownerName: player.name, players: [structuredClone(player)],
    roundHoles: holes, startHole: start, order, scores: {}, putts: {}, advancedStats: {}, scoreCaptureMode: "quick",
    totalScoreCapture: { version: 1, grossTotal: total, enteredAt: now },
    presentation: { version: 1, groupNassauTerm: "polla", playMode: "score_only" },
    playerTeeAssignments: assignTeeToEveryPlayer([player], course, now),
    betConfig: initialBets([player.id]), personalBets: [], supplementalBets: [], manualBets: [],
    betResult: 0, netResult: 0, expenseTotal: 0, categoryResults: {},
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
  };
}

/** Same immutable identity/history entry. No synthetic putts, pars, handicap or index evidence. */
export function completeTotalScoreHoles(round: RoundSnapshot, rows: Record<number, number>, now: string): RoundSnapshot {
  if (!round.totalScoreCapture || round.cloudReadOnly || !round.ownerId || !round.order || ![9,18].includes(round.order.length)) throw new Error("Esta tarjeta no puede completarse aquí.");
  const values = round.order.map(h => rows[h]);
  if (values.some(n => !Number.isInteger(n) || n < 1 || n > 30)) throw new Error("Captura todos los hoyos con scores válidos.");
  const sum = values.reduce((a,b) => a+b,0);
  if (sum !== round.totalScoreCapture.grossTotal) throw new Error(`Los hoyos suman ${sum}; el total declarado es ${round.totalScoreCapture.grossTotal}. Revisa la captura antes de guardar.`);
  return { ...structuredClone(round), scores: Object.fromEntries(round.order.map(h => [h, { [round.ownerId!]: rows[h] }])), updatedAt: now, totalScoreCapture: { ...round.totalScoreCapture, holesCompletedAt: now } };
}
