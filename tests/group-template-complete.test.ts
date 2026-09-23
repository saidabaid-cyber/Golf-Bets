import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectBetConfigurationIssues } from "../lib/bet-config-validation";
import { createEmptyGroupGameTemplate, createGroupGameTemplate, groupTemplatePlayers, instantiateGroupGameTemplate, normalizeGroupGameTemplate, updateGroupTemplateFromRound } from "../lib/group-game-template";
import { parseFrequentGroups, serializeFrequentGroups } from "../lib/frequent-templates";
import { groupTemplateConfigurationIssues, patchGroupTemplateCore } from "../lib/group-template-editor";
import { calculateFoursomes, calculateManualBets, playOrder, segmentDefinitions } from "../lib/engine";
import { counterBetEffectiveUnitValue } from "../lib/side-bets";
import type { FrequentGroup, GroupGameTemplate } from "../lib/types";
import { evaluateWizardEngineFixture, wizardEngineFixture, type WizardEngineFixture } from "./fixtures/round-wizard-engine";

function emptyGroup(): FrequentGroup {
  return { id: "group-test", name: "Habituales", uses: 0, updatedAt: "2026-09-17T12:00:00Z", players: [
    { memberId: "one", name: "Uno", handicap: null },
    { memberId: "two", name: "Dos", handicap: null },
  ] };
}

test("explicit manual template defaults persist and reach settlement without copying past results", () => {
  const group = emptyGroup();
  group.players = group.players.map(member => ({ ...member, handicap: 0 }));
  group.gameTemplate = createEmptyGroupGameTemplate(group);
  group.gameTemplate.manualBets = [{ id: "manual-default", name: "Manual habitual", amounts: { one: 999, two: -999 }, initialAmounts: { one: 125, two: -125 } }];
  const saved = parseFrequentGroups(serializeFrequentGroups([group]))[0];
  assert.deepEqual(saved.gameTemplate!.manualBets[0].amounts, { one: 0, two: 0 });
  assert.deepEqual(saved.gameTemplate!.manualBets[0].initialAmounts, { one: 125, two: -125 });
  assert.deepEqual(groupTemplateConfigurationIssues(saved.gameTemplate!, groupTemplatePlayers(saved)).blocking, []);
  let sequence = 0;
  const round = instantiateGroupGameTemplate(saved, () => `runtime-${++sequence}`);
  const [a, b] = round.players;
  assert.deepEqual(round.manualBets[0].amounts, { [a.id]: 125, [b.id]: -125 });
  assert.deepEqual(calculateManualBets(round.players, round.manualBets).balances, { [a.id]: 125, [b.id]: -125 });
  round.manualBets[0].amounts[a.id] = 500;
  assert.equal(saved.gameTemplate!.manualBets[0].initialAmounts!.one, 125);
  assert.equal(group.gameTemplate.manualBets[0].amounts.one, 999);
  saved.gameTemplate!.manualBets[0].initialAmounts!.two = -100;
  assert.ok(groupTemplateConfigurationIssues(saved.gameTemplate!, groupTemplatePlayers(saved)).blocking.some(issue => issue.code.endsWith("-balance")));
});

test("historical manual amounts never implicitly become group defaults", () => {
  const fixture = wizardEngineFixture(10, "relative");
  const template = createGroupGameTemplate({ ...fixture, roundHandicapBasis: fixture.handicapBasis }, Object.fromEntries(fixture.players.map(player => [player.id, player.id])));
  assert.ok(template.manualBets.every(bet => bet.initialAmounts === undefined && Object.values(bet.amounts).every(amount => amount === 0)));
});

test("habitual config shares inline selection/detail controls, not toggle-only screens", () => {
  const editor = readFileSync("app/components/group-bet-template-editor.tsx", "utf8");
  assert.match(editor, /Configurar \/ editar/);
  assert.match(editor, /if \(!active\) setExpandedBetId\(item.id\)/);
  assert.match(editor, /onlyBetId=\{item.id\}/);
  assert.match(editor, /aria-expanded=\{expanded\}/);
  assert.match(editor, /patchGroupTemplateCore\(current, key, patch\)/);
  assert.match(editor, /secondNineMultiplier: Number\(event.target.value\)/);
  assert.match(editor, /duplicateUnitsByMode: event.target.checked/);
  assert.match(editor, /<HandicapBaseControl/);
  assert.match(editor, /Componentes Nassau Match y Medal/);
  assert.match(editor, /initiallyExpandActive=\{Boolean\(onlyBetId\)\}/);
  assert.match(editor, /6 conejos fijos/);
  assert.match(editor, /No acumulados/);
  const page = readFileSync("app/page.tsx", "utf8");
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  assert.match(page, /mode="complete"/);
  assert.match(onboarding, /mode="complete"/);
  assert.doesNotMatch(onboarding, /mode="selection"/);
  assert.match(onboarding, /Selecciona tus apuestas habituales y ajusta aquí sus valores y reglas/);
  assert.match(onboarding, /normalizeGroupGameTemplate\(draft.group.template, draft.group.members\) \?\? initialTemplate/);
});

test("future roster/HCP/pairs can remain pending in template but never bypass round preflight", () => {
  const group = emptyGroup();
  let template = createEmptyGroupGameTemplate(group);
  template = patchGroupTemplateCore(template, "foursome", { enabled: true, mode: "match", segmentSize: 18, fixedValue: 500 });
  template.foursomeSegments = segmentDefinitions(playOrder(1), 18);
  const issues = groupTemplateConfigurationIssues(template, groupTemplatePlayers(group));
  assert.deepEqual(issues.blocking, []);
  assert.ok(issues.pending.some((issue) => issue.code === "foursome-match-participants"));
  assert.ok(issues.pending.some((issue) => issue.code === "active-bet-handicaps"));
  group.gameTemplate = normalizeGroupGameTemplate(template, group.players);
  const draft = instantiateGroupGameTemplate(group, (() => { let i = 0; return () => `player-${++i}`; })());
  const strict = collectBetConfigurationIssues(draft);
  assert.ok(strict.some((issue) => issue.code === "foursome-match-participants"));
  assert.ok(strict.some((issue) => issue.code === "active-bet-handicaps"));
  assert.equal(draft.players.length, 2, "No future players are invented");
  assert.deepEqual(draft.segments[0].basePair, [], "No future pair is invented");
});

test("invalid stake/percentage/multiplier is a template error, never deferred as future roster", () => {
  const group = emptyGroup();
  const template = patchGroupTemplateCore(createEmptyGroupGameTemplate(group), "foursome", { enabled: true, fixedValue: -1, hcpPct: 120, pressureMultiplier: 9 });
  const issues = groupTemplateConfigurationIssues(template, groupTemplatePlayers(group));
  assert.ok(issues.blocking.some((issue) => issue.code === "foursome-fixed-stake"));
  assert.ok(issues.blocking.some((issue) => issue.code === "foursome-hcp"));
  assert.ok(issues.blocking.some((issue) => issue.code === "foursome-pressure-multiplier"));
});

test("explicit Foursome percentage/rounding/base edits select configured engine method without mutating old config", () => {
  const group = emptyGroup();
  const template = createEmptyGroupGameTemplate(group);
  template.betConfig.foursome.handicapMethod = "excel";
  for (const patch of [{ hcpPct: 80 }, { decimals: "partial" }, { baseMode: "fixed" }]) {
    const next = patchGroupTemplateCore(template, "foursome", patch);
    assert.equal(next.betConfig.foursome.handicapMethod, "configured");
    assert.equal(template.betConfig.foursome.handicapMethod, "excel");
  }
  assert.equal(patchGroupTemplateCore(template, "foursome", { fixedValue: 500 }).betConfig.foursome.handicapMethod, "excel", "Editing price does not alter a historical handicap method");
});

for (const startHole of [1, 10] as const) {
  test(`all bet config survives template serialization → round → deterministic settlement, H${startHole}`, () => {
    const before = wizardEngineFixture(startHole, "relative");
    before.manualBets[0].amounts = Object.fromEntries(before.players.map((player) => [player.id, 0]));
    before.personalBets[0].externalScores = {};
    before.supplementalBets = before.supplementalBets.map((bet) => bet.type === "team_pressures" ? { ...bet, abandonedPlayerIds: [] } : bet);
    before.bets.polla.first9.playedHalfVersion = 1;
    // Explicitly configure every option newly exposed in the group controls.
    before.bets.foursome = { ...before.bets.foursome, handicapMethod: "configured", hcpPct: 80, baseMode: "moving", pressureMultiplier: 4 };
    before.bets.ballFriend.baseMode = "fixed";
    before.bets.rabbits.mode = "three_hole_blocks";
    before.bets.skins.mode = "no_carry";
    before.bets.loba.duplicateUnitsByMode = true;
    before.personalBets[0].components = { match1: true, medal1: false, match2: true, medal2: false, match18: true, medal18: false };
    const expected = evaluateWizardEngineFixture(before);
    const members = before.players.map((player) => ({ memberId: player.id, name: player.name, handicap: player.handicap }));
    const template = createGroupGameTemplate({ ...before, roundHandicapBasis: before.handicapBasis }, Object.fromEntries(members.map((member) => [member.memberId, member.memberId])));
    const group: FrequentGroup = { id: "engine-group", name: "Engine", players: members, gameTemplate: template, uses: 0, updatedAt: "2026-09-17" };
    const restored = parseFrequentGroups(serializeFrequentGroups([group]))[0];
    let sequence = 0;
    const draft = instantiateGroupGameTemplate(restored, () => members[sequence++]?.memberId ?? `bet-${sequence}`);
    assert.equal(draft.roundHoles, 18);
    assert.ok(draft.players.every((player) => typeof player.handicap === "number"));
    const after = evaluateWizardEngineFixture({ ...before, ...draft, handicapBasis: draft.roundHandicapBasis } as WizardEngineFixture);
    assert.deepEqual(after.balances, expected.balances);
    assert.deepEqual(after.transfers, expected.transfers);
    assert.deepEqual(after.foursome.balances, expected.foursome.balances);
    assert.deepEqual(after.personal.balances, expected.personal.balances);
    assert.deepEqual(after.animals.map((animal) => animal.balances), expected.animals.map((animal) => animal.balances));
    assert.deepEqual(after.supplemental.balances, expected.supplemental.balances);
    assert.equal(draft.bets.foursome.hcpPct, 80);
    assert.equal(draft.bets.loba.duplicateUnitsByMode, true);
    assert.equal(draft.bets.skins.mode, "no_carry");
    assert.equal(draft.bets.rabbits.mode, "three_hole_blocks");
    assert.equal(draft.personalBets[0].components.medal18, false);
    assert.equal(Object.values(after.balances).reduce((sum, value) => sum + value, 0), 0);
  });
}

for (const multiplier of [2, 3, 4, 5] as const) {
  test(`H10 animal and Foursome Match ${multiplier}x survive reload and affect actual payout`, () => {
    const fixture = wizardEngineFixture(10, "relative");
    const ids = fixture.players.map((player) => player.id);
    const players = fixture.players.map((player) => ({ ...player, handicap: 0 }));
    const group: FrequentGroup = { id: "pressure-group", name: "Pressure", uses: 0, updatedAt: "2026-09-17", players: players.map((player) => ({ memberId: player.id, name: player.name, handicap: 0 })) };
    let template: GroupGameTemplate = createEmptyGroupGameTemplate(group);
    template.roundDefaults.startHole = 10;
    template = patchGroupTemplateCore(template, "foursome", { enabled: true, mode: "match", segmentSize: 18, fixedValue: 500, hcpPct: 100, matchPresses: [{ id: "second", scope: "second", startHole: 1, multiplier }] });
    template.foursomeSegments = segmentDefinitions(playOrder(10), 18).map((segment) => ({ ...segment, basePair: ids.slice(0, 2) }));
    for (const key of ["vipers", "camels", "fish"] as const) template = patchGroupTemplateCore(template, key, { enabled: true, value: 100, secondNinePressed: true, secondNineMultiplier: multiplier, determinationMode: "most_events", mostEventsTieRule: "latest_tied_event" });
    group.gameTemplate = template;
    const restored = parseFrequentGroups(serializeFrequentGroups([group]))[0];
    let sequence = 0;
    const draft = instantiateGroupGameTemplate(restored, () => ids[sequence++] ?? `bet-${sequence}`);
    for (const key of ["vipers", "camels", "fish"] as const) {
      assert.equal(counterBetEffectiveUnitValue(draft.bets[key], 10, playOrder(10)), 100);
      assert.equal(counterBetEffectiveUnitValue(draft.bets[key], 1, playOrder(10)), 100 * multiplier);
      assert.equal(draft.bets[key].mostEventsTieRule, "latest_tied_event");
    }
    const scores = Object.fromEntries(playOrder(10).map((hole) => [hole, { said: 3, cuau: 3, armando: 4, jesus: 4 }]));
    const result = calculateFoursomes(fixture.course, scores, draft.players, draft.bets.foursome, draft.segments, playOrder(10));
    assert.equal(result.matches[0].matchPresses?.[0].money, 500 * multiplier);
    assert.equal(result.balances.said, 1500 + 500 * multiplier);
    draft.bets.foursome.fixedValue = 700;
    assert.equal(restored.gameTemplate?.betConfig.foursome.fixedValue, 500, "Round-only edit preserves group");
    const updated = updateGroupTemplateFromRound(restored, draft.origin, draft, "2026-09-18");
    assert.equal(updated.status, "updated");
    assert.equal(updated.group.gameTemplate?.betConfig.foursome.fixedValue, 700, "Only explicit update changes group");
    assert.equal(result.balances.said, 1500 + 500 * multiplier, "Historical payout remains frozen");
  });
}
