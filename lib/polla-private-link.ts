import type { HoleScore, Player } from "./types";
import type { PendingPollaScore } from "./polla-offline";

export const PRIVATE_POLLA_LINK_KEY = "golfbets-private-polla-link-v1";

export type PrivatePollaLink = {
  tournamentId: string;
  groupId: string;
  accessToken: string;
  playerMap: Record<string, string>;
  linkedAt: string;
};

type TournamentMember = { id: string; name: string };

function nameKey(name: string) {
  return name.trim().toLocaleLowerCase("es-MX");
}

export function createPrivatePollaLink(
  localPlayers: Player[],
  tournamentMembers: TournamentMember[],
  session: { tournament_id: string; group_id: string; access_token: string },
  linkedAt = new Date().toISOString(),
): { link?: PrivatePollaLink; unmatched: string[]; ambiguous: string[] } {
  const tournamentByName = new Map<string, TournamentMember[]>();
  for (const member of tournamentMembers) tournamentByName.set(nameKey(member.name), [...(tournamentByName.get(nameKey(member.name)) || []), member]);
  const playerMap: Record<string, string> = {};
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const player of localPlayers.filter((item) => item.name.trim())) {
    const matches = tournamentByName.get(nameKey(player.name)) || [];
    if (!matches.length) unmatched.push(player.name);
    else if (matches.length > 1) ambiguous.push(player.name);
    else playerMap[player.id] = matches[0].id;
  }
  if (unmatched.length || ambiguous.length || !Object.keys(playerMap).length) return { unmatched, ambiguous };
  return {
    link: {
      tournamentId: session.tournament_id,
      groupId: session.group_id,
      accessToken: session.access_token,
      playerMap,
      linkedAt,
    },
    unmatched,
    ambiguous,
  };
}

export function parsePrivatePollaLink(raw: string | null): PrivatePollaLink | null {
  try {
    const value = JSON.parse(raw || "null") as Partial<PrivatePollaLink> | null;
    if (!value || typeof value.tournamentId !== "string" || typeof value.groupId !== "string" || typeof value.accessToken !== "string" || !value.playerMap || typeof value.playerMap !== "object") return null;
    return { tournamentId: value.tournamentId, groupId: value.groupId, accessToken: value.accessToken, playerMap: value.playerMap, linkedAt: typeof value.linkedAt === "string" ? value.linkedAt : "" };
  } catch { return null; }
}

export function privatePollaScoreChanges(link: PrivatePollaLink, hole: number, scores: HoleScore, queuedAt = new Date().toISOString()) {
  return Object.entries(link.playerMap).flatMap(([localPlayerId, tournamentPlayerId]): PendingPollaScore[] => {
    const score = scores[localPlayerId];
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 20) return [];
    return [{
      id: `${link.tournamentId}:${tournamentPlayerId}:${hole}:${queuedAt}`,
      tournamentId: link.tournamentId,
      groupId: link.groupId,
      playerId: tournamentPlayerId,
      hole,
      score,
      queuedAt,
    }];
  });
}
