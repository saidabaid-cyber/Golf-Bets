import type { RoundSnapshot } from "./types";

export type SharedRoundCard = {
  roundId: string; localRoundId: string; version: number; materialHash: string;
  courseName: string; groupName: string | null; date: string; completed: boolean;
  players: Array<{ playerKey: string; name: string; accountUserId: string | null;
    score: number | null; status: "CONFIRMED" | "PENDING_CONFIRMATION" | "GUEST";
    scorecard: Array<{ hole: number; score: number | null }> }>;
  myPlayerKey: string | null; myBalance: number | null; canConfirm: boolean;
  scorekeeping: "owner" | "self";
  ghin: { canPostOwnScore: false; canPostScoreForAnotherUser: false };
};

/** Names are snapshots, never authority. An ambiguous roster cannot be shared. */
export function linkedRoundPlayers(round: Pick<RoundSnapshot, "players">) {
  const keys = new Set<string>(); const accounts = new Set<string>();
  for (const player of round.players || []) {
    if (!player.id || keys.has(player.id)) throw new Error("DUPLICATE_ROUND_PLAYER");
    keys.add(player.id);
    if (player.accountUserId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(player.accountUserId)
        || accounts.has(player.accountUserId)) throw new Error("DUPLICATE_ROUND_ACCOUNT");
      accounts.add(player.accountUserId);
    }
  }
  return (round.players || []).filter(player => Boolean(player.accountUserId));
}

export function participantCard(roundId: string, ownerId: string, version: number, materialHash: string,
  snapshot: RoundSnapshot, viewerId: string, confirmed: ReadonlySet<string>): SharedRoundCard {
  linkedRoundPlayers(snapshot);
  const mine = snapshot.players?.find(player => player.accountUserId === viewerId);
  if (ownerId !== viewerId && !mine) throw new Error("PARTICIPANT_NOT_LINKED");
  const completed = snapshot.lifecycleState === "completed" && Boolean(snapshot.completedAt);
  const holes = snapshot.order || Object.keys(snapshot.scores || {}).map(Number).sort((a, b) => a - b);
  return {
    roundId, localRoundId: snapshot.id, version, materialHash, courseName: snapshot.courseName,
    groupName: snapshot.groupOrigin?.groupName || null, date: snapshot.date, completed,
    players: (snapshot.players || []).map(player => {
      const scorecard = holes.map(hole => ({ hole, score: Number.isFinite(snapshot.scores?.[hole]?.[player.id]) ? snapshot.scores![hole][player.id] : null }));
      return { playerKey: player.id, name: player.name, accountUserId: player.accountUserId || null,
        score: scorecard.length && scorecard.every(hole => hole.score !== null) ? scorecard.reduce((sum, hole) => sum + hole.score!, 0) : null,
        status: !player.accountUserId ? "GUEST" : player.accountUserId === ownerId || confirmed.has(player.accountUserId) ? "CONFIRMED" : "PENDING_CONFIRMATION",
        scorecard };
    }),
    myPlayerKey: mine?.id || null, myBalance: mine && completed && Number.isFinite(snapshot.playerBalances?.[mine.id]) ? snapshot.playerBalances![mine.id] : null,
    canConfirm: completed && ownerId !== viewerId && Boolean(mine) && !confirmed.has(viewerId),
    scorekeeping: snapshot.scorekeeping?.mode || "owner", ghin: { canPostOwnScore: false, canPostScoreForAnotherUser: false },
  };
}
