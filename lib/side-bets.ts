import type {
  BetConfig,
  CounterBetConfig,
  CounterBetEvent,
  CounterBetKeepers,
  CounterBetKind,
  CounterBetPeriod,
  Course,
  HoleScore,
  LobaHole,
  LobaMode,
  LobaWinner,
  Player,
  PhysicalNine,
  PressureMultiplier,
  RoundHandicapBasis,
  Transfer,
} from "./types";
import { automaticUnitsForScore, baseHandicaps, completedHole, playingHandicap, strokeAllowanceForHole } from "./engine";
import { playersMissingRoundHandicap } from "./handicap-base";

const EPSILON = 0.0001;

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeCounterQuantity(value: unknown) {
  return isFiniteNonNegative(value) ? Math.trunc(value) : 0;
}

function hasCleanParticipants(players: Player[], participantIds: unknown, minimum: number) {
  if (!Array.isArray(participantIds) || participantIds.some((id) => typeof id !== "string" || !id)) return false;
  if (new Set(participantIds).size !== participantIds.length) return false;
  const available = new Set(players.map((player) => player.id));
  return participantIds.length >= minimum && participantIds.every((id) => available.has(id));
}

function isValidCounterConfig(players: Player[], config: CounterBetConfig | undefined) {
  if (config?.enabled !== true) return true;
  const multiplier = config.secondNineMultiplier;
  const multiplierIsRelevant = config.secondNinePressed !== false;
  return hasCleanParticipants(players, config.participantIds, 2)
    && isFiniteNonNegative(config.value)
    && (config.secondNinePressed === undefined || typeof config.secondNinePressed === "boolean")
    && (!multiplierIsRelevant || multiplier === undefined || (Number.isInteger(multiplier) && multiplier >= 1 && multiplier <= 5));
}

export const COUNTER_BET_META: Record<CounterBetKind, { emoji: string; singular: string; plural: string; article: "las" | "los" }> = {
  vipers: { emoji: "🐍", singular: "Víbora", plural: "Víboras", article: "las" },
  camels: { emoji: "🐫", singular: "Camello", plural: "Camellos", article: "los" },
  fish: { emoji: "🐟", singular: "Pez", plural: "Peces", article: "los" },
};

export const emptyCounterBetKeepers = (): CounterBetKeepers => ({ vipers: {}, camels: {}, fish: {} });

export function physicalNineForHole(hole: number): PhysicalNine {
  return hole <= 9 ? "holes_1_9" : "holes_10_18";
}

export function counterBetConfiguredSecondNineMultiplier(config: CounterBetConfig | undefined): Exclude<PressureMultiplier, 1> {
  const value = Math.trunc(config?.secondNineMultiplier ?? 2);
  return Math.min(5, Math.max(2, Number.isFinite(value) ? value : 2)) as Exclude<PressureMultiplier, 1>;
}

export function counterBetSecondNinePressed(config: CounterBetConfig | undefined) {
  if (typeof config?.secondNinePressed === "boolean") return config.secondNinePressed;
  const savedMultiplier = Math.trunc(config?.secondNineMultiplier ?? 1);
  return Number.isFinite(savedMultiplier) && savedMultiplier > 1;
}

export function counterBetSecondNineMultiplier(config: CounterBetConfig | undefined): PressureMultiplier {
  return counterBetSecondNinePressed(config) ? counterBetConfiguredSecondNineMultiplier(config) : 1;
}

export function counterBetEffectiveUnitValue(config: CounterBetConfig | undefined, hole: number) {
  const multiplier = physicalNineForHole(hole) === "holes_10_18" ? counterBetSecondNineMultiplier(config) : 1;
  const value = isFiniteNonNegative(config?.value) ? config.value : 0;
  return roundMoney(value * multiplier);
}

export function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function addTransfer(
  transfers: Transfer[],
  balances: Record<string, number>,
  fromPlayerId: string,
  toPlayerId: string,
  amount: number,
  details: Pick<Transfer, "betType" | "hole" | "metadata"> = {},
) {
  const normalized = roundMoney(amount);
  if (!fromPlayerId || !toPlayerId || fromPlayerId === toPlayerId || normalized <= EPSILON) return;
  transfers.push({ fromPlayerId, toPlayerId, amount: normalized, ...details });
  balances[fromPlayerId] = roundMoney((balances[fromPlayerId] || 0) - normalized);
  balances[toPlayerId] = roundMoney((balances[toPlayerId] || 0) + normalized);
}

export function isZeroSum(balances: Record<string, number>) {
  return Math.abs(roundMoney(Object.values(balances).reduce((sum, value) => sum + value, 0))) < EPSILON;
}

export function setCounterQuantity(
  events: CounterBetEvent[],
  kind: CounterBetKind,
  hole: number,
  playerId: string,
  quantity: number,
  id = `${kind}:${hole}:${playerId}`,
) {
  const nextQuantity = Math.max(0, Math.trunc(Number.isFinite(quantity) ? quantity : 0));
  const existing = events.find(event => event.kind === kind && event.hole === hole && event.playerId === playerId);
  const remaining = events.filter(event => !(event.kind === kind && event.hole === hole && event.playerId === playerId));
  return nextQuantity > 0 ? [...remaining, { ...existing, id: existing?.id ?? id, kind, hole, playerId, quantity: nextQuantity }] : remaining;
}

export function setCounterDistance(
  events: CounterBetEvent[],
  kind: CounterBetKind,
  hole: number,
  playerId: string,
  distanceToHole: number | null,
) {
  return events.map(event => {
    if (event.kind !== kind || event.hole !== hole || event.playerId !== playerId) return event;
    if (distanceToHole === null || !Number.isFinite(distanceToHole) || distanceToHole < 0) {
      const next = { ...event };
      delete next.distanceToHole;
      return next;
    }
    return { ...event, distanceToHole };
  });
}

export function counterQuantity(events: CounterBetEvent[], kind: CounterBetKind, hole: number, playerId: string) {
  return events
    .filter(event => event.kind === kind && event.hole === hole && event.playerId === playerId)
    .reduce((sum, event) => sum + safeCounterQuantity(event.quantity), 0);
}

export type CounterBetHalfResult = {
  nine: CounterBetPeriod;
  holes: number[];
  quantity: number;
  pressed: boolean;
  multiplier: number;
  value: number;
  bagValue: number;
  events: CounterBetValuedEvent[];
  keeperId?: string;
  lastEventHole?: number;
  candidateIds?: string[];
  needsTieBreak?: boolean;
  settled: boolean;
  balances: Record<string, number>;
  transfers: Transfer[];
};

export type CounterBetValuedEvent = CounterBetEvent & {
  multiplier: PressureMultiplier;
  effectiveUnitValue: number;
  effectiveTotalValue: number;
};

export function valueCounterBetEvent(event: CounterBetEvent, config: CounterBetConfig | undefined): CounterBetValuedEvent {
  const multiplier = physicalNineForHole(event.hole) === "holes_10_18" ? counterBetSecondNineMultiplier(config) : 1;
  const effectiveUnitValue = counterBetEffectiveUnitValue(config, event.hole);
  const quantity = safeCounterQuantity(event.quantity);
  const valued: CounterBetValuedEvent = {
    ...event,
    quantity,
    multiplier,
    effectiveUnitValue,
    effectiveTotalValue: roundMoney(quantity * effectiveUnitValue),
  };
  if (valued.distanceToHole !== undefined && !isFiniteNonNegative(valued.distanceToHole)) delete valued.distanceToHole;
  return valued;
}

export function snapshotCounterBetEvents(events: CounterBetEvent[], configs: Record<CounterBetKind, CounterBetConfig>) {
  return events.map(event => valueCounterBetEvent(event, configs[event.kind]));
}

export function latestCounterBetCandidates(
  kind: CounterBetKind,
  participantIds: string[],
  events: CounterBetEvent[],
  order: number[],
) {
  const allowed = new Set(participantIds);
  const orderIndex = new Map(order.map((hole, index) => [hole, index]));
  const relevant = events.filter(event => event.kind === kind && allowed.has(event.playerId) && safeCounterQuantity(event.quantity) > 0 && orderIndex.has(event.hole));
  if (!relevant.length) return { hole: undefined, candidates: [] as CounterBetEvent[] };
  const lastIndex = Math.max(...relevant.map(event => orderIndex.get(event.hole) ?? -1));
  const hole = order[lastIndex];
  const candidates = relevant.filter(event => event.hole === hole);
  return { hole, candidates };
}

function viperKeeper(candidates: CounterBetEvent[]) {
  if (candidates.length === 1) return candidates[0].playerId;
  if (!candidates.length || candidates.some(candidate => !Number.isFinite(candidate.distanceToHole) || (candidate.distanceToHole as number) < 0)) return undefined;
  const closest = Math.min(...candidates.map(candidate => candidate.distanceToHole as number));
  const closestCandidates = candidates.filter(candidate => Math.abs((candidate.distanceToHole as number) - closest) < EPSILON);
  return closestCandidates.length === 1 ? closestCandidates[0].playerId : undefined;
}

export function calculateCounterBet(
  kind: CounterBetKind,
  allPlayers: Player[],
  config: CounterBetConfig,
  events: CounterBetEvent[],
  keepers: CounterBetKeepers,
  order: number[],
  completedHoles?: ReadonlySet<number>,
) {
  const configuredParticipantIds = Array.isArray(config?.participantIds) ? config.participantIds : [];
  const participants = allPlayers.filter(player => configuredParticipantIds.includes(player.id));
  const configIsValid = isValidCounterConfig(allPlayers, config);
  const valueConfig = configIsValid ? config : undefined;
  const playedOrder = Array.isArray(order) ? order : [];
  const balances = Object.fromEntries(participants.map(player => [player.id, 0])) as Record<string, number>;
  const transfers: Transfer[] = [];
  const halves = (["holes_1_9", "holes_10_18"] as PhysicalNine[]).map((nine): CounterBetHalfResult => {
    const holes = playedOrder.filter(hole => physicalNineForHole(hole) === nine);
    const participantIds = new Set(participants.map(player => player.id));
    const valuedEvents = (Array.isArray(events) ? events : [])
      .filter(event => Boolean(event && typeof event === "object" && event.kind === kind && holes.includes(event.hole) && participantIds.has(event.playerId)))
      .map(event => valueCounterBetEvent(event, valueConfig));
    const quantity = valuedEvents.reduce((sum, event) => sum + safeCounterQuantity(event.quantity), 0);
    const multiplier = nine === "holes_10_18" ? counterBetSecondNineMultiplier(valueConfig) : 1;
    const pressed = nine === "holes_10_18" && counterBetSecondNinePressed(valueConfig);
    const value = counterBetEffectiveUnitValue(valueConfig, nine === "holes_10_18" ? 10 : 1);
    const bagValue = roundMoney(valuedEvents.reduce((sum, event) => sum + event.effectiveTotalValue, 0));
    const { hole: lastEventHole, candidates } = latestCounterBetCandidates(kind, [...participantIds], valuedEvents, holes);
    const candidateIds = candidates.map(candidate => candidate.playerId);
    const manuallySelected = keepers?.[kind]?.[nine];
    const keeperId = kind === "vipers"
      ? viperKeeper(candidates)
      : candidates.length === 1
        ? candidates[0].playerId
        : manuallySelected && candidateIds.includes(manuallySelected) ? manuallySelected : undefined;
    const needsTieBreak = candidates.length > 1 && !keeperId;
    const complete = holes.length > 0 && (!completedHoles || holes.every(hole => completedHoles.has(hole)));
    const settled = Boolean(configIsValid && config?.enabled === true && complete && quantity > 0 && keeperId);
    const halfBalances = Object.fromEntries(participants.map(player => [player.id, 0])) as Record<string, number>;
    const halfTransfers: Transfer[] = [];
    if (settled && keeperId && quantity > 0) {
      const amount = bagValue;
      for (const player of participants) {
        if (player.id === keeperId) continue;
        addTransfer(halfTransfers, halfBalances, keeperId, player.id, amount, {
          betType: kind,
          hole: lastEventHole,
          metadata: { nine, quantity, unitValue: value, pressed, multiplier, bagValue, lastEventHole: lastEventHole ?? null },
        });
        addTransfer(transfers, balances, keeperId, player.id, amount, {
          betType: kind,
          hole: lastEventHole,
          metadata: { nine, quantity, unitValue: value, pressed, multiplier, bagValue, lastEventHole: lastEventHole ?? null },
        });
      }
    }
    return { nine, holes, quantity, pressed, multiplier, value, bagValue, events: valuedEvents, keeperId, lastEventHole, candidateIds, needsTieBreak, settled, balances: halfBalances, transfers: halfTransfers };
  });
  return { kind, halves, balances, transfers, totalQuantity: halves.reduce((sum, half) => sum + half.quantity, 0), totalBagValue: roundMoney(halves.reduce((sum, half) => sum + half.bagValue, 0)), zeroSum: isZeroSum(balances), settlementMode: "halves" as const };
}

export function modeMultiplier(mode?: LobaMode) {
  if (mode === "solo") return 2;
  if (mode === "solo_anticipated") return 3;
  return 1;
}

export function validateLobaHole(hole: LobaHole | undefined, participantIds: string[]) {
  return validateLobaHoleErrors(hole, participantIds)[0] || "";
}

export function validateLobaHoleErrors(hole: LobaHole | undefined, participantIds: string[]) {
  const errors: string[] = [];
  if (participantIds.length < 2) errors.push("Selecciona al menos dos jugadores para 🐺 Loba.");
  if (!hole?.lobaPlayerId || !participantIds.includes(hole.lobaPlayerId)) errors.push("Selecciona quién es la 🐺 Loba.");
  if (!hole?.mode) errors.push("Selecciona la modalidad de 🐺 Loba.");
  if (hole?.mode === "partner" && (!hole.partnerId || hole.partnerId === hole.lobaPlayerId || !participantIds.includes(hole.partnerId))) errors.push("Selecciona la pareja de la 🐺 Loba.");
  if (hole?.mode === "partner" && participantIds.length === 2 && hole.partnerId && participantIds.includes(hole.partnerId)) errors.push("Con dos jugadores, la 🐺 Loba debe jugar sola para conservar un contrario.");
  if (!Number.isFinite(hole?.fireMultiplier) || (hole?.fireMultiplier ?? 0) < 1) errors.push("Define el multiplicador 🔥 del hoyo.");
  return errors;
}

export function calculateLoba(
  course: Course,
  scores: Record<number, HoleScore>,
  allPlayers: Player[],
  config: BetConfig["loba"],
  holes: Record<number, LobaHole>,
  order: number[],
  completedHoles?: ReadonlySet<number>,
  basis: RoundHandicapBasis = "relative",
) {
  const configuredParticipantIds = Array.isArray(config?.participantIds) ? config.participantIds : [];
  const participants = allPlayers.filter(player => configuredParticipantIds.includes(player.id));
  const participantIds = participants.map(player => player.id);
  const missingHandicapPlayerIds = playersMissingRoundHandicap(participants).map((player) => player.id);
  const handicapBases = baseHandicaps(participants, basis);
  const hcpPct = config?.hcpPct ?? 100;
  const configIsValid = config?.enabled !== true || (
    hasCleanParticipants(allPlayers, config.participantIds, 2)
    && isFiniteNonNegative(config.value)
    // HCP percentage did not exist in early Loba snapshots and was 100%.
    && (config.hcpPct === undefined || (Number.isFinite(config.hcpPct) && config.hcpPct >= 0 && config.hcpPct <= 100))
    && typeof config.unitsEnabled === "boolean"
    && (!config.unitsEnabled || typeof config.duplicateUnitsByMode === "boolean")
    && (!config.unitsEnabled || isFiniteNonNegative(config.unitValue))
  );
  const balances = Object.fromEntries(participants.map(player => [player.id, 0])) as Record<string, number>;
  const transfers: Transfer[] = [];
  const details = order.flatMap(holeNumber => {
    const capture = holes && typeof holes === "object" ? holes[holeNumber] : undefined;
    const validationError = validateLobaHole(capture, participantIds);
    if (config?.enabled !== true || !configIsValid || !capture || missingHandicapPlayerIds.length || participantIds.some((id) => !Number.isFinite(handicapBases[id])) || validationError || (completedHoles && !completedHoles.has(holeNumber))) return [];
    const holeDefinition = course.holes.find(hole => hole.number === holeNumber);
    if (!holeDefinition || !completedHole(holeNumber, scores, participantIds)) return [];
    const unitCounts = Object.fromEntries(participantIds.map((id) => {
      const captured = capture.unitCounts?.[id];
      return [id, isFiniteNonNegative(captured) ? Math.trunc(captured) : 0];
    }));
    const safeCapture: LobaHole = { ...capture, unitCounts };
    const lobaTeam = safeCapture.mode === "partner" ? [safeCapture.lobaPlayerId!, safeCapture.partnerId!] : [safeCapture.lobaPlayerId!];
    const opponents = participantIds.filter(id => !lobaTeam.includes(id));
    if (!lobaTeam.length || !opponents.length) return [];
    const netScores = Object.fromEntries(participants.map(player => {
      const playingHcp = playingHandicap(handicapBases[player.id], hcpPct, "round");
      const allowance = strokeAllowanceForHole(playingHcp, holeDefinition.strokeIndex, "round");
      return [player.id, (scores[holeNumber][player.id] as number) - allowance];
    })) as Record<string, number>;
    const lobaBestNet = Math.min(...lobaTeam.map(id => netScores[id]));
    const opponentBestNet = Math.min(...opponents.map(id => netScores[id]));
    const winner: LobaWinner = Math.abs(lobaBestNet - opponentBestNet) < EPSILON
      ? "tie"
      : lobaBestNet < opponentBestNet ? "loba_team" : "opponents";
    const multiplier = modeMultiplier(safeCapture.mode);
    const fireMultiplier = safeCapture.fireMultiplier;
    const effectiveValue = roundMoney(config.value * multiplier * fireMultiplier);
    const unitMultiplier = config.duplicateUnitsByMode ? multiplier : 1;
    const effectiveUnitValue = roundMoney((config.unitsEnabled ? config.unitValue : 0) * unitMultiplier);
    const holeBalances = Object.fromEntries(participants.map(player => [player.id, 0])) as Record<string, number>;
    const holeTransfers: Transfer[] = [];
    if (winner !== "tie") {
      const winners = winner === "loba_team" ? lobaTeam : opponents;
      const losers = winner === "loba_team" ? opponents : lobaTeam;
      for (const loser of losers) for (const winner of winners) {
        addTransfer(holeTransfers, holeBalances, loser, winner, effectiveValue, { betType: "loba", hole: holeNumber, metadata: { component: "base", multiplier, fireMultiplier } });
        addTransfer(transfers, balances, loser, winner, effectiveValue, { betType: "loba", hole: holeNumber, metadata: { component: "base", multiplier, fireMultiplier } });
      }
    }
    const playerUnits = Object.fromEntries(participants.map(player => {
      const automatic = config.unitsEnabled
        ? automaticUnitsForScore(scores[holeNumber][player.id] as number, holeDefinition.par)
        : 0;
      const capturedUnits = safeCapture.unitCounts[player.id];
      const manual = config.unitsEnabled && isFiniteNonNegative(capturedUnits) ? Math.trunc(capturedUnits) : 0;
      return [player.id, { automatic, manual, total: automatic + manual }];
    })) as Record<string, { automatic: number; manual: number; total: number }>;
    const lobaAutomaticUnits = lobaTeam.reduce((sum, id) => sum + playerUnits[id].automatic, 0);
    const lobaManualUnits = lobaTeam.reduce((sum, id) => sum + playerUnits[id].manual, 0);
    const opponentAutomaticUnits = opponents.reduce((sum, id) => sum + playerUnits[id].automatic, 0);
    const opponentManualUnits = opponents.reduce((sum, id) => sum + playerUnits[id].manual, 0);
    const lobaUnits = lobaAutomaticUnits + lobaManualUnits;
    const opponentUnits = opponentAutomaticUnits + opponentManualUnits;
    if (config.unitsEnabled && effectiveUnitValue > 0) {
      for (const lobaPlayer of lobaTeam) for (const opponent of opponents) {
        if (lobaUnits > 0) {
          const amount = lobaUnits * effectiveUnitValue;
          addTransfer(holeTransfers, holeBalances, opponent, lobaPlayer, amount, { betType: "loba_units", hole: holeNumber, metadata: { teamUnits: lobaUnits, effectiveUnitValue } });
          addTransfer(transfers, balances, opponent, lobaPlayer, amount, { betType: "loba_units", hole: holeNumber, metadata: { teamUnits: lobaUnits, effectiveUnitValue } });
        }
        if (opponentUnits > 0) {
          const amount = opponentUnits * effectiveUnitValue;
          addTransfer(holeTransfers, holeBalances, lobaPlayer, opponent, amount, { betType: "loba_units", hole: holeNumber, metadata: { teamUnits: opponentUnits, effectiveUnitValue } });
          addTransfer(transfers, balances, lobaPlayer, opponent, amount, { betType: "loba_units", hole: holeNumber, metadata: { teamUnits: opponentUnits, effectiveUnitValue } });
        }
      }
    }
    return [{
      hole: holeNumber,
      capture: safeCapture,
      lobaTeam,
      opponents,
      winner,
      hcpPct,
      netScores,
      lobaBestNet,
      opponentBestNet,
      multiplier,
      fireMultiplier,
      effectiveValue,
      effectiveUnitValue,
      playerUnits,
      lobaAutomaticUnits,
      lobaManualUnits,
      opponentAutomaticUnits,
      opponentManualUnits,
      lobaUnits,
      opponentUnits,
      balances: holeBalances,
      transfers: holeTransfers,
    }];
  });
  return { balances, transfers, details, zeroSum: isZeroSum(balances), missingHandicapPlayerIds };
}

export function requiredSideBetCapture(
  holeNumber: number,
  enabledCounterBets: Array<{ kind: CounterBetKind; config: CounterBetConfig }>,
  keepers: CounterBetKeepers,
  lobaConfig: { enabled: boolean; participantIds: string[] },
  lobaHole: LobaHole | undefined,
  events: CounterBetEvent[] = [],
  order: number[] = Array.from({ length: 18 }, (_, index) => index + 1),
) {
  return requiredSideBetCaptures(holeNumber, enabledCounterBets, keepers, lobaConfig, lobaHole, events, order)[0] || "";
}

export function requiredSideBetCaptures(
  holeNumber: number,
  enabledCounterBets: Array<{ kind: CounterBetKind; config: CounterBetConfig }>,
  keepers: CounterBetKeepers,
  lobaConfig: { enabled: boolean; participantIds: string[] },
  lobaHole: LobaHole | undefined,
  events: CounterBetEvent[] = [],
  order: number[] = Array.from({ length: 18 }, (_, index) => index + 1),
) {
  const errors: string[] = [];
  for (const { kind, config } of enabledCounterBets) {
    if (config.enabled !== true) continue;
    const nine = physicalNineForHole(holeNumber);
    const holes = order.filter(currentHole => physicalNineForHole(currentHole) === nine);
    if (!holes.length || holeNumber !== holes.at(-1)) continue;
    const meta = COUNTER_BET_META[kind];
    const { hole: lastEventHole, candidates } = latestCounterBetCandidates(kind, config.participantIds, events, holes);
    if (candidates.length < 2) continue;
    if (kind === "vipers") {
      const missingDistance = candidates.some(candidate => !Number.isFinite(candidate.distanceToHole) || (candidate.distanceToHole as number) < 0);
      if (missingDistance) errors.push(`Captura la distancia al hoyo de quienes hicieron la última ${meta.emoji} ${meta.singular} en H${lastEventHole}.`);
      else if (!viperKeeper(candidates)) errors.push(`Las distancias de la última ${meta.emoji} ${meta.singular} siguen empatadas; define una distancia distinta para identificar la bola más cercana.`);
    } else if (!keepers[kind]?.[nine] || !candidates.some(candidate => candidate.playerId === keepers[kind]?.[nine])) {
      errors.push(`Selecciona quién generó el último ${meta.emoji} ${meta.singular} en H${lastEventHole}.`);
    }
  }
  if (lobaConfig.enabled === true) errors.push(...validateLobaHoleErrors(lobaHole, lobaConfig.participantIds));
  return errors;
}
