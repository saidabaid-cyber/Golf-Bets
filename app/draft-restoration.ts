import { accountPrimaryPlayerId } from "../lib/account-primary-player";
import type { Player } from "../lib/types";

type RoundDraftCore = {
  startHole?: unknown;
  roundHoles?: unknown;
  ownerId?: unknown;
  players?: unknown;
};

/** Resolves fields that must never leak from the previously rendered round. */
export function resolveRoundDraftCore(draft: RoundDraftCore, userId: string) {
  const players = Array.isArray(draft.players)
    ? draft.players.filter((player): player is Player => Boolean(
        player
        && typeof player === "object"
        && typeof (player as Partial<Player>).id === "string"
        && Boolean((player as Partial<Player>).id?.trim())
        && typeof (player as Partial<Player>).name === "string",
      ))
    : [];
  const savedOwnerId = typeof draft.ownerId === "string"
    && players.some((player) => player.id === draft.ownerId)
    ? draft.ownerId
    : "";
  const accountOwner = players.find((player) =>
    player.accountUserId === userId
    || player.id === userId
    || player.id === accountPrimaryPlayerId(userId),
  );

  return {
    startHole: draft.startHole === 10 ? 10 as const : 1 as const,
    roundHoles: draft.roundHoles === 9 ? 9 as const : 18 as const,
    players,
    ownerId: savedOwnerId || accountOwner?.id || players[0]?.id || "",
  };
}
