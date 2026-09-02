import assert from "node:assert/strict";
import test from "node:test";
import {
  appendUniquePlayer,
  generateBalancedGroups,
  generateRandomGroups,
  groupSizes,
  groupsShareText,
  hasDuplicatePlayerNames,
  moveGroupPlayer,
  swapGroupPlayers,
  validateGroups,
  type GroupPlayer,
  type GroupTarget,
} from "../lib/group-generator";

const players = (count: number): GroupPlayer[] => Array.from({ length: count }, (_, index) => ({
  id: `p${index + 1}`,
  name: `Jugador ${index + 1}`,
  handicap: index + 1,
}));

for (const [total, target, expected] of [
  [6, 5, [3, 3]],
  [7, 4, [4, 3]],
  [8, 4, [4, 4]],
  [9, 4, [5, 4]],
  [10, 5, [5, 5]],
  [10, 4, [4, 3, 3]],
  [11, 4, [4, 4, 3]],
  [12, 4, [4, 4, 4]],
  [15, 5, [5, 5, 5]],
] as Array<[number, GroupTarget, number[]]>) {
  test(`${total} jugadores objetivo ${target} -> ${expected.join("+")}`, () => {
    assert.deepEqual(groupSizes(total, target), expected);
    const source = players(total);
    assert.equal(validateGroups(generateRandomGroups(source, target, 20260901), source), true);
  });
}

test("balanceado por HCP es determinista, válido y razonablemente parejo", () => {
  const source = players(10).map((player, index) => ({ ...player, handicap: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27][index] }));
  const first = generateBalancedGroups(source, 5, 42);
  const second = generateBalancedGroups(source, 5, 42);
  assert.deepEqual(first, second);
  assert.equal(validateGroups(first, source), true);
  const sums = first.map((group) => group.reduce((sum, player) => sum + player.handicap!, 0));
  assert.ok(Math.max(...sums) - Math.min(...sums) <= 6);
  assert.deepEqual(source.map((player) => player.handicap), [0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
});

test("nombres duplicados se ignoran y edición móvil no pierde jugadores", () => {
  const source = appendUniquePlayer([], { id: "a", name: "Sáíd", handicap: 7 });
  assert.equal(appendUniquePlayer(source, { id: "b", name: " said ", handicap: 9 }).length, 1);
  assert.equal(hasDuplicatePlayerNames([...source, { id: "b", name: " SAID ", handicap: 9 }]), true);
  assert.equal(hasDuplicatePlayerNames(source), false);
  const original = generateRandomGroups(players(8), 4, 8);
  const moved = moveGroupPlayer(original, original[0][0].id, 1);
  assert.equal(validateGroups(moved, players(8)), true);
  const swapped = swapGroupPlayers(moved, moved[0][0].id, moved[1][0].id);
  assert.equal(validateGroups(swapped, players(8)), true);
});

test("resumen para WhatsApp usa identidad The Backyard", () => {
  const text = groupsShareText([players(3)]);
  assert.match(text, /THE BACKYARD/);
  assert.match(text, /Grupo 1/);
  assert.match(text, /• Jugador 1/);
});
