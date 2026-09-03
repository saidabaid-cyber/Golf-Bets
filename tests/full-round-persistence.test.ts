import assert from "node:assert/strict";
import test from "node:test";
import { calculateBallFriend, calculateFoursomes, calculateMiniPolla, calculatePersonalBets, calculatePolla, calculateRabbits, calculateSkins, calculateUnits, mergeBalances, payoutWinnerTakesFromAll } from "../lib/engine";
import { ensureHoleScoresAtPar, privateLeaderboard } from "../lib/round-utils";
import { fullRoundBallFriend, fullRoundBets, fullRoundCourse, fullRoundOrder, fullRoundPersonal, fullRoundPlayers, fullRoundScores, fullRoundSegments } from "./fixtures/full-round";
import type { HoleScore } from "../lib/types";

test("H1–18: Par real, todos los juegos, Cómo Vamos y settlement sobreviven cada recarga", () => {
  let draft = {
    course: structuredClone(fullRoundCourse), players: structuredClone(fullRoundPlayers),
    bets: structuredClone(fullRoundBets), order: [...fullRoundOrder],
    segments: structuredClone(fullRoundSegments), personalBets: [structuredClone(fullRoundPersonal)],
    ballFriendSetup: structuredClone(fullRoundBallFriend), scores: {} as Record<number, HoleScore>,
  };
  const evaluate = (state: typeof draft) => {
    const { course, players, bets, order, scores, segments, personalBets, ballFriendSetup } = state;
    const rabbits = calculateRabbits(course, scores, players, bets.rabbits, order);
    const skins = calculateSkins(course, scores, players, bets.skins, order);
    const units = calculateUnits(players, [], bets.units, course, scores, order);
    const foursome = calculateFoursomes(course, scores, players, bets.foursome, segments, order);
    const ballFriend = calculateBallFriend(course, scores, players, bets.ballFriend, ballFriendSetup, order);
    const polla = calculatePolla(course, scores, players, bets.polla, order);
    const mini = calculateMiniPolla(course, scores, players, bets.miniPolla, order);
    const personal = calculatePersonalBets(personalBets, "said", players, course, scores, order);
    const common = [payoutWinnerTakesFromAll(players, rabbits.won, bets.rabbits.value), payoutWinnerTakesFromAll(players, skins.won, bets.skins.value), units.balances, ballFriend.balances, polla.balances, mini.balances];
    return {
      rabbits, skins, units, foursome, ballFriend, polla, mini, personal,
      board: privateLeaderboard(course, players, scores, order),
      live: mergeBalances(players, ...common, foursome.provisionalBalances, personal.provisionalBalances),
      settled: mergeBalances(players, ...common, foursome.balances, personal.balances),
    };
  };
  for (const hole of draft.course.holes) {
    draft.scores = ensureHoleScoresAtPar(draft.scores, hole, draft.players);
    assert.ok(draft.players.every((player) => draft.scores[hole.number][player.id] === hole.par));
    assert.ok(evaluate(draft).board.every((row) => row.thru === hole.number));
    draft.scores[hole.number] = { ...fullRoundScores[hole.number] };
    const before = evaluate(draft);
    const storageValue = JSON.stringify(draft);
    draft = JSON.parse(storageValue) as typeof draft;
    assert.deepEqual(evaluate(draft), before, `Recarga H${hole.number}`);
    assert.equal(Object.values(before.live).reduce((sum, money) => sum + money, 0), 0);
    assert.equal(Object.values(before.settled).reduce((sum, money) => sum + money, 0), 0);
  }
  const final = evaluate(draft);
  assert.deepEqual(draft.scores, fullRoundScores);
  assert.deepEqual(final.live, final.settled);
  assert.ok(final.board.every((row) => row.finished));
  assert.ok(final.foursome.matches.every((match) => match.complete));
  assert.ok(final.polla.details.every((detail) => detail.complete));
  assert.ok(final.mini.details.every((detail) => detail.complete));
});
