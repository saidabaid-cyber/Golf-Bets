import assert from "node:assert/strict";
import test from "node:test";

import {
  addFrequentGroupMember,
  addFrequentPlayerTemplate,
  applySavedPersonalRivalTemplate,
  moveFrequentGroupMember,
  parseFrequentGroups,
  personalRivalTemplateFromBet,
  playersFromFrequentGroup,
  removeFrequentGroupMember,
  removeFrequentPlayerTemplate,
  removeSavedPersonalRivalTemplate,
  resolveFrequentGroupDeletion,
  serializeFrequentGroups,
  updateFrequentGroupMember,
  updateFrequentGroupTemplate,
  updateFrequentPlayerTemplate,
  updateSavedPersonalRivalTemplate,
} from "../lib/frequent-templates";
import type { FrequentGroup, FrequentPlayer, PersonalBet, RoundSnapshot, SavedPersonalRival } from "../lib/types";

const activeBet: PersonalBet = {
  id: "bet-1",
  rivalMode: "external",
  externalRivalId: "rival-1",
  rivalName: "Carlos Pérez",
  externalScores: {},
  baseValue: 100,
  advantageReceiver: "rival",
  advantageStrokes: 2,
  back9Multiplier: 1,
  pressureMultiplier: 2,
  pressureNine: "holes_10_18",
  components: { match1: true, medal1: true, match2: true, medal2: true, match18: true, medal18: true },
};

const historicalRound = {
  id: "round-1",
  date: "2026-08-31",
  courseName: "La Vista",
  teeName: "General",
  ownerName: "Said",
  betResult: 100,
  expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
  expenseTotal: 0,
  netResult: 100,
  categoryResults: {},
  personalResults: [{ rivalKey: "personal:rival-1", rivalName: "Carlos Pérez", totalMoney: 100, componentMoney: {} }],
} satisfies RoundSnapshot;

test("editing and deleting a frequent player changes only the future template list", () => {
  const templates: FrequentPlayer[] = [{ id: "fp-1", name: "Carlos", handicap: 12, uses: 3, updatedAt: "old" }];
  const activePlayers = [{ id: "player-1", name: "Carlos", handicap: 12 }];
  const history = [structuredClone(historicalRound)];
  const edited = updateFrequentPlayerTemplate(templates, "fp-1", { name: "Carlos P.", handicap: 10 }, "new");
  assert.deepEqual(edited[0], { id: "fp-1", name: "Carlos P.", handicap: 10, uses: 3, updatedAt: "new" });
  assert.deepEqual(activePlayers, [{ id: "player-1", name: "Carlos", handicap: 12 }]);
  assert.equal(history[0].personalResults?.[0].rivalName, "Carlos Pérez");
  assert.deepEqual(removeFrequentPlayerTemplate(edited, "fp-1"), []);
  assert.equal(templates[0].name, "Carlos");
});

test("saved rival edits and deletion do not mutate an active bet or historical name", () => {
  const templates: SavedPersonalRival[] = [{ id: "rival-1", name: "Carlos Pérez", handicap: 14, baseValue: 100 }];
  const activeBefore = structuredClone(activeBet);
  const history = [structuredClone(historicalRound)];
  const edited = updateSavedPersonalRivalTemplate(templates, "rival-1", { name: "Carlos P.", handicap: 11, baseValue: 200 }, "new");
  assert.equal(edited[0].name, "Carlos P.");
  assert.deepEqual(activeBet, activeBefore);
  assert.equal(history[0].personalResults?.[0].rivalName, "Carlos Pérez");
  assert.deepEqual(removeSavedPersonalRivalTemplate(edited, "rival-1"), []);
  assert.equal(templates[0].name, "Carlos Pérez");
});

test("a rival template is copied into a new bet and changes only after an explicit save", () => {
  const template: SavedPersonalRival = { id: "rival-1", name: "Carlos Pérez", handicap: 14, baseValue: 250, advantageReceiver: "owner", advantageStrokes: 3, pressureMultiplier: 3, pressureNine: "holes_1_9" };
  const copied = applySavedPersonalRivalTemplate(activeBet, template);
  assert.equal(copied.rivalName, "Carlos Pérez");
  assert.equal(copied.baseValue, 250);
  assert.equal(copied.pressureMultiplier, 3);
  const renamedForRound = { ...copied, rivalName: "Carlos" };
  assert.equal(template.name, "Carlos Pérez");
  const explicitlySaved = personalRivalTemplateFromBet(renamedForRound, template.id, "new", template.handicap);
  assert.equal(explicitlySaved.name, "Carlos");
  assert.equal(explicitlySaved.handicap, 14);
});

const frequentGroup: FrequentGroup = {
  id: "group-1",
  name: "Miércoles",
  players: [{ name: "Said", handicap: 7 }, { name: "Cuau", handicap: 12 }],
  uses: 4,
  updatedAt: "old",
};

test("loading a frequent group creates independent players for the current round", () => {
  let nextId = 0;
  const loaded = playersFromFrequentGroup(frequentGroup, () => `round-player-${++nextId}`);
  assert.deepEqual(loaded, [
    { id: "round-player-1", name: "Said", handicap: 7 },
    { id: "round-player-2", name: "Cuau", handicap: 12 },
  ]);
  loaded[0].name = "Said ronda";
  assert.equal(frequentGroup.players[0].name, "Said");
});

test("a frequent group can rename, edit, add, remove and reorder members", () => {
  const renamed = updateFrequentGroupTemplate([frequentGroup], frequentGroup.id, { name: "Viernes", players: frequentGroup.players }, "new")[0];
  const edited = updateFrequentGroupMember(renamed, 1, { handicap: 10 });
  const added = addFrequentGroupMember(edited, { name: "Jorge", handicap: 14 });
  const reordered = moveFrequentGroupMember(added, 2, -1);
  const removed = removeFrequentGroupMember(reordered, 0);
  assert.equal(removed.name, "Viernes");
  assert.deepEqual(removed.players, [{ name: "Jorge", handicap: 14 }, { name: "Cuau", handicap: 10 }]);
  assert.equal(removed.uses, 4);
  assert.equal(removed.updatedAt, "new");
});

test("removing a group member never removes the general frequent-player template", () => {
  const frequentPlayers: FrequentPlayer[] = [
    { id: "fp-said", name: "Said", handicap: 7, uses: 2, updatedAt: "old" },
    { id: "fp-cuau", name: "Cuau", handicap: 12, uses: 2, updatedAt: "old" },
  ];
  const withoutCuau = removeFrequentGroupMember(frequentGroup, 1);
  assert.deepEqual(withoutCuau.players, [{ name: "Said", handicap: 7 }]);
  assert.equal(frequentPlayers.length, 2);
  assert.equal(frequentPlayers[1].name, "Cuau");
});

test("group edits and deletion do not mutate an active round or historical data", () => {
  const activePlayers = [{ id: "round-said", name: "Said", handicap: 7 }, { id: "round-cuau", name: "Cuau", handicap: 12 }];
  const activeBefore = structuredClone(activePlayers);
  const history = [structuredClone(historicalRound)];
  const historyBefore = structuredClone(history);
  const edited = updateFrequentGroupTemplate([frequentGroup], frequentGroup.id, { name: "Sin Cuau", players: [frequentGroup.players[0]] }, "new");
  const deleted = resolveFrequentGroupDeletion(edited, frequentGroup.id, "delete");
  assert.deepEqual(deleted, []);
  assert.deepEqual(activePlayers, activeBefore);
  assert.deepEqual(history, historyBefore);
});

test("cancelled deletion preserves a group and persisted deletion does not reappear", () => {
  const cancelled = resolveFrequentGroupDeletion([frequentGroup], frequentGroup.id, "cancel");
  assert.deepEqual(cancelled, [frequentGroup]);
  assert.deepEqual(parseFrequentGroups(serializeFrequentGroups(cancelled)), [frequentGroup]);
  const deleted = resolveFrequentGroupDeletion(cancelled, frequentGroup.id, "delete");
  assert.deepEqual(parseFrequentGroups(serializeFrequentGroups(deleted)), []);
});

test("a new group member becomes a frequent player only after the explicit choice", () => {
  const existing: FrequentPlayer[] = [{ id: "fp-said", name: "Said", handicap: 7, uses: 2, updatedAt: "old" }];
  const withoutExplicitSave = [...existing];
  assert.deepEqual(withoutExplicitSave, existing);
  const explicitlySaved = addFrequentPlayerTemplate(existing, { name: "Jorge", handicap: 14 }, "fp-jorge", "new");
  assert.deepEqual(explicitlySaved[0], { id: "fp-jorge", name: "Jorge", handicap: 14, uses: 0, updatedAt: "new" });
  assert.equal(existing.length, 1);
});
