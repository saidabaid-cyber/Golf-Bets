import { accountPrimaryPlayerId } from "./account-primary-player";
import { normalizeFoursomeSegments, playOrder, segmentDefinitions } from "./engine";
import { initialBets, restoreBetConfig } from "./new-round-bets";
import { MAX_ROUND_PLAYERS, ROUND_PLAYER_LIMIT_MESSAGE } from "./round-player-limit";
import { normalizeSupplementalBets } from "./supplemental-bets";
import type {
  BetConfig,
  FrequentGroup,
  FrequentGroupMember,
  FoursomeSegment,
  GroupGameTemplate,
  ManualBet,
  PersonalBet,
  Player,
  RoundHandicapBasis,
  RoundSnapshot,
  SupplementalBet,
} from "./types";

export type GroupTemplateDraftSource = {
  ownerId: string;
  players: Player[];
  startHole: 1 | 10;
  roundHoles: 9 | 18;
  roundHandicapBasis: RoundHandicapBasis;
  bets: BetConfig;
  segments: FoursomeSegment[];
  personalBets: PersonalBet[];
  supplementalBets: SupplementalBet[];
  manualBets: ManualBet[];
};

export type RoundTemplateOrigin = {
  groupId: string;
  /** Immutable label shown by active/history views even if the group is renamed. */
  groupNameSnapshot?: string;
  basedOnUpdatedAt: string;
  roundPlayerIdByMemberId: Record<string, string>;
};

export type GroupTemplateRoundDraft = GroupTemplateDraftSource & {
  origin: RoundTemplateOrigin;
};

export function normalizeRoundTemplateOrigin(value: unknown): RoundTemplateOrigin | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<RoundTemplateOrigin>;
  if (!validId(raw.groupId) || typeof raw.basedOnUpdatedAt !== "string" || !raw.roundPlayerIdByMemberId || typeof raw.roundPlayerIdByMemberId !== "object") return null;
  const entries = Object.entries(raw.roundPlayerIdByMemberId)
    .filter(([memberId, playerId]) => validId(memberId) && validId(playerId));
  if (!entries.length) return null;
  const groupNameSnapshot = typeof raw.groupNameSnapshot === "string" ? raw.groupNameSnapshot.trim().slice(0, 100) : "";
  return {
    groupId: raw.groupId!,
    ...(groupNameSnapshot ? { groupNameSnapshot } : {}),
    basedOnUpdatedAt: raw.basedOnUpdatedAt,
    roundPlayerIdByMemberId: Object.fromEntries(entries),
  };
}

export const MAX_ROUND_GROUP_PLAYERS = MAX_ROUND_PLAYERS;

export type GroupRoundSelectionValidation =
  | { ok: true; selectedMemberIds: string[] }
  | { ok: false; code: "empty" | "too_many" | "unknown_member"; message: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validId(value: unknown) {
  return typeof value === "string" && Boolean(value) && !/\s/.test(value) && value.length <= 200;
}

export function stableGroupMemberId(group: Pick<FrequentGroup, "id">, member: FrequentGroupMember, index: number) {
  return validId(member.memberId) ? member.memberId! : `member-${group.id}-${index + 1}`;
}

/** Legacy roster-only groups receive deterministic IDs before becoming a bet template. */
export function withStableGroupMemberIds(group: FrequentGroup): FrequentGroup {
  return {
    ...group,
    players: group.players.map((member, index) => ({
      ...member,
      memberId: stableGroupMemberId(group, member, index),
    })),
  };
}

export function validateGroupRoundSelection(group: FrequentGroup, selectedMemberIds: readonly string[]): GroupRoundSelectionValidation {
  const available = new Set(group.players.map((member, index) => stableGroupMemberId(group, member, index)));
  const selected = [...new Set(selectedMemberIds)];
  if (!selected.length) return { ok: false, code: "empty", message: "Selecciona al menos un jugador para esta ronda." };
  if (selected.length > MAX_ROUND_GROUP_PLAYERS) return { ok: false, code: "too_many", message: ROUND_PLAYER_LIMIT_MESSAGE };
  if (selected.some((memberId) => !available.has(memberId))) return { ok: false, code: "unknown_member", message: "El grupo cambió. Vuelve a elegir sus jugadores." };
  return { ok: true, selectedMemberIds: selected };
}

export function defaultGroupRoundSelection(group: FrequentGroup) {
  const preferredCount = group.players.length <= MAX_ROUND_GROUP_PLAYERS ? group.players.length : 4;
  return group.players.slice(0, preferredCount).map((member, index) => stableGroupMemberId(group, member, index));
}

export function createRoundGroupSnapshot(origin: RoundTemplateOrigin | null | undefined, players: readonly Player[]): RoundSnapshot["groupOrigin"] {
  if (!origin) return undefined;
  const selectedMembers = Object.entries(origin.roundPlayerIdByMemberId).flatMap(([memberId, roundPlayerId]) => {
    const player = players.find((candidate) => candidate.id === roundPlayerId);
    return player ? [{ memberId, roundPlayerId, name: player.name }] : [];
  });
  if (!selectedMembers.length) return undefined;
  return {
    groupId: origin.groupId,
    groupName: origin.groupNameSnapshot || "Grupo",
    basedOnUpdatedAt: origin.basedOnUpdatedAt,
    selectedMembers,
  };
}

function mapId(value: unknown, ids: ReadonlyMap<string, string>) {
  return validId(value) ? ids.get(value as string) : undefined;
}

function mapIds(value: unknown, ids: ReadonlyMap<string, string>) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => mapId(id, ids)).filter((id): id is string => Boolean(id)))];
}

function remapBetConfig(value: Partial<BetConfig> | undefined, ids: ReadonlyMap<string, string>) {
  const source = clone(value || {});
  const participant = <T extends { participantIds?: string[] } | undefined>(config: T): T => {
    if (!config) return config;
    return { ...config, participantIds: mapIds(config.participantIds, ids) } as T;
  };
  return {
    ...source,
    ...(source.monkey ? { monkey: participant(source.monkey) } : {}),
    ...(source.rabbits ? { rabbits: participant(source.rabbits) } : {}),
    ...(source.skins ? { skins: participant(source.skins) } : {}),
    ...(source.units ? { units: participant(source.units) } : {}),
    ...(source.foursome ? { foursome: participant(source.foursome) } : {}),
    ...(source.ballFriend ? { ballFriend: participant(source.ballFriend) } : {}),
    ...(source.polla ? {
      polla: {
        ...(source.polla.first9 ? { first9: participant(source.polla.first9) } : {}),
        ...(source.polla.second9 ? { second9: participant(source.polla.second9) } : {}),
        ...(source.polla.total18 ? { total18: participant(source.polla.total18) } : {}),
      },
    } : {}),
    ...(source.miniPolla ? { miniPolla: participant(source.miniPolla) } : {}),
    ...(source.vipers ? { vipers: participant(source.vipers) } : {}),
    ...(source.camels ? { camels: participant(source.camels) } : {}),
    ...(source.fish ? { fish: participant(source.fish) } : {}),
    ...(source.loba ? { loba: participant(source.loba) } : {}),
  } as Partial<BetConfig>;
}

function cleanRoundFrozenFields(config: BetConfig) {
  const next = clone(config);
  delete next.foursome.fixedBaseHandicap;
  delete next.ballFriend.fixedBaseHandicap;
  return next;
}

function remapPersonalBets(
  value: unknown,
  ids: ReadonlyMap<string, string>,
  idFactory?: () => string,
): PersonalBet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = clone(candidate as PersonalBet);
    if (!validId(raw.id) || typeof raw.rivalName !== "string" || !raw.components || typeof raw.components !== "object") return [];
    const cleaned = { ...raw };
    delete cleaned.enabledBeforeCategoryOff;
    const rivalPlayerId = raw.rivalMode === "group" ? mapId(raw.rivalPlayerId, ids) : undefined;
    return [{
      ...cleaned,
      id: idFactory ? idFactory() : cleaned.id,
      externalScores: {},
      ...(raw.rivalMode === "group" ? { rivalPlayerId } : {}),
    } as PersonalBet];
  });
}

function remapSupplementalBets(
  value: unknown,
  ids: ReadonlyMap<string, string>,
  roundHoles: 9 | 18,
  idFactory?: () => string,
): SupplementalBet[] {
  return normalizeSupplementalBets(value, roundHoles).map((raw): SupplementalBet => {
    const base = clone(raw);
    delete base.enabledBeforeCategoryOff;
    const id = idFactory ? idFactory() : base.id;
    if (base.type === "individual_nassau" || base.type === "dollar_stroke") {
      const advantageReceiverId = mapId(base.advantageReceiverId, ids);
      return {
        ...base,
        id,
        playerAId: mapId(base.playerAId, ids) || "",
        playerBId: mapId(base.playerBId, ids) || "",
        ...(advantageReceiverId ? { advantageReceiverId } : { advantageReceiverId: undefined }),
      } as SupplementalBet;
    }
    if (base.type === "team_pressures") {
      return {
        ...base,
        id,
        participantIds: mapIds(base.participantIds, ids),
        teamA: mapIds(base.teamA, ids),
        abandonedPlayerIds: [],
      };
    }
    if (base.type === "vegas") {
      return {
        ...base,
        id,
        participantIds: mapIds(base.participantIds, ids),
        teamA: mapIds(base.teamA, ids),
      };
    }
    return { ...base, id, participantIds: mapIds(base.participantIds, ids) } as SupplementalBet;
  });
}

function remapManualBets(value: unknown, destinationPlayerIds: string[], idFactory?: () => string): ManualBet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = clone(candidate as ManualBet);
    if (!validId(raw.id) || typeof raw.name !== "string" || !raw.name.trim()) return [];
    const cleaned = { ...raw };
    delete cleaned.enabledBeforeCategoryOff;
    return [{
      ...cleaned,
      id: idFactory ? idFactory() : cleaned.id,
      name: cleaned.name.trim().slice(0, 80),
      amounts: Object.fromEntries(destinationPlayerIds.map((id) => [id, 0])),
    }];
  });
}

function remapSegments(
  value: unknown,
  ids: ReadonlyMap<string, string>,
  context: GroupGameTemplate["roundDefaults"],
  segmentSize: 3 | 6 | 9 | 18,
) {
  const mapped = Array.isArray(value)
    ? value.map((segment) => segment && typeof segment === "object"
      ? { ...(segment as FoursomeSegment), basePair: mapIds((segment as FoursomeSegment).basePair, ids) }
      : segment)
    : [];
  return normalizeFoursomeSegments(
    mapped,
    playOrder(context.startHole).slice(0, context.roundHoles),
    segmentSize,
  );
}

function cleanTemplate(
  value: {
    ownerId: string;
    bets: Partial<BetConfig> | undefined;
    segments: unknown;
    personalBets: unknown;
    supplementalBets: unknown;
    manualBets: unknown;
  },
  mapping: ReadonlyMap<string, string>,
  destinationPlayerIds: string[],
  roundDefaults: GroupGameTemplate["roundDefaults"],
  idFactory?: () => string,
): GroupGameTemplate {
  const mappedBets = remapBetConfig(value.bets, mapping);
  const betConfig = cleanRoundFrozenFields(restoreBetConfig(mappedBets, destinationPlayerIds, roundDefaults));
  return {
    version: 1,
    ownerMemberId: mapId(value.ownerId, mapping) || destinationPlayerIds[0] || "",
    roundDefaults,
    betConfig,
    foursomeSegments: remapSegments(value.segments, mapping, roundDefaults, betConfig.foursome.segmentSize),
    personalBets: remapPersonalBets(value.personalBets, mapping, idFactory),
    supplementalBets: remapSupplementalBets(value.supplementalBets, mapping, roundDefaults.roundHoles, idFactory),
    manualBets: remapManualBets(value.manualBets, destinationPlayerIds, idFactory),
  };
}

export function createGroupGameTemplate(
  source: GroupTemplateDraftSource,
  memberIdByPlayerId: Readonly<Record<string, string>>,
): GroupGameTemplate {
  const mapping = new Map(Object.entries(memberIdByPlayerId).filter(([from, to]) => validId(from) && validId(to)));
  const memberIds = source.players
    .map((player) => mapping.get(player.id))
    .filter((id): id is string => Boolean(id));
  return cleanTemplate(source, mapping, memberIds, {
    startHole: source.startHole,
    roundHoles: source.roundHoles,
    handicapBasis: source.roundHandicapBasis,
  });
}

export function normalizeGroupGameTemplate(value: unknown, members: FrequentGroupMember[]) {
  if (!value || typeof value !== "object" || (value as Partial<GroupGameTemplate>).version !== 1) return undefined;
  const raw = value as Partial<GroupGameTemplate>;
  const memberIds = members.map((member) => member.memberId).filter((id): id is string => validId(id));
  if (!memberIds.length || !raw.betConfig || typeof raw.betConfig !== "object") return undefined;
  const roundDefaults = {
    startHole: raw.roundDefaults?.startHole === 10 ? 10 as const : 1 as const,
    roundHoles: raw.roundDefaults?.roundHoles === 9 ? 9 as const : 18 as const,
    handicapBasis: raw.roundDefaults?.handicapBasis === "course" ? "course" as const : "relative" as const,
  };
  const mapping = new Map(memberIds.map((id) => [id, id]));
  const ownerMemberId = validId(raw.ownerMemberId) ? raw.ownerMemberId! : memberIds[0];
  return cleanTemplate({
    ownerId: ownerMemberId,
    bets: raw.betConfig,
    segments: raw.foursomeSegments,
    personalBets: raw.personalBets,
    supplementalBets: raw.supplementalBets,
    manualBets: raw.manualBets,
  }, mapping, memberIds, roundDefaults);
}

export function groupTemplatePlayers(group: FrequentGroup): Player[] {
  return group.players.map((member, index) => ({
    id: stableGroupMemberId(group, member, index),
    name: member.name,
    handicap: member.handicap,
    ...(member.accountUserId ? {
      accountUserId: member.accountUserId,
      handicapIndex: member.handicap,
      handicapSource: "profile_index" as const,
      handicapIndexSource: "BACKYARD_MANUAL" as const,
    } : { handicapSource: "manual" as const }),
  }));
}

export function createEmptyGroupGameTemplate(group: FrequentGroup): GroupGameTemplate {
  const stableGroup = withStableGroupMemberIds(group);
  const players = groupTemplatePlayers(stableGroup);
  const startHole = 1 as const;
  const roundHoles = 18 as const;
  return createGroupGameTemplate({
    ownerId: players[0]?.id || "",
    players,
    startHole,
    roundHoles,
    roundHandicapBasis: "relative",
    bets: initialBets(players.map((player) => player.id)),
    segments: segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6),
    personalBets: [],
    supplementalBets: [],
    manualBets: [],
  }, Object.fromEntries(players.map((player) => [player.id, player.id])));
}

function runtimePlayers(group: FrequentGroup, idFactory: () => string, selectedMemberIds?: readonly string[]) {
  const selected = selectedMemberIds ? new Set(selectedMemberIds) : null;
  return group.players.flatMap((member, index) => {
    const memberId = stableGroupMemberId(group, member, index);
    if (selected && !selected.has(memberId)) return [];
    return [{
      memberId,
      player: {
        id: member.accountUserId ? accountPrimaryPlayerId(member.accountUserId) : idFactory(),
        name: member.name,
        handicap: member.handicap,
        ...(member.accountUserId ? { accountUserId: member.accountUserId } : {}),
      } satisfies Player,
    }];
  });
}

export function instantiateGroupGameTemplate(group: FrequentGroup, idFactory: () => string, selectedMemberIds?: readonly string[]): GroupTemplateRoundDraft {
  const stableGroup = withStableGroupMemberIds(group);
  const selection = selectedMemberIds ?? defaultGroupRoundSelection(stableGroup);
  const validation = validateGroupRoundSelection(stableGroup, selection);
  if (!validation.ok) throw new Error(validation.message);
  const runtime = runtimePlayers(stableGroup, idFactory, validation.selectedMemberIds);
  const players = runtime.map(({ player }) => player);
  const roundPlayerIdByMemberId = Object.fromEntries(runtime.map(({ memberId, player }) => [memberId, player.id]));
  const origin = { groupId: stableGroup.id, groupNameSnapshot: stableGroup.name, basedOnUpdatedAt: stableGroup.updatedAt, roundPlayerIdByMemberId };
  if (!stableGroup.gameTemplate) {
    const startHole = 1 as const;
    const roundHoles = 18 as const;
    return {
      origin,
      ownerId: players[0]?.id || "",
      players,
      startHole,
      roundHoles,
      roundHandicapBasis: "relative",
      bets: initialBets(players.map((player) => player.id)),
      segments: segmentDefinitions(playOrder(startHole).slice(0, roundHoles), 6),
      personalBets: [],
      supplementalBets: [],
      manualBets: [],
    };
  }
  const template = stableGroup.gameTemplate;
  const mapping = new Map(Object.entries(roundPlayerIdByMemberId));
  const cleaned = cleanTemplate({
    ownerId: template.ownerMemberId,
    bets: template.betConfig,
    segments: template.foursomeSegments,
    personalBets: template.personalBets,
    supplementalBets: template.supplementalBets,
    manualBets: template.manualBets,
  }, mapping, players.map((player) => player.id), template.roundDefaults, idFactory);
  return {
    origin,
    ownerId: cleaned.ownerMemberId,
    players,
    startHole: cleaned.roundDefaults.startHole,
    roundHoles: cleaned.roundDefaults.roundHoles,
    roundHandicapBasis: cleaned.roundDefaults.handicapBasis,
    bets: cleaned.betConfig,
    segments: cleaned.foursomeSegments,
    personalBets: cleaned.personalBets,
    supplementalBets: cleaned.supplementalBets,
    manualBets: cleaned.manualBets,
  };
}

export function updateGroupTemplateFromRound(
  group: FrequentGroup,
  origin: RoundTemplateOrigin,
  source: GroupTemplateDraftSource,
  updatedAt: string,
): { status: "updated"; group: FrequentGroup } | { status: "stale"; group: FrequentGroup } {
  if (group.id !== origin.groupId || group.updatedAt !== origin.basedOnUpdatedAt) return { status: "stale", group };
  const memberIdByPlayerId = Object.fromEntries(
    Object.entries(origin.roundPlayerIdByMemberId).map(([memberId, playerId]) => [playerId, memberId]),
  );
  const roundPlayerByMemberId = new Map(Object.entries(origin.roundPlayerIdByMemberId).flatMap(([memberId, playerId]) => {
    const player = source.players.find((candidate) => candidate.id === playerId);
    return player ? [[memberId, player] as const] : [];
  }));
  return {
    status: "updated",
    group: {
      ...group,
      players: group.players.map((member) => member.memberId && roundPlayerByMemberId.has(member.memberId)
        ? { ...member, handicap: roundPlayerByMemberId.get(member.memberId)!.handicapIndex ?? roundPlayerByMemberId.get(member.memberId)!.handicap }
        : member),
      gameTemplate: createGroupGameTemplate(source, memberIdByPlayerId),
      updatedAt,
    },
  };
}

export function frequentGroupTemplateSummary(group: FrequentGroup) {
  const template = group.gameTemplate;
  if (!template) return "Sin apuestas habituales";
  const core = [
    template.betConfig.monkey?.enabled,
    template.betConfig.rabbits.enabled,
    template.betConfig.skins.enabled,
    template.betConfig.units.enabled,
    template.betConfig.foursome.enabled,
    template.betConfig.ballFriend.enabled,
    template.betConfig.polla.first9.enabled,
    template.betConfig.polla.second9.enabled,
    template.betConfig.polla.total18.enabled,
    template.betConfig.miniPolla.enabled,
    template.betConfig.vipers.enabled,
    template.betConfig.camels.enabled,
    template.betConfig.fish.enabled,
    template.betConfig.loba.enabled,
  ].filter(Boolean).length;
  const instances = [...template.personalBets, ...template.supplementalBets, ...template.manualBets]
    .filter((bet) => bet.enabled !== false).length;
  const total = core + instances;
  return total ? `${total} ${total === 1 ? "modalidad habitual" : "modalidades habituales"}` : "Sin apuestas habituales";
}

function groupStake(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toLocaleString("es-MX", { maximumFractionDigits: 2 })}`
    : "";
}

/** Human-readable, calculation-free summary for the group library. */
export function frequentGroupTemplateDetails(group: FrequentGroup) {
  const template = group.gameTemplate;
  if (!template) return [];
  const bets = template.betConfig;
  const details: string[] = [];
  const add = (enabled: boolean | undefined, label: string, value?: number) => {
    if (!enabled) return;
    const stake = groupStake(value);
    details.push(`${label}${stake ? ` ${stake}` : ""}`);
  };

  add(bets.monkey?.enabled, "Monkey", bets.monkey?.value);
  add(bets.rabbits.enabled, "Conejos", bets.rabbits.value);
  add(bets.skins.enabled, "Skins", bets.skins.value);
  add(bets.units.enabled, "Unidades", bets.units.value);
  add(bets.foursome.enabled, `Foursome${bets.foursome.mode === "match" ? " Match" : ""}`, bets.foursome.mode === "fixed" || bets.foursome.mode === "match" ? bets.foursome.fixedValue : bets.foursome.pointValue);
  add(bets.ballFriend.enabled, "Bola Amiga", bets.ballFriend.value);
  add(bets.polla.first9.enabled, "Nassau · primera", bets.polla.first9.value);
  add(bets.polla.second9.enabled, "Nassau · segunda", bets.polla.second9.value);
  add(bets.polla.total18.enabled, "Nassau · total", bets.polla.total18.value);
  add(bets.miniPolla.enabled, "Mini Polla", bets.miniPolla.value);
  add(bets.vipers.enabled, "Víboras", bets.vipers.value);
  add(bets.camels.enabled, "Camellos", bets.camels.value);
  add(bets.fish.enabled, "Peces", bets.fish.value);
  add(bets.loba.enabled, "Loba", bets.loba.value);
  for (const bet of template.personalBets) add(bet.enabled !== false, `Nassau individual · ${bet.rivalName}`, bet.baseValue);
  for (const bet of template.supplementalBets) {
    const label = "label" in bet && typeof bet.label === "string" && bet.label.trim() ? bet.label : bet.type.replaceAll("_", " ");
    add(bet.enabled !== false, label, "value" in bet && typeof bet.value === "number" ? bet.value : undefined);
  }
  for (const bet of template.manualBets) add(bet.enabled !== false, bet.name);
  return details;
}
