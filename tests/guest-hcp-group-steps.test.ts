import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canEditGuestHandicap, patchEditablePlayer, playerHandicapSourceLabel } from "../lib/player-handicap-edit";
import { activeGroupTemplateDefinitions } from "../lib/group-template-editor";
import { createEmptyGroupGameTemplate, instantiateGroupGameTemplate } from "../lib/group-game-template";
import { groupTemplateSelectionDefinitions, groupTemplateSelectableSupplementalTypes } from "../lib/bets/registry";
import { createSupplementalBet } from "../lib/supplemental-bets";
import { parseFrequentGroups, serializeFrequentGroups } from "../lib/frequent-templates";
import { baseHandicaps } from "../lib/engine";
import type { FrequentGroup, Player } from "../lib/types";

const group: FrequentGroup = { id: "guest-qa", name: "QA", players: [{ memberId: "guest-a", name: "Guest A", handicap: 18 }, { memberId: "guest-b", name: "Guest B", handicap: 5 }], uses: 0, updatedAt: "2026-09-17" };
test("guest decimal HCP patch recalculates relative advantages without mutating template or historical snapshot", () => {
  const template = { ...group, gameTemplate: createEmptyGroupGameTemplate(group) };
  template.gameTemplate.betConfig.skins.enabled = true;
  const frozen = JSON.stringify(template);
  let i = 0;
  const round = instantiateGroupGameTemplate(template, () => `round-${++i}`);
  const oldPlayers = structuredClone(round.players);
  const next = round.players.map((player, index) => index === 0 ? patchEditablePlayer(player, { handicap: 16.5, handicapSource: "manual" }) : player);
  assert.equal(canEditGuestHandicap(next[0]), true);
  assert.equal(next[0].handicap, 16.5);
  assert.notDeepEqual(baseHandicaps(next), baseHandicaps(oldPlayers));
  assert.equal(JSON.stringify(template), frozen);
  assert.equal(oldPlayers[0].handicap, 18);
  const savedGroup = { ...template, players: template.players.map((member, index) => index === 0 ? { ...member, handicap: 16.5 } : member) };
  assert.equal(parseFrequentGroups(serializeFrequentGroups([savedGroup]))[0].players[0].handicap, 16.5);
});

for (const source of [undefined, "BACKYARD_INDEX", "GHIN_OFFICIAL_FUTURE"] as const) {
  test(`account HCP locked by canonical identity even when source=${source}`, () => {
    const player: Player = { id: "account:a", name: "QA Account", accountUserId: "a", handicap: 8, handicapIndexSource: source };
    assert.equal(canEditGuestHandicap(player), false);
    assert.deepEqual(patchEditablePlayer(player, { handicap: 16.5, handicapSource: "manual", handicapIndex: 16.5 }), player);
    assert.match(playerHandicapSourceLabel(player), source === "GHIN_OFFICIAL_FUTURE" ? /GHIN/ : /Backyard/);
  });
}
test("account missing Index stays locked and actionable, never manual or zero", () => {
  const player: Player = { id: "account:a", name: "QA", accountUserId: "a", handicap: null };
  assert.equal(playerHandicapSourceLabel(player), "Sin HCP Backyard");
  assert.equal(patchEditablePlayer(player, { handicap: 0 }).handicap, null);
});

test("Step 10 only selection, Step 11 uses the same editor and only active registry entries", () => {
  const source = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const step10 = source.split('if (progress.step === "bets")')[1].split('if (progress.step === "bet_details")')[0];
  assert.match(step10, /mode="selection"/);
  assert.doesNotMatch(step10, /mode="complete"|mode="details"/);
  assert.match(step10, /Continuar: configurar apuestas/);
  const editor = readFileSync("app/components/group-bet-template-editor.tsx", "utf8");
  assert.match(editor, /groupTemplateSelectionDefinitions\(\).map/);
  assert.match(editor, /activeGroupTemplateDefinitions\(value\).map/);
  assert.match(editor, /Editar personales/);
  assert.match(editor, /onlyBetId=\{item.id\}/);
});
test("all selected supplemental types, Personales and Manual survive persistence/back/forward without duplicates", () => {
  const template = createEmptyGroupGameTemplate(group);
  const players = group.players.map(member => ({ id: member.memberId!, name: member.name, handicap: member.handicap }));
  assert.deepEqual(activeGroupTemplateDefinitions(template), []);
  template.betConfig.skins.enabled = true;
  template.betConfig.skins.value = 125;
  template.supplementalBets = [...groupTemplateSelectableSupplementalTypes(), "individual_nassau" as const].map((type, index) => createSupplementalBet(type, players, `sup-${index}`, 18));
  template.manualBets = [{ id: "manual", name: "Manual QA", enabled: true, amounts: {} }];
  const ids = activeGroupTemplateDefinitions(template).map(item => item.id);
  for (const id of ["skins", "personals", "manuals", ...groupTemplateSelectableSupplementalTypes()]) assert.ok(ids.includes(id));
  assert.ok(!ids.includes("rabbits"));
  assert.equal(new Set(ids).size, ids.length);
  const restored = parseFrequentGroups(serializeFrequentGroups([{ ...group, gameTemplate: template }]))[0].gameTemplate!;
  assert.deepEqual(activeGroupTemplateDefinitions(restored).map(item => item.id), ids);
  assert.equal(restored.betConfig.skins.value, 125);
  restored.supplementalBets = restored.supplementalBets.map(bet => ({ ...bet, enabled: false }));
  assert.deepEqual(activeGroupTemplateDefinitions(restored).map(item => item.id), ["skins", "manuals"]);
  assert.ok(groupTemplateSelectionDefinitions().length > 15);
});

test("save/exit separated from primary navigation and email readiness does not gate internal identity invite", () => {
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  assert.doesNotMatch(onboarding, /Guardar y continuar después/);
  assert.match(onboarding, /¿Guardar esta configuración y continuar después\?/);
  assert.match(onboarding, /localStorage.setItem\(betaOnboardingDraftStorageKey/);
  const invite = readFileSync("app/components/group-invitations.tsx", "utf8");
  assert.match(invite, /data.emailDeliveryConfigured === true/);
  assert.match(invite, /!target.targetUserId && !emailAvailable/);
  assert.match(invite, /disabled=\{!emailAvailable \|\| busy/);
  assert.match(invite, /Invitaciones por correo temporalmente no disponibles/);
  assert.match(invite, /result.channel === "BACKYARD"/);
});
