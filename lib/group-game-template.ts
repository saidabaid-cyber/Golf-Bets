import { accountPrimaryPlayerId } from "./account-primary-player";
import { normalizeFoursomeSegments, playOrder, segmentDefinitions } from "./engine";
import { initialBets, restoreBetConfig } from "./new-round-bets";
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
  basedOnUpdatedAt: string;
  roundPlayerIdByMemberId: Record<string, string>;
};

export type GroupTemplateRoundDraft = GroupTemplateDraftSource & {
  origin: RoundTemplateOrigin;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validId(value: unknown) {
  return typeof value === "string" && Boolean(value) && !/\s/.test(value) && value.length <= 200;
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
    const { enabledBeforeCategoryOff: _transient, ...cleaned } = raw;
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
    const { enabledBeforeCategoryOff: _transient, ...base } = clone(raw);
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
    const { enabledBeforeCategoryOff: _transient, ...cleaned } = raw;
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

function runtimePlayers(group: FrequentGroup, idFactory: () => string) {
  return group.players.map((member, index) => ({
    memberId: member.memberId || `legacy-${group.id}-${index}`,
    player: {
      id: member.accountUserId ? accountPrimaryPlayerId(member.accountUserId) : idFactory(),
      name: member.name,
      handicap: member.handicap,
      ...(member.accountUserId ? { accountUserId: member.accountUserId } : {}),
    } satisfies Player,
  }));
}

export function instantiateGroupGameTemplate(group: FrequentGroup, idFactory: () => string): GroupTemplateRoundDraft {
  const runtime = runtimePlayers(group, idFactory);
  const players = runtime.map(({ player }) => player);
  const roundPlayerIdByMemberId = Object.fromEntries(runtime.map(({ memberId, player }) => [memberId, player.id]));
  const origin = { groupId: group.id, basedOnUpdatedAt: group.updatedAt, roundPlayerIdByMemberId };
  if (!group.gameTemplate) {
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
  const template = group.gameTemplate;
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
  return {
    status: "updated",
    group: {
      ...group,
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
