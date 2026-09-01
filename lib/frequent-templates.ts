import type { FrequentGroup, FrequentPlayer, PersonalBet, Player, SavedPersonalRival } from "./types";

export type FrequentGroupMember = FrequentGroup["players"][number];

function memberKey(name: string) {
  return name.trim().toLocaleLowerCase("es-MX");
}

function cleanGroupMember(member: FrequentGroupMember): FrequentGroupMember | null {
  const name = member.name.trim();
  if (!name) return null;
  return { name, handicap: member.handicap ?? null };
}

export function parseFrequentGroups(raw: string | null | undefined): FrequentGroup[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const group = value as Partial<FrequentGroup>;
      const name = typeof group.name === "string" ? group.name.trim() : "";
      const players = Array.isArray(group.players)
        ? group.players.flatMap((member) => {
          if (!member || typeof member !== "object") return [];
          const candidate = member as Partial<FrequentGroupMember>;
          if (typeof candidate.name !== "string") return [];
          const handicap = candidate.handicap === null || typeof candidate.handicap === "number" ? candidate.handicap : null;
          const cleaned = cleanGroupMember({ name: candidate.name, handicap });
          return cleaned ? [cleaned] : [];
        })
        : [];
      if (typeof group.id !== "string" || !group.id || !name || !players.length) return [];
      return [{
        id: group.id,
        name,
        players,
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
  patch: Pick<FrequentGroup, "name" | "players">,
  updatedAt: string,
) {
  const name = patch.name.trim();
  const players = patch.players.flatMap((member) => {
    const cleaned = cleanGroupMember(member);
    return cleaned ? [cleaned] : [];
  });
  if (!name || !players.length) return groups;
  return groups.map((group) => group.id === id ? { ...group, name, players, updatedAt } : group);
}

export function addFrequentGroupMember(group: FrequentGroup, member: FrequentGroupMember) {
  const cleaned = cleanGroupMember(member);
  if (!cleaned || group.players.some((candidate) => memberKey(candidate.name) === memberKey(cleaned.name))) return group;
  return { ...group, players: [...group.players, cleaned] };
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
  return group.players.map((member) => ({ id: idFactory(), name: member.name, handicap: member.handicap }));
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
    baseValue: template.baseValue ?? bet.baseValue,
    advantageReceiver: template.advantageReceiver ?? bet.advantageReceiver,
    advantageStrokes: template.advantageStrokes ?? bet.advantageStrokes,
    pressureMultiplier: template.pressureMultiplier ?? bet.pressureMultiplier,
    pressureNine: template.pressureNine ?? bet.pressureNine,
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
    updatedAt,
  };
}
