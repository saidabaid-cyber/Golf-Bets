import type { BackyardProfile } from "./account-state";
import type { FrequentPlayer, Player } from "./types";
import type { SelectedHandicapIndex } from "./handicap-source";

export function accountPrimaryPlayerId(userId: string) {
  return `account:${userId}`;
}

function validAccountProfile(profile: BackyardProfile) {
  return profile.userId !== "guest" && profile.displayName.trim().length > 0;
}

export function accountPrimaryRoundPlayer(profile: BackyardProfile, index: SelectedHandicapIndex = { source: null, value: null }): Player | null {
  if (!validAccountProfile(profile)) return null;
  return {
    id: accountPrimaryPlayerId(profile.userId),
    accountUserId: profile.userId,
    name: profile.displayName.trim(),
    handicap: index.value,
    handicapIndex: index.value,
    handicapSource: "profile_index",
    ...(index.source ? { handicapIndexSource: index.source === "GHIN" ? "GHIN_OFFICIAL_FUTURE" as const : "BACKYARD_INDEX" as const } : {}),
  };
}

/** A saved group contains an Index reference, not an already computed playing
 * handicap. Bind only this account to its canonical current Index before play;
 * preserve other members, guest HCP, runtime IDs and every started snapshot. */
export function syncAccountRoundIndex(players: Player[], userId: string, index: SelectedHandicapIndex, locked = false) {
  if (locked || !userId || userId === "guest") return players;
  const source = index.source === "GHIN" ? "GHIN_OFFICIAL_FUTURE" as const : index.source === "BACKYARD" ? "BACKYARD_INDEX" as const : undefined;
  let changed = false;
  const next = players.map(player => {
    if (player.accountUserId !== userId && player.id !== accountPrimaryPlayerId(userId)) return player;
    if (player.handicapSource === "profile_index" && player.handicapIndex === index.value && player.handicapIndexSource === source) return player;
    changed = true;
    return { ...player, handicap: index.value, handicapIndex: index.value,
      handicapSource: "profile_index" as const, handicapIndexSource: source, courseHandicapSnapshot: undefined };
  });
  return changed ? next : players;
}

/** Create or update exactly one account-owned frequent-player template.
 * Name changes never create a duplicate because identity, not display text,
 * is the durable key. Existing usage history is retained. */
export function syncAccountPrimaryFrequentPlayer(
  players: FrequentPlayer[],
  profile: BackyardProfile,
  updatedAt: string,
  index?: SelectedHandicapIndex,
) {
  const principal = accountPrimaryRoundPlayer(profile, index);
  if (!principal) return players;
  const stableId = principal.id;
  let linkedIndexes = players.flatMap((player, index) =>
    player.accountUserId === profile.userId || player.id === stableId ? [index] : [],
  );
  if (!linkedIndexes.length) {
    const normalizedName = principal.name.toLocaleLowerCase("es-MX");
    const unlinkedNameMatches = players.flatMap((player, index) =>
      !player.accountUserId && player.name.trim().toLocaleLowerCase("es-MX") === normalizedName ? [index] : [],
    );
    // A single legacy local template with the exact profile name can be
    // adopted safely. Ambiguous same-name people remain separate.
    if (unlinkedNameMatches.length === 1) linkedIndexes = unlinkedNameMatches;
  }
  const existing = linkedIndexes.length ? players[linkedIndexes[0]] : undefined;
  const next: FrequentPlayer = {
    ...existing,
    // Preserve an adopted legacy local_id so cloud sync updates that record
    // instead of creating a second row under a new id.
    id: existing?.id || stableId,
    accountUserId: profile.userId,
    name: principal.name,
    handicap: principal.handicapIndex ?? principal.handicap,
    uses: existing?.uses ?? 0,
    updatedAt,
  };
  if (linkedIndexes.length === 1 && existing
    && existing.id === next.id
    && existing.name === next.name
    && existing.handicap === next.handicap
    && existing.accountUserId === next.accountUserId) return players;
  const linked = new Set(linkedIndexes);
  return [next, ...players.filter((_, index) => !linked.has(index))];
}

/** Profile/provider hydration may change presentation, never saved usage,
 * identity, order or clocks. A real round save/edit persists templates through
 * the existing explicit mutation functions. */
export function projectAccountPrimaryFrequentPlayers(players: FrequentPlayer[], profile: BackyardProfile, index: SelectedHandicapIndex) {
  const principal = accountPrimaryRoundPlayer(profile, index);
  if (!principal) return players;
  return players.map(player => player.accountUserId === profile.userId || player.id === principal.id
    ? { ...player, name: principal.name, handicap: principal.handicap } : player);
}

/** Keep a linked in-progress player name coherent with the account profile.
 * Round HCP is intentionally preserved because it belongs to that round. */
export function syncLinkedRoundPlayerName(players: Player[], profile: BackyardProfile) {
  if (!validAccountProfile(profile)) return players;
  const name = profile.displayName.trim();
  let changed = false;
  const next = players.map((player) => {
    const linked = player.accountUserId === profile.userId || player.id === accountPrimaryPlayerId(profile.userId);
    if (!linked || (player.name === name && player.accountUserId === profile.userId)) return player;
    changed = true;
    return { ...player, accountUserId: profile.userId, name };
  });
  return changed ? next : players;
}
