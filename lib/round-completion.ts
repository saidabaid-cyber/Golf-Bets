import { opponentPairs } from "./engine";
import type { calculatePersonalBets } from "./engine";
import { collectHoleValidationErrors } from "./hole-validation";
import { roundCaptureFieldsForPlayer } from "./round-capture";
import { counterCaptureIsConfirmed } from "./side-bets";
import type { SupplementalBetResult } from "./supplemental-bets";
import type {
  BallFriendHole,
  BetConfig,
  CounterBetEvent,
  CounterBetKeepers,
  FoursomeSegment,
  HoleScore,
  LobaHole,
  PersonalBet,
  Player,
  PuttsByHole,
  SupplementalBet,
} from "./types";

type PersonalResult = ReturnType<typeof calculatePersonalBets>["results"][number];

export function abandonedPressurePlayersWithMissingScores(
  order: number[],
  players: Player[],
  scores: Record<number, HoleScore>,
  supplementalBets: SupplementalBet[],
) {
  const playerById = new Map(players.map((player) => [player.id, player]));
  const affectedIds = new Set<string>();
  for (const bet of supplementalBets) {
    if (bet.enabled === false || bet.type !== "team_pressures" || !Array.isArray(bet.abandonedPlayerIds)) continue;
    const participantIds = new Set(Array.isArray(bet.participantIds) ? bet.participantIds : []);
    for (const playerId of bet.abandonedPlayerIds) {
      if (!participantIds.has(playerId) || !playerById.has(playerId)) continue;
      if (order.some((hole) => typeof scores[hole]?.[playerId] !== "number")) affectedIds.add(playerId);
    }
  }
  return players.filter((player) => affectedIds.has(player.id));
}

type HoleResult = { hole: number };
type PollaResult = {
  key: "first9" | "second9" | "total18" | "mini";
  complete: boolean;
  winnerIds: string[];
};
type FoursomeSettlement = {
  segmentId: string;
  opponentPair: [string, string];
  completedHoles: number;
  complete: boolean;
  holePoints: HoleResult[];
};
type PersonalSettlement = {
  betId: string;
  liveComponents: Array<{ key: string; complete: boolean }>;
};

export type CoreBetSettlementInput = {
  order: number[];
  bets: BetConfig;
  segments: FoursomeSegment[];
  foursomeMatches: FoursomeSettlement[];
  pollaDetails: PollaResult[];
  miniPollaDetails: PollaResult[];
  personalBets: PersonalBet[];
  personalResults: PersonalSettlement[];
  monkey: { valid?: boolean; details: HoleResult[] };
  ballFriendDetails: HoleResult[];
  loba: { zeroSum?: boolean; details: Array<HoleResult & { winner: string }> };
};

function hasExactHoleCoverage(order: number[], details: HoleResult[]) {
  const detailedHoles = new Set(details.map((detail) => detail.hole));
  return order.length > 0
    && detailedHoles.size === details.length
    && details.length === order.length
    && order.every((hole) => detailedHoles.has(hole));
}

function pairKey(pair: readonly string[]) {
  return [...pair].sort().join("\u0000");
}

function foursomeIsSettled(input: CoreBetSettlementInput) {
  const expected = input.segments.flatMap((segment) => {
    const holes = input.order.slice(segment.startIndex, segment.endIndex + 1);
    return opponentPairs(input.bets.foursome.participantIds, segment.basePair).map((opponentPair) => ({
      segment,
      holes,
      key: `${segment.id}\u0000${pairKey(opponentPair)}`,
    }));
  });
  if (!expected.length || input.foursomeMatches.length !== expected.length) return false;

  const matchesByKey = new Map<string, FoursomeSettlement[]>();
  for (const match of input.foursomeMatches) {
    const key = `${match.segmentId}\u0000${pairKey(match.opponentPair)}`;
    matchesByKey.set(key, [...(matchesByKey.get(key) ?? []), match]);
  }
  return expected.every(({ holes, key }) => {
    const matches = matchesByKey.get(key) ?? [];
    const match = matches[0];
    return matches.length === 1
      && match.complete === true
      && match.completedHoles === holes.length
      && hasExactHoleCoverage(holes, match.holePoints);
  });
}

function pollaComponentIsSettled(details: PollaResult[], key: PollaResult["key"]) {
  const matches = details.filter((detail) => detail.key === key);
  return matches.length === 1 && matches[0].complete === true && matches[0].winnerIds.length > 0;
}

const PERSONAL_COMPONENT_KEYS = ["match1", "medal1", "match2", "medal2", "match18", "medal18"] as const;

function internalPersonalBetsAreSettled(input: CoreBetSettlementInput) {
  const applicableKeys = input.order.length >= 18
    ? PERSONAL_COMPONENT_KEYS
    : PERSONAL_COMPONENT_KEYS.slice(0, 2);
  const activeBets = input.personalBets.filter((bet) => bet.enabled !== false && bet.rivalMode === "group");

  return activeBets.every((bet) => {
    const expectedKeys = applicableKeys.filter((key) => bet.components[key]);
    const results = input.personalResults.filter((result) => result.betId === bet.id);
    if (!expectedKeys.length || results.length !== 1) return false;
    const components = results[0].liveComponents;
    const componentKeys = new Set(components.map((component) => component.key));
    return components.length === expectedKeys.length
      && componentKeys.size === components.length
      && expectedKeys.every((key) => components.some((component) => component.key === key && component.complete === true));
  });
}

/** Defense in depth for engines whose valid partial result is intentionally
 * zero-sum. The configuration and capture gates run first; this final check
 * prevents those provisional zeros from being archived as a liquidation. */
export function incompleteCoreBetSettlements(input: CoreBetSettlementInput) {
  const issues: string[] = [];
  const add = (label: string) => { if (!issues.includes(label)) issues.push(label); };

  if (input.bets.foursome.enabled && !foursomeIsSettled(input)) add("Foursome");

  const pollaComponents: Array<[boolean, PollaResult["key"], string]> = [
    [input.bets.polla.first9.enabled, "first9", "Polla 1ª vuelta"],
    [input.bets.polla.second9.enabled, "second9", "Polla 2ª vuelta"],
    [input.bets.polla.total18.enabled, "total18", "Polla Nassau"],
  ];
  for (const [active, key, label] of pollaComponents) {
    if (active && !pollaComponentIsSettled(input.pollaDetails, key)) add(label);
  }
  if (input.bets.miniPolla.enabled && !pollaComponentIsSettled(input.miniPollaDetails, "mini")) add("Mini Polla");

  if (!internalPersonalBetsAreSettled(input)) add("Personales");

  if (input.bets.monkey?.enabled && (input.monkey.valid !== true || !hasExactHoleCoverage(input.order, input.monkey.details))) add("Monkey");
  if (input.bets.ballFriend.enabled && !hasExactHoleCoverage(input.order, input.ballFriendDetails)) add("Bola Amiga");
  if (input.bets.loba.enabled && (
    input.loba.zeroSum !== true
    || !hasExactHoleCoverage(input.order, input.loba.details)
    || input.loba.details.some((detail) => !["loba_team", "opponents", "tie"].includes(detail.winner))
  )) add("Loba");
  return issues;
}

/** A completed history entry must never turn a provisional supplemental
 * calculation into a final ledger balance. */
export function unsettledSupplementalBetResults(
  results: Array<Pick<SupplementalBetResult, "betId" | "complete" | "label" | "type">>,
) {
  return results.filter((result) => result.complete !== true);
}

/** External rivals do not appear in the round-player scorecard, so their
 * selected Personal components need an explicit completion check at archive. */
export function incompleteExternalPersonalBets(bets: PersonalBet[], results: PersonalResult[]) {
  const resultById = new Map(results.map((result) => [result.betId, result]));
  return bets.filter((bet) => {
    if (bet.enabled === false || bet.rivalMode !== "external") return false;
    const result = resultById.get(bet.id);
    return !result || result.liveComponents.length === 0 || result.liveComponents.some((component) => !component.complete);
  });
}

export type RoundCaptureCompletionInput = {
  order: number[];
  players: Player[];
  scores: Record<number, HoleScore>;
  bets: BetConfig;
  segments: FoursomeSegment[];
  supplementalBets: SupplementalBet[];
  putts: PuttsByHole;
  counterBetKeepers: CounterBetKeepers;
  counterBetEvents: CounterBetEvent[];
  lobaHoles: Record<number, LobaHole>;
  ballFriendSetup: Record<number, BallFriendHole>;
};

type RequiredRoundCaptureFactsInput = Pick<
  RoundCaptureCompletionInput,
  "players" | "bets" | "supplementalBets" | "putts" | "counterBetEvents"
>;

/** Completeness contract shared by live digital capture and Card AI. A score
 * photo is not evidence that a bunker or water event was zero. */
export function requiredRoundCaptureFactErrors(
  input: RequiredRoundCaptureFactsInput,
  playedHoleIndex: number,
  holeNumber: number,
) {
  const missingPutts: string[] = [];
  const missingCamels: string[] = [];
  const missingFish: string[] = [];
  for (const player of input.players) {
    const fields = roundCaptureFieldsForPlayer({
      mode: "quick",
      playerId: player.id,
      playedHoleIndex,
      bets: input.bets,
      supplementalBets: input.supplementalBets,
    });
    const name = player.name.trim() || "Sin nombre";
    if (fields.includes("putts") && !Number.isInteger(input.putts[holeNumber]?.[player.id])) missingPutts.push(name);
    if (fields.includes("bunker") && !counterCaptureIsConfirmed(input.counterBetEvents, "camels", holeNumber, player.id)) missingCamels.push(name);
    if (fields.includes("fish") && !counterCaptureIsConfirmed(input.counterBetEvents, "fish", holeNumber, player.id)) missingFish.push(name);
  }
  return [
    ...(missingPutts.length ? [`Captura los putts de ${missingPutts.join(", ")} antes de continuar.`] : []),
    ...(missingCamels.length ? [`Confirma Camellos (bunker) de ${missingCamels.join(", ")}; usa 0 cuando no hubo.`] : []),
    ...(missingFish.length ? [`Confirma Peces (agua) de ${missingFish.join(", ")}; usa 0 cuando no hubo.`] : []),
  ];
}

/** Revalidates every played hole before archiving. This catches capture-driven
 * wagers enabled while correcting a round, after their original hole passed. */
export function firstIncompleteRoundCapture(input: RoundCaptureCompletionInput) {
  for (const [index, holeNumber] of input.order.entries()) {
    const errors = collectHoleValidationErrors({
      scoreCaptureComplete: input.players.length > 0 && input.players.every((player) => Number.isInteger(input.scores[holeNumber]?.[player.id]) && (input.scores[holeNumber]?.[player.id] as number) >= 1),
      holeNumber,
      players: input.players,
      counterBets: [
        { kind: "vipers", config: input.bets.vipers },
        { kind: "camels", config: input.bets.camels },
        { kind: "fish", config: input.bets.fish },
      ],
      counterBetKeepers: input.counterBetKeepers,
      counterBetEvents: input.counterBetEvents,
      lobaConfig: input.bets.loba,
      lobaHole: input.lobaHoles[holeNumber],
      foursomeConfig: input.bets.foursome,
      foursomeSegments: input.segments,
      order: input.order,
      ballFriendConfig: input.bets.ballFriend,
      ballFriendSetup: input.ballFriendSetup[holeNumber],
      extraErrors: requiredRoundCaptureFactErrors(input, index, holeNumber),
    });
    if (errors.length) return { index, holeNumber, errors };
  }
  return null;
}
