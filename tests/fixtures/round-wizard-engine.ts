import {
  baseHandicaps, calculateBallFriend, calculateFoursomes, calculateManualBets,
  calculateMiniPolla, calculateMonkey, calculatePersonalBets, calculatePolla,
  calculateRabbits, calculateSkins, calculateUnits, mergeBalances,
  payoutWinnerTakesFromAll, playOrder, playingHandicap, settleBalances,
  strokeAllowanceForHole,
} from "../../lib/engine";
import { initialBets } from "../../lib/new-round-bets";
import { privateLeaderboard } from "../../lib/round-utils";
import { calculateCounterBet, calculateLoba, emptyCounterBetKeepers } from "../../lib/side-bets";
import { calculateSupplementalBets, createSupplementalBet } from "../../lib/supplemental-bets";
import type {
  CounterBetEvent, CounterBetKind, LobaHole, ManualBet, RoundHandicapBasis, SupplementalBet,
} from "../../lib/types";
import {
  fullRoundBallFriend, fullRoundBets, fullRoundCourse, fullRoundPersonal,
  fullRoundPlayers, fullRoundScores, fullRoundSegments,
} from "./full-round";

/** Synthetic data only. These inputs predate the wizard and exercise the same
 * public engines used by the former single-page setup and the game screen. */
export function wizardEngineFixture(startHole: 1 | 10, handicapBasis: RoundHandicapBasis) {
  const players = structuredClone(fullRoundPlayers).map((player, index) => ({ ...player, handicap: [4, 12, 16, 8][index] }));
  const order = playOrder(startHole);
  const bets = structuredClone(fullRoundBets);
  bets.monkey = { ...initialBets(players.map((player) => player.id)).monkey!, enabled: true };
  bets.loba = { ...bets.loba, enabled: true, hcpPct: 100, unitsEnabled: true, value: 25, unitValue: 10 };
  for (const kind of ["vipers", "camels", "fish"] as const) {
    bets[kind] = {
      ...bets[kind], enabled: true, value: 20, settlementMode: "halves",
      secondNinePressed: true, secondNineMultiplier: 3,
      determinationMode: "most_events", mostEventsTieRule: "latest_tied_event",
    };
  }
  const counterBetEvents: CounterBetEvent[] = (["vipers", "camels", "fish"] as CounterBetKind[]).flatMap((kind, kindIndex) => [
    { id: `${kind}-first-a`, kind, hole: order[3], playerId: "said", quantity: 2, captureOrder: kindIndex * 4 + 1 },
    { id: `${kind}-first-b`, kind, hole: order[7], playerId: "cuau", quantity: 2, captureOrder: kindIndex * 4 + 2 },
    { id: `${kind}-second-a`, kind, hole: order[10], playerId: "armando", quantity: 3, captureOrder: kindIndex * 4 + 3 },
    { id: `${kind}-second-b`, kind, hole: order[14], playerId: "jesus", quantity: 1, captureOrder: kindIndex * 4 + 4 },
  ]);
  const supplementalTypes: SupplementalBet["type"][] = [
    "individual_nassau", "dollar_stroke", "individual_pressures", "team_pressures", "chicago", "vegas", "minimum_putts",
  ];
  return {
    course: structuredClone(fullRoundCourse), players, bets, order, startHole, roundHoles: 18 as const,
    handicapBasis, ownerId: "said", courseSelected: true,
    scores: structuredClone(fullRoundScores), segments: structuredClone(fullRoundSegments),
    personalBets: [{ ...structuredClone(fullRoundPersonal), pressureMultiplier: 3 as const }],
    manualBets: [{ id: "wizard-manual", name: "Ajuste privado", enabled: true, amounts: { said: 75, cuau: -75 } }] as ManualBet[],
    supplementalBets: supplementalTypes.map((type) => createSupplementalBet(type, players, `wizard-${type}`)),
    ballFriendSetup: structuredClone(fullRoundBallFriend), counterBetEvents,
    counterBetKeepers: emptyCounterBetKeepers(),
    putts: Object.fromEntries(order.map((hole) => [hole, { said: hole % 3 ? 2 : 1, cuau: 2, armando: hole % 4 ? 2 : 3, jesus: 2 }])),
    lobaHoles: Object.fromEntries(order.map((hole) => [hole, {
      lobaPlayerId: "said", partnerId: "cuau", mode: "partner", fireMultiplier: hole % 5 ? 1 : 2,
      unitCounts: (hole === order[0] ? { said: 1 } : {}) as Record<string, number>,
    } satisfies LobaHole])),
  };
}

export type WizardEngineFixture = ReturnType<typeof wizardEngineFixture>;

export function evaluateWizardEngineFixture(state: WizardEngineFixture) {
  const { course, players, bets, order, scores, handicapBasis: basis } = state;
  const rabbits = calculateRabbits(course, scores, players, bets.rabbits, order, basis);
  const skins = calculateSkins(course, scores, players, bets.skins, order, basis);
  const units = calculateUnits(players, [], bets.units, course, scores, order);
  const foursome = calculateFoursomes(course, scores, players, bets.foursome, state.segments, order, basis);
  const ballFriend = calculateBallFriend(course, scores, players, bets.ballFriend, state.ballFriendSetup, order, basis);
  const polla = calculatePolla(course, scores, players, bets.polla, order, basis);
  const miniPolla = calculateMiniPolla(course, scores, players, bets.miniPolla, order, basis);
  const monkey = calculateMonkey(course, scores, players, bets.monkey, order, basis);
  const personal = calculatePersonalBets(state.personalBets, state.ownerId, players, course, scores, order);
  const manual = calculateManualBets(players, state.manualBets);
  const supplemental = calculateSupplementalBets(state.supplementalBets, players, course, scores, state.putts, order, basis);
  const animals = (["vipers", "camels", "fish"] as const).map((kind) => calculateCounterBet(kind, players, bets[kind], state.counterBetEvents, state.counterBetKeepers, order, new Set(order)));
  const loba = calculateLoba(course, scores, players, bets.loba, state.lobaHoles, order, new Set(order), basis);
  const balances = mergeBalances(players,
    payoutWinnerTakesFromAll(players, rabbits.won, bets.rabbits.value),
    payoutWinnerTakesFromAll(players, skins.won, bets.skins.value), units.balances,
    foursome.balances, ballFriend.balances, polla.balances, miniPolla.balances,
    monkey.balances, personal.balances, manual.balances, supplemental.balances,
    ...animals.map((animal) => animal.balances), loba.balances,
  );
  const bases = baseHandicaps(players, basis);
  return {
    rabbits, skins, units, foursome, ballFriend, polla, miniPolla, monkey,
    personal, manual, supplemental, animals, loba, balances, transfers: settleBalances(balances),
    board: privateLeaderboard(course, players, scores, order),
    handicaps: {
      bases,
      eightyPercent: players.map((player) => playingHandicap(bases[player.id], 80, "decimal")),
      strokesByHole: order.map((hole) => players.map((player) => strokeAllowanceForHole(bases[player.id], course.holes[hole - 1].strokeIndex, "half_up"))),
    },
  };
}
