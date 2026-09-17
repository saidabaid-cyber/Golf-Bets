import type { RoundSnapshot } from "./types";

/** Read-side attribution only. The cloud reader sets this proof after RLS and
 * SELF_CONFIRMED + canonical player checks; it is never an ownership grant. */
export function confirmedHistoryPlayer(round: RoundSnapshot, userId?: string) {
  const proof = round.cloudParticipant;
  if (!round.cloudReadOnly || !round.cloudRoundId || !round.cloudSourceLocalId
    || round.id !== `shared:${round.cloudRoundId}` || !proof
    || (userId !== undefined && proof.accountUserId !== userId)) return null;
  const players = round.players?.filter(p => p.accountUserId === proof.accountUserId);
  return players?.length === 1 && players[0].id === proof.playerId ? players[0] : null;
}

export function attributableHistory(rounds: readonly RoundSnapshot[], userId?: string) {
  return rounds.filter(round => !round.cloudReadOnly && !round.id.startsWith("shared:")
    || Boolean(confirmedHistoryPlayer(round, userId)));
}

/** Ephemeral analytical perspective, never written back. Do not attribute the
 * organizer's expenses/personal side bets to a participant. Unknown != zero. */
export function personalRoundPerspective(round: RoundSnapshot): RoundSnapshot | null {
  if (!round.cloudReadOnly && !round.id.startsWith("shared:")) return round;
  const player = confirmedHistoryPlayer(round);
  if (!player) return null;
  const { expenses: _expenses, expenseTotal: _expenseTotal, netResult: _netResult,
    betResult: _betResult, personalResults: _personalResults,
    personalOpponentResults: _personalOpponents, categoryResults: _categories, ...source } = round;
  void [_expenses, _expenseTotal, _netResult, _betResult, _personalResults, _personalOpponents, _categories];
  return { ...source, ownerId: player.id, ownerName: player.name,
    // No expense evidence exists for this participant. Recap safely omits it.
    snapshotVersion: undefined,
    betResult: round.playerBalances?.[player.id],
    categoryResults: Object.fromEntries(Object.entries(round.categoryBalances || {})
      .filter(([, balances]) => Number.isFinite(balances[player.id]))
      .map(([key, balances]) => [key, balances[player.id]])),
  } as RoundSnapshot;
}
