import type { RoundSnapshot } from './types';
import { restoreRoundSnapshot } from './round-editing';

/** Same historical entity, never a completed score or settled balance. */
export function preserveUnfinishedRound(snapshot: RoundSnapshot, currentIndex: number, state: 'live' | 'cancelled', previous?: RoundSnapshot): RoundSnapshot {
  if (snapshot.cloudReadOnly || (previous && (!previous.lifecycleState || previous.lifecycleState === 'completed'))) throw new Error('No se puede reemplazar una ronda histórica terminada con un borrador. Guarda sus correcciones primero.');
  return structuredClone({ ...snapshot, lifecycleState: state, completedAt: undefined,
    pausedAt: new Date().toISOString(), resumeHoleIndex: currentIndex,
    betResult: 0, expenseTotal: 0, netResult: 0, categoryResults: {}, playerBalances: {}, categoryBalances: {},
    resultDetails: undefined, personalResults: [], personalOpponentResults: [], personalSlidingAdjustments: [],
    backyardIndexSnapshots: undefined,
  });
}

/** Reuse the app's existing draft hydrator, preserving the canonical ID/tees. */
export function unfinishedRoundDraft(snapshot: RoundSnapshot) {
  if (snapshot.lifecycleState !== 'live' && snapshot.lifecycleState !== 'cancelled') return null;
  const round = restoreRoundSnapshot(snapshot);
  if (!round) return null;
  return {
    version: 11, roundId: round.id, roundDate: round.date, startedAt: round.startedAt,
    lifecycleState: 'live', course: round.courseSnapshot, courseSelected: round.resumeCourseSelected !== false,
    players: round.players, ownerId: round.ownerId, playerTeeAssignments: round.playerTeeAssignments,
    startHole: round.startHole, roundHoles: round.roundHoles, handicapBasis: round.handicapBasis,
    presentation: round.presentation, bets: round.betConfig, segments: round.segments,
    scores: round.scores, scoreEdits: {}, putts: round.putts, scoreCaptureMode: round.scoreCaptureMode,
    advancedStats: round.advancedStats, shots: round.shots, expenses: round.expenses,
    personalBets: round.personalBets, supplementalBets: round.supplementalBets, manualBets: round.manualBets,
    unitEvents: round.unitEvents, counterBetEvents: round.counterBetEvents, counterBetKeepers: round.counterBetKeepers,
    lobaHoles: round.lobaHoles, ballFriendSetup: round.ballFriendSetup,
    scorecardPhotoIds: round.scorecardPhotoIds || (round.photoId ? [round.photoId] : []),
    currentIndex: round.resumeHoleIndex || 0, reviewPending: false,
    templateOrigin: round.groupOrigin ? { groupId: round.groupOrigin.groupId, groupNameSnapshot: round.groupOrigin.groupName,
      basedOnUpdatedAt: round.groupOrigin.basedOnUpdatedAt, roundPlayerIdByMemberId: Object.fromEntries(round.groupOrigin.selectedMembers.map(member => [member.memberId, member.roundPlayerId])) } : undefined,
  };
}
