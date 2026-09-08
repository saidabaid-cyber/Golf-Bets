import type {
  PersonalBet,
  PersonalIndexSnapshot,
  PersonalSlidingAdjustment,
  Player,
  SavedPersonalRival,
} from "./types";

export type BackyardWhsIndexProvider = {
  source: "BACKYARD_WHS";
  currentIndex(playerId: string, at: string): Promise<PersonalIndexSnapshot | null>;
};

/** Phase 1 contract only. It must never fabricate an index from incomplete rounds. */
export const unavailableBackyardWhsProvider: BackyardWhsIndexProvider = {
  source: "BACKYARD_WHS",
  async currentIndex() { return null; },
};

export function profileIndexSnapshot(value: number | null | undefined, effectiveAt: string): PersonalIndexSnapshot | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return { indexValue: value, indexSource: "PROFILE_FALLBACK", effectiveAt, provisional: true };
}

export function signedPersonalAdvantage(ownerIndex: number, rivalIndex: number) {
  return Math.round((rivalIndex - ownerIndex) * 10) / 10;
}

export function advantageFieldsFromSigned(value: number): Pick<PersonalBet, "advantageReceiver" | "advantageStrokes"> {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) return { advantageReceiver: "none", advantageStrokes: 0 };
  return value > 0
    ? { advantageReceiver: "rival", advantageStrokes: Math.abs(value) }
    : { advantageReceiver: "owner", advantageStrokes: Math.abs(value) };
}

export function configureCurrentIndexPersonal(bet: PersonalBet, owner: Player | undefined, rival: Player | undefined, effectiveAt: string): PersonalBet {
  const ownerIndexSnapshot = profileIndexSnapshot(owner?.handicap, effectiveAt);
  const rivalIndexSnapshot = profileIndexSnapshot(rival?.handicap ?? bet.rivalHandicap, effectiveAt);
  if (!ownerIndexSnapshot || !rivalIndexSnapshot) {
    return { ...bet, advantageMode: "current_index", ownerIndexSnapshot: ownerIndexSnapshot || undefined, rivalIndexSnapshot: rivalIndexSnapshot || undefined };
  }
  const signed = signedPersonalAdvantage(ownerIndexSnapshot.indexValue, rivalIndexSnapshot.indexValue);
  return { ...bet, advantageMode: "current_index", ...advantageFieldsFromSigned(signed), ownerIndexSnapshot, rivalIndexSnapshot };
}

export function configureSlidingPersonal(bet: PersonalBet, signedAdvantage?: number): PersonalBet {
  const signed = Number.isFinite(signedAdvantage) ? Number(signedAdvantage) : signedPersonalAdvantage(
    bet.ownerIndexSnapshot?.indexValue || 0,
    bet.rivalIndexSnapshot?.indexValue || 0,
  );
  return { ...bet, advantageMode: "sliding", slidingAdvantage: signed, ...advantageFieldsFromSigned(signed) };
}

export function advanceSlidingAdvantage(previousAdvantage: number, ownerResult: number) {
  if (!Number.isFinite(previousAdvantage) || !Number.isFinite(ownerResult) || ownerResult === 0) return previousAdvantage;
  return previousAdvantage + (ownerResult > 0 ? 1 : -1);
}

export function slidingAdjustment(input: {
  bet: PersonalBet;
  ownerResult: number;
  rivalKey: string;
  roundId: string;
  updatedAt: string;
}): PersonalSlidingAdjustment | null {
  if (input.bet.advantageMode !== "sliding") return null;
  const previousAdvantage = input.bet.slidingAdvantage ?? (input.bet.advantageReceiver === "rival" ? input.bet.advantageStrokes : input.bet.advantageReceiver === "owner" ? -input.bet.advantageStrokes : 0);
  const newAdvantage = advanceSlidingAdvantage(previousAdvantage, input.ownerResult);
  return {
    betId: input.bet.id,
    rivalKey: input.rivalKey,
    previousAdvantage,
    result: input.ownerResult > 0 ? "owner_win" : input.ownerResult < 0 ? "rival_win" : "tie",
    newAdvantage,
    roundId: input.roundId,
    updatedAt: input.updatedAt,
  };
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-MX");
}

export function frequentPersonalSuggestions(templates: readonly SavedPersonalRival[], players: readonly Player[]) {
  const rosterNames = new Set(players.map((player) => normalizedName(player.name)));
  return templates.filter((template) => rosterNames.has(normalizedName(template.name))).map((template) => ({
    template,
    message: `Tienes una Personal frecuente con ${template.name}: ${template.mode === "sliding" ? `Sliding · ventaja ${template.slidingAdvantage ?? 0}` : "Índice actual"} · $${template.baseValue ?? 100}${template.carryEnabled ? " · Carry" : ""} · Presión ${template.pressureMultiplier ?? 1}x. ¿La jugamos?`,
  }));
}

export function personalBetFromFrequentTemplate(input: {
  template: SavedPersonalRival;
  owner: Player | undefined;
  rival: Player;
  id: string;
  effectiveAt: string;
}): PersonalBet {
  const { template, owner, rival, id, effectiveAt } = input;
  const base: PersonalBet = {
    id,
    enabled: true,
    rivalMode: "group",
    rivalPlayerId: rival.id,
    externalRivalId: template.id,
    rivalName: rival.name,
    rivalHandicap: rival.handicap,
    externalScores: {},
    baseValue: template.baseValue ?? 100,
    advantageReceiver: template.advantageReceiver ?? "rival",
    advantageStrokes: template.advantageStrokes ?? 0,
    advantageMode: template.mode ?? "current_index",
    slidingAdvantage: template.slidingAdvantage,
    back9Multiplier: 1,
    pressureMultiplier: template.pressureMultiplier ?? 1,
    pressureNine: template.pressureNine ?? "holes_10_18",
    carryEnabled: template.carryEnabled ?? false,
    components: template.components
      ? { ...template.components }
      : { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
  };
  const indexed = configureCurrentIndexPersonal(base, owner, rival, effectiveAt);
  return base.advantageMode === "sliding"
    ? configureSlidingPersonal(indexed, base.slidingAdvantage)
    : indexed;
}
