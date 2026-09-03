import type { PollaLeaderboardPlayer, PollaLeaderboardScore } from "../../lib/polla-live";

export const polla60Players: PollaLeaderboardPlayer[] = Array.from({ length: 60 }, (_, index) => ({
  id: `player-${index + 1}`,
  name: `Jugador ${String(index + 1).padStart(2, "0")}`,
  handicap: index % 25,
  groupId: `group-${Math.floor(index / 4) + 1}`,
  groupName: `Grupo ${Math.floor(index / 4) + 1}`,
}));

export const polla18HoleCourse = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1,
  par: index % 6 === 1 || index % 6 === 4 ? 3 : index % 6 === 5 ? 5 : 4,
  strokeIndex: index + 1,
}));

export const polla60Scores: PollaLeaderboardScore[] = polla60Players.flatMap((player, playerIndex) =>
  polla18HoleCourse.map((hole) => ({
    playerId: player.id,
    hole: hole.number,
    score: Math.max(1, hole.par + ((playerIndex + hole.number) % 3) - 1),
  })),
);
