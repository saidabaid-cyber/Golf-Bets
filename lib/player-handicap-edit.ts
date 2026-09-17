import type { Player } from "./types";

/** Identity, not a cached/source label, determines whether manual editing is allowed. */
export function canEditGuestHandicap(player: { accountUserId?: string | null }) {
  return !player.accountUserId;
}

export function playerHandicapSourceLabel(player: Pick<Player, "accountUserId" | "handicap" | "handicapIndex" | "handicapIndexSource">) {
  if (canEditGuestHandicap(player)) return "HCP manual · Invitado";
  const source = player.handicapIndexSource === "GHIN_OFFICIAL_FUTURE" ? "GHIN" : "Backyard";
  return typeof (player.handicapIndex ?? player.handicap) === "number"
    ? `${player.handicapIndex !== undefined ? `Index ${player.handicapIndex}` : `HCP ${player.handicap}`} · ${source}`
    : `Sin HCP ${source}`;
}

/** Round-only immutable patch. It has no reference to a saved group/template. */
export function patchEditablePlayer(player: Player, patch: Partial<Player>): Player {
  const safe = { ...patch };
  if (!canEditGuestHandicap(player)) {
    delete safe.handicap;
    delete safe.handicapSource;
    delete safe.handicapIndex;
    delete safe.handicapIndexSource;
    delete safe.courseHandicapSnapshot;
  }
  return { ...player, ...safe };
}
