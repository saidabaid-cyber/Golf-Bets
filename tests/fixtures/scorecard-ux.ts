import type { AdvancedStatsByHole, Course, Player, PuttsByHole } from "../../lib/types";
import type { QuickEditAccess } from "../../lib/premium-scorecard";
import type { ScoreRows } from '../../lib/score-capture';

/** Controlled UI fixture. Never imports auth, cloud, storage, HCP or real accounts. */
export const qaPlayer: Player = { id: 'qa-owner', name: 'Jugador de prueba', handicap: 0, accountUserId: 'qa-memory-only' };
export const qaOther: Player = { id: 'qa-other', name: 'Otro jugador de prueba', handicap: 0, accountUserId: 'qa-other-only' };
export const qaCourse: Course = {
  id: 'qa-course', name: 'Campo de prueba — Nombre largo para verificar la legibilidad de la tarjeta', teeName: 'Tee de prueba',
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: i === 2 || i === 11 ? 3 : i === 8 || i === 17 ? 5 : 4, yards: i === 2 || i === 11 ? 165 : 362 + i * 7, strokeIndex: i + 1 })),
};
export const qaOrder = qaCourse.holes.map(h => h.number);
export const qaScores: ScoreRows = Object.fromEntries(qaCourse.holes.map(h => [h.number, { [qaPlayer.id]: h.par + (h.number === 1 ? -1 : h.number === 4 ? 1 : h.number === 5 ? 2 : h.number === 10 ? -2 : 0), [qaOther.id]: h.par + 1 }]));
export const qaPutts: PuttsByHole = Object.fromEntries(qaOrder.filter(n => n !== 6).map(n => [n, { [qaPlayer.id]: n === 1 ? 0 : 2 }]));
export const qaAdvanced: AdvancedStatsByHole = Object.fromEntries(qaCourse.holes.filter(h => h.number !== 6).map(h => [h.number, { [qaPlayer.id]: {
  ...(h.par !== 3 ? { fairwayHit: h.number !== 4 } : {}), teeDirection: h.number === 4 ? 'left' : 'center',
  greenInRegulation: h.number !== 4, penaltyStrokes: h.number === 5 ? 1 : 0, teeClub: h.par === 3 ? '8i' : 'Driver',
  firstPuttDistanceFeet: h.number === 1 ? 0 : 15, outOfBoundsCount: h.number === 5 ? 1 : 0,
} }]));
export const qaAccess: QuickEditAccess = { currentDraft: true, roundId: 'qa-memory-round', lifecycle: 'live', readOnly: false, closed: false, ownerId: qaPlayer.id, accountUserId: qaPlayer.accountUserId, organizerAccountUserId: qaPlayer.accountUserId };
