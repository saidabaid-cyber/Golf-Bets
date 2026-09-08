import type { FrequentGroup, FrequentGroupMember, FrequentPlayer, PersonalBet, Player, SavedPersonalRival } from "./types";
import { accountPrimaryPlayerId } from "./account-primary-player";
import { normalizePlayerName } from "./group-generator";
import { normalizeGroupGameTemplate } from "./group-game-template";

export type { FrequentGroupMember } from "./types";

function memberKey(name: string) {
  return normalizePlayerName(name);
}

function accountKey(accountUserId: string | undefined) {
  return accountUserId?.trim() || "";
}

function cleanGroupMember(
  member: Partial<FrequentGroupMember> | null | undefined,
  fallbackMemberId = "",
): FrequentGroupMember | null {
  if (typeof member?.name !== "string") return null;
  const name = member.name.trim();
  if (!name) return null;
  const handicap = typeof member.handicap === "number" && Number.isFinite(member.handicap) && member.handicap >= -15 && member.handicap <= 54
    ? member.handicap
    : null;
  const accountUserId = typeof member.accountUserId === "string" && member.accountUserId.trim().length <= 200
    ? member.accountUserId.trim()
    : "";
  const memberIdCandidate = typeof member.memberId === "string" ? member.memberId.trim() : fallbackMemberId;
  const memberId = memberIdCandidate && !/\s/.test(memberIdCandidate) && memberIdCandidate.length <= 200 ? memberIdCandidate : "";
  const kind = member.kind === "account" || member.kind === "friend" || member.kind === "invited" || member.kind === "guest"
    ? member.kind
    : undefined;
  const username = typeof member.username === "string" ? member.username.trim().slice(0, 80) : "";
  const email = typeof member.email === "string" ? member.email.trim().toLowerCase().slice(0, 254) : "";
  return {
    name,
    handicap,
    ...(accountUserId ? { accountUserId } : {}),
    ...(memberId ? { memberId } : {}),
    ...(kind ? { kind } : {}),
    ...(username ? { username } : {}),
    ...(email ? { email } : {}),
  };
}

function membersConflict(first: FrequentGroupMember, second: FrequentGroupMember) {
  const firstAccount = accountKey(first.accountUserId);
  const secondAccount = accountKey(second.accountUserId);
  return memberKey(first.name) === memberKey(second.name)
    || Boolean(firstAccount && secondAccount && firstAccount === secondAccount)
    || Boolean(first.memberId && second.memberId && first.memberId === second.memberId)
    || Boolean(first.email && second.email && first.email === second.email);
}

function cleanUniqueGroupMembers(members: readonly Partial<FrequentGroupMember>[], fallbackPrefix = "") {
  const players: FrequentGroupMember[] = [];
  let invalid = false;
  for (const [index, member] of members.entries()) {
    const cleaned = cleanGroupMember(member, fallbackPrefix ? `${fallbackPrefix}-member-${index + 1}` : "");
    if (!cleaned) { invalid = true; continue; }
    if (players.some((candidate) => membersConflict(candidate, cleaned))) { invalid = true; continue; }
    players.push(cleaned);
  }
  return { players, invalid };
}

export function parseFrequentGroups(raw: string | null | undefined): FrequentGroup[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const group = value as Partial<FrequentGroup>;
      const name = typeof group.name === "string" ? group.name.trim() : "";
      if (typeof group.id !== "string" || !group.id || !name) return [];
      const templateCandidate = group.gameTemplate && typeof group.gameTemplate === "object" ? group.gameTemplate : undefined;
      const players = Array.isArray(group.players)
        ? cleanUniqueGroupMembers(
          group.players.filter((member) => Boolean(member && typeof member === "object")),
          templateCandidate ? group.id : "",
        ).players
        : [];
      if (!players.length) return [];
      const gameTemplate = normalizeGroupGameTemplate(templateCandidate, players);
      const imageUrl = typeof group.imageUrl === "string" ? group.imageUrl.trim().slice(0, 2000) : "";
      return [{
        id: group.id,
        name,
        ...(imageUrl ? { imageUrl } : {}),
        ...(group.privacy === "invite_only" || group.privacy === "private" ? { privacy: group.privacy } : {}),
        players,
        ...(gameTemplate ? { gameTemplate } : {}),
        uses: typeof group.uses === "number" && Number.isFinite(group.uses) ? group.uses : 0,
        updatedAt: typeof group.updatedAt === "string" ? group.updatedAt : "",
      }];
    });
  } catch {
    return [];
  }
}

export function serializeFrequentGroups(groups: FrequentGroup[]) {
  return JSON.stringify(groups);
}

export function updateFrequentGroupTemplate(
  groups: FrequentGroup[],
  id: string,
  patch: Pick<FrequentGroup, "name" | "players"> & Partial<Pick<FrequentGroup, "imageUrl" | "privacy" | "gameTemplate">>,
  updatedAt: string,
): FrequentGroup[] {
  const name = patch.name.trim();
  const cleaned = cleanUniqueGroupMembers(patch.players);
  if (!name || !cleaned.players.length || cleaned.invalid || cleaned.players.length !== patch.players.length) return groups;
  const players = cleaned.players;
  return groups.map((group) => group.id === id ? {
    ...group,
    name,
    players,
    ...(patch.imageUrl !== undefined
      ? patch.imageUrl.trim() ? { imageUrl: patch.imageUrl.trim().slice(0, 2000) } : { imageUrl: undefined }
      : {}),
    ...(patch.privacy ? { privacy: patch.privacy === "invite_only" ? "invite_only" : "private" } : {}),
    ...(patch.gameTemplate ? { gameTemplate: normalizeGroupGameTemplate(patch.gameTemplate, players) } : {}),
    updatedAt,
  } : group);
}

export function addFrequentGroupMember(group: FrequentGroup, member: FrequentGroupMember) {
  const cleaned = cleanGroupMember(member);
  if (!cleaned || group.players.some((candidate) => membersConflict(candidate, cleaned))) return group;
  return { ...group, players: [...group.players, cleaned] };
}

export function frequentGroupMemberFromFrequentPlayer(player: Pick<FrequentPlayer, "name" | "handicap" | "accountUserId">) {
  return cleanGroupMember(player);
}

export function updateFrequentGroupMember(group: FrequentGroup, index: number, patch: Partial<FrequentGroupMember>) {
  if (!group.players[index]) return group;
  return {
    ...group,
    players: group.players.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member),
  };
}

export function removeFrequentGroupMember(group: FrequentGroup, index: number) {
  if (!group.players[index]) return group;
  return { ...group, players: group.players.filter((_, memberIndex) => memberIndex !== index) };
}

export function moveFrequentGroupMember(group: FrequentGroup, index: number, direction: -1 | 1) {
  const destination = index + direction;
  if (!group.players[index] || destination < 0 || destination >= group.players.length) return group;
  const players = [...group.players];
  [players[index], players[destination]] = [players[destination], players[index]];
  return { ...group, players };
}

export function resolveFrequentGroupDeletion(groups: FrequentGroup[], id: string, decision: "cancel" | "delete") {
  return decision === "delete" ? groups.filter((group) => group.id !== id) : groups;
}

export function playersFromFrequentGroup(group: FrequentGroup, idFactory: () => string): Player[] {
  return cleanUniqueGroupMembers(Array.isArray(group.players) ? group.players : []).players.map((member) => ({
    id: member.accountUserId ? accountPrimaryPlayerId(member.accountUserId) : idFactory(),
    name: member.name,
    handicap: member.handicap,
    ...(member.accountUserId ? { accountUserId: member.accountUserId } : {}),
  }));
}

export function addFrequentPlayerTemplate(
  templates: FrequentPlayer[],
  member: FrequentGroupMember,
  id: string,
  updatedAt: string,
) {
  const cleaned = cleanGroupMember(member);
  if (!cleaned || templates.some((template) => memberKey(template.name) === memberKey(cleaned.name))) return templates;
  return [{ id, ...cleaned, uses: 0, updatedAt }, ...templates];
}

export function updateFrequentPlayerTemplate(
  templates: FrequentPlayer[],
  id: string,
  patch: Pick<FrequentPlayer, "name" | "handicap">,
  updatedAt: string,
) {
  const name = patch.name.trim();
  if (!name) return templates;
  return templates.map((template) => template.id === id
    ? { ...template, name, handicap: patch.handicap, updatedAt }
    : template);
}

export function removeFrequentPlayerTemplate(templates: FrequentPlayer[], id: string) {
  return templates.filter((template) => template.id !== id);
}

export function updateSavedPersonalRivalTemplate(
  templates: SavedPersonalRival[],
  id: string,
  patch: Omit<SavedPersonalRival, "id"> | SavedPersonalRival,
  updatedAt: string,
) {
  const name = patch.name.trim();
  if (!name) return templates;
  return templates.map((template) => template.id === id
    ? { ...template, ...patch, id: template.id, name, updatedAt }
    : template);
}

export function removeSavedPersonalRivalTemplate(templates: SavedPersonalRival[], id: string) {
  return templates.filter((template) => template.id !== id);
}

export function applySavedPersonalRivalTemplate(bet: PersonalBet, template: SavedPersonalRival): PersonalBet {
  return {
    ...bet,
    rivalMode: "external",
    externalRivalId: template.id,
    rivalPlayerId: undefined,
    rivalName: template.name,
    rivalHandicap: template.handicap ?? null,
    baseValue: template.baseValue ?? bet.baseValue,
    advantageReceiver: template.advantageReceiver ?? bet.advantageReceiver,
    advantageStrokes: template.advantageStrokes ?? bet.advantageStrokes,
    pressureMultiplier: template.pressureMultiplier ?? bet.pressureMultiplier,
    pressureNine: template.pressureNine ?? bet.pressureNine,
    carryEnabled: template.carryEnabled ?? bet.carryEnabled ?? false,
    advantageMode: template.mode ?? bet.advantageMode ?? "current_index",
    slidingAdvantage: template.slidingAdvantage ?? bet.slidingAdvantage,
    components: template.components ? { ...template.components } : bet.components,
    back9Multiplier: 1,
  };
}

export function personalRivalTemplateFromBet(
  bet: PersonalBet,
  id: string,
  updatedAt: string,
  handicap: number | null = null,
): SavedPersonalRival {
  return {
    id,
    name: bet.rivalName.trim(),
    handicap,
    baseValue: bet.baseValue,
    advantageReceiver: bet.advantageReceiver === "owner" ? "owner" : "rival",
    advantageStrokes: bet.advantageStrokes,
    pressureMultiplier: bet.pressureMultiplier ?? 1,
    pressureNine: bet.pressureNine ?? "holes_10_18",
    carryEnabled: bet.carryEnabled ?? false,
    mode: bet.advantageMode ?? "current_index",
    ...(bet.advantageMode === "sliding" ? { slidingAdvantage: bet.slidingAdvantage ?? (bet.advantageReceiver === "rival" ? bet.advantageStrokes : bet.advantageReceiver === "owner" ? -bet.advantageStrokes : 0) } : {}),
    components: { ...bet.components },
    updatedAt,
  };
}
