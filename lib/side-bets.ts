import type {
  BetConfig,
  CounterBetConfig,
  CounterBetEvent,
  CounterBetKeepers,
  CounterBetKind,
  Course,
  HoleScore,
  LobaHole,
  LobaMode,
  LobaWinner,
  Player,
  PhysicalNine,
  Transfer,
} from "./types";
import { automaticUnitsForScore, baseHandicaps, completedHole, playingHandicap, strokeAllowanceForHole } from "./engine";

const EPSILON = 0.0001;

export const COUNTER_BET_META: Record<CounterBetKind, { emoji: string; singular: string; plural: string; article: "las" | "los" }> = {
  vipers: { emoji: "🐍", singular: "Víbora", plural: "Víboras", article: "las" },
  camels: { emoji: "🐫", singular: "Camello", plural: "Camellos", article: "los" },
  fish: { emoji: "🐟", singular: "Pez", plural: "Peces", article: "los" },
};

export const emptyCounterBetKeepers = (): CounterBetKeepers => ({ vipers: {}, camels: {}, fish: {} });

export function physicalNineForHole(hole: number): PhysicalNine {
  return hole <= 9 ? "holes_1_9" : "holes_10_18";
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
  const remaining = events.filter(event => !(event.kind === kind && event.hole === hole && event.playerId === playerId));
  return nextQuantity > 0 ? [...remaining, { id, kind, hole, playerId, quantity: nextQuantity }] : remaining;
}

export function counterQuantity(events: CounterBetEvent[], kind: CounterBetKind, hole: number, playerId: string) {
  return events
    .filter(event => event.kind === kind && event.hole === hole && event.playerId === playerId)
    .reduce((sum, event) => sum + Math.max(0, Math.trunc(event.quantity || 0)), 0);
}

export type CounterBetHalfResult = {
  nine: PhysicalNine;
  holes: number[];
  quantity: number;
  multiplier: number;
  value: number;
  keeperId?: string;
  settled: boolean;
  balances: Record<string, number>;
  transfers: Transfer[];
};

export function calculateCounterBet(
  kind: CounterBetKind,
  allPlayers: Player[],
  config: CounterBetConfig,
  events: CounterBetEvent[],
  keepers: CounterBetKeepers,
  order: number[],
  completedHoles?: ReadonlySet<number>,
) {
  const participants = allPlayers.filter(player => config.participantIds.includes(player.id));
  const balances = Object.fromEntries(participants.map(player => [player.id, 0])) as Record<string, number>;
  const transfers: Transfer[] = [];
  const halves = (["holes_1_9", "holes_10_18"] as PhysicalNine[]).map((nine): CounterBetHalfResult => {
    const holes = order.filter(hole => physicalNineForHole(hole) === nine);
    const participantIds = new Set(participants.map(player => player.id));
    const quantity = events
      .filter(event => event.kind === kind && holes.includes(event.hole) && participantIds.has(event.playerId))
      .reduce((sum, event) => sum + Math.max(0, Math.trunc(event.quantity || 0)), 0);
    const multiplier = nine === "holes_10_18" ? Math.max(1, config.secondNineMultiplier || 1) : 1;
    const value = roundMoney(Math.max(0, config.value || 0) * multiplier);
    const keeperId = keepers[kind]?.[nine];
    const settled = Boolean(config.enabled && holes.length && keeperId && participantIds.has(keeperId) &&
      (!completedHoles || holes.every(hole => completedHoles.has(hole))));
    const halfBalances = Object.fromEntries(participants.map(player => [player.id, 0])) as Record<string, number>;
    const halfTransfers: Transfer[] = [];
    if (settled && keeperId && quantity > 0) {
      const amount = roundMoney(quantity * value);
      for (const player of participants) {
        if (player.id === keeperId) continue;
        addTransfer(halfTransfers, halfBalances, keeperId, player.id, amount, {
          betType: kind,
          metadata: { nine, quantity, unitValue: value, multiplier },
        });
        addTransfer(transfers, balances, keeperId, player.id, amount, {
          betType: kind,
          metadata: { nine, quantity, unitValue: value, multiplier },
        });
      }
    }
    return { nine, holes, quantity, multiplier, value, keeperId, settled, balances: halfBalances, transfers: halfTransfers };
  });
  return { kind, halves, balances, transfers, totalQuantity: halves.reduce((sum, half) => sum + half.quantity, 0), zeroSum: isZeroSum(balances) };
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
) {
  const participants = allPlayers.filter(player => config.participantIds.includes(player.id));
  const participantIds = participants.map(player => player.id);
  const handicapBases = baseHandicaps(participants);
  const configuredHcpPct = Number(config.hcpPct ?? 100);
  const hcpPct = Number.isFinite(configuredHcpPct)
    ? Math.min(100, Math.max(0, configuredHcpPct))
    : 100;
  const balances = Object.fromEntries(participants.map(player => [player.id, 0])) as Record<string, number>;
  const transfers: Transfer[] = [];
  const details = order.flatMap(holeNumber => {
    const capture = holes[holeNumber];
    const validationError = validateLobaHole(capture, participantIds);
    if (!config.enabled || validationError || (completedHoles && !completedHoles.has(holeNumber))) return [];
    const holeDefinition = course.holes.find(hole => hole.number === holeNumber);
    if (!holeDefinition || !completedHole(holeNumber, scores, participantIds)) return [];
    const lobaTeam = capture.mode === "partner" ? [capture.lobaPlayerId!, capture.partnerId!] : [capture.lobaPlayerId!];
    const opponents = participantIds.filter(id => !lobaTeam.includes(id));
    if (!lobaTeam.length || !opponents.length) return [];
    const netScores = Object.fromEntries(participants.map(player => {
      const playingHcp = playingHandicap(handicapBases[player.id] ?? 0, hcpPct, "round");
      const allowance = strokeAllowanceForHole(playingHcp, holeDefinition.strokeIndex, "round");
      return [player.id, (scores[holeNumber][player.id] as number) - allowance];
    })) as Record<string, number>;
    const lobaBestNet = Math.min(...lobaTeam.map(id => netScores[id]));
    const opponentBestNet = Math.min(...opponents.map(id => netScores[id]));
    const winner: LobaWinner = Math.abs(lobaBestNet - opponentBestNet) < EPSILON
      ? "tie"
      : lobaBestNet < opponentBestNet ? "loba_team" : "opponents";
    const multiplier = modeMultiplier(capture.mode);
    const fireMultiplier = Math.max(1, capture.fireMultiplier || 1);
    const effectiveValue = roundMoney(Math.max(0, config.value || 0) * multiplier * fireMultiplier);
    const unitMultiplier = config.duplicateUnitsByMode ? multiplier : 1;
    const effectiveUnitValue = roundMoney(Math.max(0, config.unitValue || 0) * unitMultiplier);
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
      const manual = config.unitsEnabled ? Math.max(0, Math.trunc(capture.unitCounts?.[player.id] || 0)) : 0;
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
      capture,
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
  return { balances, transfers, details, zeroSum: isZeroSum(balances) };
}

export function requiredSideBetCapture(
  holeNumber: number,
  enabledCounterBets: Array<{ kind: CounterBetKind; config: CounterBetConfig }>,
  keepers: CounterBetKeepers,
  lobaConfig: { enabled: boolean; participantIds: string[] },
  lobaHole: LobaHole | undefined,
) {
  return requiredSideBetCaptures(holeNumber, enabledCounterBets, keepers, lobaConfig, lobaHole)[0] || "";
}

export function requiredSideBetCaptures(
  holeNumber: number,
  enabledCounterBets: Array<{ kind: CounterBetKind; config: CounterBetConfig }>,
  keepers: CounterBetKeepers,
  lobaConfig: { enabled: boolean; participantIds: string[] },
  lobaHole: LobaHole | undefined,
) {
  const errors: string[] = [];
  const nine = holeNumber === 9 ? "holes_1_9" : holeNumber === 18 ? "holes_10_18" : undefined;
  if (nine) {
    for (const { kind, config } of enabledCounterBets) {
      if (config.enabled && !keepers[kind]?.[nine]) {
        const meta = COUNTER_BET_META[kind];
        errors.push(`Selecciona quién se quedó ${meta.article} ${meta.emoji} ${meta.plural} de esta vuelta.`);
      }
    }
  }
  if (lobaConfig.enabled) errors.push(...validateLobaHoleErrors(lobaHole, lobaConfig.participantIds));
  return errors;
}
