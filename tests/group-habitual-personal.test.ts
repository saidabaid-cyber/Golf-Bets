import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyGroupGameTemplate, frequentGroupTemplateDetails, instantiateGroupGameTemplate, templateWithoutPlayerAssignments, updateGroupTemplateFromRound } from "../lib/group-game-template";
import { parseFrequentGroups, serializeFrequentGroups } from "../lib/frequent-templates";
import { calculatePersonalBet } from "../lib/engine";
import { calculateSupplementalBets } from "../lib/supplemental-bets";
import { groupTemplateConfigurationIssues } from "../lib/group-template-editor";
import { normalizeRoundDraft } from "../lib/round-utils";
import { fullRoundCourse } from "./fixtures/full-round";
import type { FrequentGroup, IndividualNassauBet, PersonalBet } from "../lib/types";

function fixture() {
  const group: FrequentGroup = { id: "habitual", name: "Miércoles", uses: 0, updatedAt: "initial", players: [
    { memberId: "said", name: "Said", accountUserId: "said-account", handicap: 8 },
    { memberId: "diego", name: "Diego", accountUserId: "diego-account", handicap: 4.8 },
    { memberId: "carlos", name: "Carlos", accountUserId: "carlos-account", handicap: 8.2 },
    { memberId: "mariana", name: "Mariana", accountUserId: "mariana-account", handicap: 12.4 },
  ] };
  group.gameTemplate = createEmptyGroupGameTemplate(group);
  group.gameTemplate.personalBets = [{ id: "personal-stable", enabled: true, rivalMode: "group", rivalName: "Carlos", externalScores: {}, baseValue: 100, advantageReceiver: "rival", advantageStrokes: 2, back9Multiplier: 1, pressureMultiplier: 2, nassauVersion: 2, carryEnabled: true, components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true }, memberAssignment: { principalMemberId: "said", rivalMemberId: "carlos" } }];
  group.gameTemplate = templateWithoutPlayerAssignments(group.gameTemplate);
  return parseFrequentGroups(serializeFrequentGroups([group]))[0];
}
let sequence = 0;
const id = () => `runtime-${++sequence}`;

test("habitual personal persists stable member identities and all rules, without runtime IDs", () => {
  const group = fixture(), bet = group.gameTemplate!.personalBets[0];
  assert.deepEqual(bet.memberAssignment, { principalMemberId: "said", rivalMemberId: "carlos" });
  assert.equal(bet.rivalPlayerId, undefined); assert.equal(bet.advantageStrokes, 2); assert.equal(bet.carryEnabled, true); assert.equal(bet.pressureMultiplier, 2);
  const round = instantiateGroupGameTemplate(group, id, ["said", "carlos", "diego"]);
  const personal = round.supplementalBets[0] as IndividualNassauBet;
  assert.equal(personal.type, "individual_nassau"); assert.equal(personal.enabled, true);
  assert.equal(personal.playerAId, round.origin.roundPlayerIdByMemberId.said); assert.equal(personal.playerBId, round.origin.roundPlayerIdByMemberId.carlos);
  assert.equal(personal.advantageReceiverId, personal.playerBId); assert.equal(personal.value, 100); assert.deepEqual(personal.components, bet.components); assert.equal(group.players.length, 4);
});

for (const selected of [["said", "diego"], ["carlos", "diego"], ["diego", "mariana"]]) test(`missing habitual participant never activates silently: ${selected}`, () => {
  const group = fixture(), before = serializeFrequentGroups([group]);
  const round = instantiateGroupGameTemplate(group, id, selected), personal = round.supplementalBets[0] as IndividualNassauBet;
  assert.equal(personal.enabled, false); assert.ok(personal.pendingHabitualPair); assert.equal(personal.pendingHabitualPair.rivalName, "Carlos");
  assert.equal(serializeFrequentGroups([group]), before);
});

test("habitual pair uses the proven Nassau engine, including independent carry and pressure", () => {
  const group = fixture(), round = instantiateGroupGameTemplate(group, id, ["said", "carlos"]);
  const bet = round.supplementalBets[0] as IndividualNassauBet;
  const order = Array.from({ length: 18 }, (_, i) => i + 1);
  const scores = Object.fromEntries(order.map(hole => [hole, { [bet.playerAId]: 4, [bet.playerBId]: hole <= 9 ? 4 : 5 }]));
  // No advantage for this carry case: the first Match AND Medal tie exactly.
  bet.advantageStrokes = 0;
  const direct: PersonalBet = { ...group.gameTemplate!.personalBets[0], advantageStrokes: 0, rivalPlayerId: bet.playerBId, rivalName: "Carlos" };
  const expected = calculatePersonalBet(direct, bet.playerAId, fullRoundCourse, scores, order);
  const result = calculateSupplementalBets([bet], round.players, fullRoundCourse, scores, {}, order);
  assert.equal(result.results[0].balances[bet.playerAId], expected.totalMoney);
  assert.equal(result.results[0].balances[bet.playerBId], -expected.totalMoney);
  const match = expected.liveComponents.find(component => component.key === "match2")!;
  const medal = expected.liveComponents.find(component => component.key === "medal2")!;
  assert.equal(match.carryIn, 100); assert.equal(medal.carryIn, 100); assert.equal(match.stake, 300); assert.equal(medal.stake, 300);
  direct.components.medal1 = false; bet.components.medal1 = false;
  const separate = calculatePersonalBet(direct, bet.playerAId, fullRoundCourse, scores, order);
  assert.equal(separate.liveComponents.find(component => component.key === "match2")!.carryIn, 100);
  assert.equal(separate.liveComponents.find(component => component.key === "medal2")!.carryIn, 0);
});

test("runtime edits are isolated; only explicit update stores the changed habitual pair and value", () => {
  const group = fixture(), frozen = serializeFrequentGroups([group]);
  const round = instantiateGroupGameTemplate(group, id, ["said", "carlos", "diego"]), bet = round.supplementalBets[0] as IndividualNassauBet;
  bet.value = 300; bet.playerBId = round.origin.roundPlayerIdByMemberId.diego;
  assert.equal(serializeFrequentGroups([group]), frozen);
  const updated = updateGroupTemplateFromRound(group, round.origin, round, "updated"); assert.equal(updated.status, "updated");
  const personal = updated.group.gameTemplate!.personalBets[0]; assert.equal(personal.baseValue, 300);
  assert.deepEqual(personal.memberAssignment, { principalMemberId: "said", rivalMemberId: "diego" });
  assert.equal(personal.id, "personal-stable"); assert.equal(personal.carryEnabled, true); assert.equal(personal.pressureMultiplier, 2);
  assert.equal(serializeFrequentGroups([group]), frozen);
});

test("a recurring personal cannot select the same member on both sides", () => {
  const group = fixture(); group.gameTemplate!.personalBets[0].memberAssignment!.rivalMemberId = "said";
  assert.ok(groupTemplateConfigurationIssues(group.gameTemplate!, group.players.map(member => ({ id: member.memberId!, name: member.name, handicap: member.handicap }))).blocking.some(issue => issue.code.endsWith("same-player")));
});

test("saving other round defaults does not erase a rival absent only today", () => {
  const group = fixture(), round = instantiateGroupGameTemplate(group, id, ["said", "diego"]);
  const bet = round.supplementalBets[0] as IndividualNassauBet;
  assert.equal(bet.enabled, false);
  bet.value = 150;
  const updated = updateGroupTemplateFromRound(group, round.origin, round, "updated");
  assert.equal(updated.status, "updated");
  const habitual = updated.group.gameTemplate!.personalBets[0];
  assert.deepEqual(habitual.memberAssignment, { principalMemberId: "said", rivalMemberId: "carlos" });
  assert.equal(habitual.enabled, true); assert.equal(habitual.baseValue, 150);
  assert.equal(habitual.advantageReceiver, "rival");
});

test("habitual personal summary and validation use the selected member pair", () => {
  const group = fixture(), players = group.players.map(member => ({ id: member.memberId!, name: member.name, handicap: member.handicap }));
  assert.ok(frequentGroupTemplateDetails(group).includes("Nassau individual · Said vs Carlos $100"));
  assert.equal(groupTemplateConfigurationIssues(group.gameTemplate!, players).pending.some(issue => issue.code.includes("rival")), false);
  // A principal distinct from the template owner is still a valid habitual duel.
  group.gameTemplate!.personalBets[0].memberAssignment!.principalMemberId = "diego";
  assert.equal(groupTemplateConfigurationIssues(group.gameTemplate!, players).pending.some(issue => issue.code.includes("rival")), false);
  group.gameTemplate!.personalBets[0].baseValue = -1;
  assert.ok(groupTemplateConfigurationIssues(group.gameTemplate!, players).blocking.some(issue => issue.code.endsWith("stake")));
});


test("round reload preserves recurring pair, carry and pressure instead of applying legacy migration", () => {
  const group = fixture(), round = instantiateGroupGameTemplate(group, id, ["said", "carlos"]);
  const draft = normalizeRoundDraft({ ...round, roundId: "same-round", course: fullRoundCourse, courseSelected: true, handicapBasis: round.roundHandicapBasis })!;
  assert.deepEqual(draft.supplementalBets, round.supplementalBets);
  assert.equal(draft.personalBets.length, 0);
});
