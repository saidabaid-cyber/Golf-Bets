import * as engine from "./engine";
import { calculateCounterBet, calculateLoba, emptyCounterBetKeepers, snapshotCounterBetEvents } from "./side-bets";
import { calculateSupplementalBets } from "./supplemental-bets";
import { isPersonalSupplementalType } from "./bet-activation";
import { roundBetResult } from "./round-betting-boundary";
import { firstIncompleteRoundCapture, incompleteCoreBetSettlements, incompleteExternalPersonalBets, unsettledSupplementalBetResults } from "./round-completion";
import { pollaDetailBalances } from "./result-breakdown";
import { buildPersonalOpponentResults } from "./personal-opponents";
import { snapshotPersonalResult } from "./personal-history";
import { slidingAdjustment } from "./personal-modes";
import { isFiniteZeroSum } from "./settlement-integrity";
import { SharedLiveError, sharedRoundComplete } from "./shared-round-live";
import type { RoundSnapshot } from "./types";

/** The existing engines calculate the canonical card; no participant supplies
 * balances or a replacement snapshot. Incomplete cards remain live. */
export function finalizeSharedRound(round: RoundSnapshot, now: string): RoundSnapshot {
  if (!sharedRoundComplete(round) || !round.courseSnapshot || !round.betConfig || !round.ownerId)
    throw new SharedLiveError("INCOMPLETE_CARD", 409, "Completa los scores de la tarjeta antes de finalizar.");
  const course = round.courseSnapshot, bets = round.betConfig, players = round.players!, order = round.order!, scores = round.scores!, ownerId = round.ownerId;
  const mode = round.presentation?.playMode, basis = round.handicapBasis || "relative";
  const putts = round.putts || {}, segments = round.segments || [], personalBets = round.personalBets || [], supplementalBets = round.supplementalBets || [];
  const counterBetEvents = round.counterBetEvents || [], counterBetKeepers = round.counterBetKeepers || emptyCounterBetKeepers();
  const incomplete = firstIncompleteRoundCapture({ order, players, scores, bets, segments, supplementalBets, putts,
    counterBetEvents, counterBetKeepers, lobaHoles: round.lobaHoles || {}, ballFriendSetup: round.ballFriendSetup || {} });
  if (mode !== "score_only" && incomplete) throw new SharedLiveError("INCOMPLETE_BET_CAPTURE", 409, `Hoyo ${incomplete.holeNumber}: ${incomplete.errors.join(" ")}`);
  const rabbits = roundBetResult(mode, "calculateRabbits", () => engine.calculateRabbits(course, scores, players, bets.rabbits, order, basis));
  const skins = roundBetResult(mode, "calculateSkins", () => engine.calculateSkins(course, scores, players, bets.skins, order, basis));
  const units = roundBetResult(mode, "calculateUnits", () => engine.calculateUnits(players, round.unitEvents || [], bets.units, course, scores, order));
  const monkey = roundBetResult(mode, "calculateMonkey", () => engine.calculateMonkey(course, scores, players, bets.monkey, order, basis));
  const foursomes = roundBetResult(mode, "calculateFoursomes", () => engine.calculateFoursomes(course, scores, players, bets.foursome, segments, order, basis));
  const ballFriend = roundBetResult(mode, "calculateBallFriend", () => engine.calculateBallFriend(course, scores, players, bets.ballFriend, round.ballFriendSetup || {}, order, basis));
  const personals = roundBetResult(mode, "calculatePersonalBets", () => engine.calculatePersonalBets(personalBets, ownerId, players, course, scores, order));
  const polla = roundBetResult(mode, "calculatePolla", () => engine.calculatePolla(course, scores, players, bets.polla, order, basis));
  const miniPolla = roundBetResult(mode, "calculateMiniPolla", () => engine.calculateMiniPolla(course, scores, players, bets.miniPolla, order, basis));
  const manual = roundBetResult(mode, "calculateManualBets", () => engine.calculateManualBets(players, round.manualBets || []));
  const supplemental = roundBetResult(mode, "calculateSupplementalBets", () => calculateSupplementalBets(supplementalBets, players, course, scores, putts, order, basis));
  const completed = new Set(order);
  const vipers = roundBetResult(mode, "calculateCounterBet", () => calculateCounterBet("vipers", players, bets.vipers, counterBetEvents, counterBetKeepers, order, completed));
  const camels = roundBetResult(mode, "calculateCounterBet", () => calculateCounterBet("camels", players, bets.camels, counterBetEvents, counterBetKeepers, order, completed));
  const fish = roundBetResult(mode, "calculateCounterBet", () => calculateCounterBet("fish", players, bets.fish, counterBetEvents, counterBetKeepers, order, completed));
  const loba = roundBetResult(mode, "calculateLoba", () => calculateLoba(course, scores, players, bets.loba, round.lobaHoles || {}, order, completed, basis));
  const unfinished = incompleteCoreBetSettlements({ order, bets, segments, foursomeMatches: foursomes.matches, pollaDetails: polla.details, miniPollaDetails: miniPolla.details,
    personalBets, personalResults: personals.results, monkey, ballFriendDetails: ballFriend.details, loba });
  if (mode !== "score_only" && (unfinished.length || unsettledSupplementalBetResults(supplemental.results).length || incompleteExternalPersonalBets(personalBets, personals.results).length
    || supplemental.results.length !== supplementalBets.filter(b => b.enabled !== false).length))
    throw new SharedLiveError("PROVISIONAL_BETS", 409, `Revisa las apuestas pendientes antes de liquidar. ${unfinished.join(", ")}`);
  const rabbitBalances = engine.payoutWinnerTakesFromAll(engine.playersByIds(players, bets.rabbits.participantIds), rabbits.won, bets.rabbits.value);
  const skinBalances = engine.payoutWinnerTakesFromAll(engine.playersByIds(players, bets.skins.participantIds), skins.won, bets.skins.value);
  const playerBalances = engine.mergeBalances(players, rabbitBalances, skinBalances, units.balances, monkey.balances, foursomes.balances, ballFriend.balances,
    polla.balances, miniPolla.balances, supplemental.balances, personals.balances, manual.balances, vipers.balances, camels.balances, fish.balances, loba.balances);
  if (!isFiniteZeroSum(Object.values(playerBalances))) throw new SharedLiveError("INVALID_SETTLEMENT", 409, "La liquidación no suma cero.");
  const general = supplemental.results.filter(r => !isPersonalSupplementalType(r.type));
  const personalCombined = engine.mergeBalances(players, personals.balances, ...supplemental.results.filter(r => isPersonalSupplementalType(r.type)).map(r => r.balances));
  const categoryBalances = { Conejos: rabbitBalances, Skins: skinBalances, Unidades: units.balances, Monkey: monkey.balances, Foursome: foursomes.balances, "Bola Amiga": ballFriend.balances,
    "Polla 1ª vuelta": pollaDetailBalances(polla.details.find(d => d.key === "first9")), "Polla 2ª vuelta": pollaDetailBalances(polla.details.find(d => d.key === "second9")),
    "Polla Nassau": pollaDetailBalances(polla.details.find(d => d.key === "total18")), "Mini Polla": pollaDetailBalances(miniPolla.details.find(d => d.key === "mini")), "🐍 Víboras": vipers.balances,
    "🐫 Camellos": camels.balances, "🐟 Peces": fish.balances, "🐺 Loba": loba.balances,
    ...Object.fromEntries(general.map((r, i) => [`${r.label}${general.length > 1 ? ` ${i + 1}` : ""}`, r.balances])), Personales: personalCombined, Manuales: manual.balances };
  const personalOpponentResults = buildPersonalOpponentResults({ ownerId, players, course, scores, putts, order, canonicalResults: personals.results, personalBets, supplementalBets, handicapBasis: basis });
  const betResult = playerBalances[ownerId] || 0, expenseTotal = round.expenseTotal || 0;
  return { ...round, lifecycleState: "completed", completedAt: now, updatedAt: now, playerBalances, categoryBalances, betResult, netResult: betResult - expenseTotal,
    categoryResults: { ...Object.fromEntries(Object.entries(categoryBalances).map(([key, balances]) => [key, balances[ownerId] || 0])), Personales: personalOpponentResults.reduce((sum, r) => sum + r.amount, 0) },
    resultDetails: { rabbits, skins, units, monkey, foursomes, ballFriend, polla, miniPolla, vipers, camels, fish, loba, supplemental, personals, manual,
      settlementTransfers: engine.settleBalances(playerBalances), settlementDifference: Object.values(playerBalances).reduce((a, b) => a + b, 0) },
    counterBetEvents: snapshotCounterBetEvents(counterBetEvents, { vipers: bets.vipers, camels: bets.camels, fish: bets.fish }, order), personalOpponentResults,
    personalResults: personals.results.map(r => snapshotPersonalResult(personalBets.find(b => b.id === r.betId)!, r, players)),
    personalSlidingAdjustments: personalBets.flatMap(bet => { const r = personals.results.find(r => r.betId === bet.id); if (!r) return []; const adjustment = slidingAdjustment({ bet, ownerResult: r.totalMoney, rivalKey: engine.personalRivalKey(bet), roundId: round.id, updatedAt: now }); return adjustment ? [adjustment] : []; }) };
}
