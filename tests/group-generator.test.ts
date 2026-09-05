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
import { parseFrequentGroups, playersFromFrequentGroup, serializeFrequentGroups } from "../lib/frequent-templates";

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

test("stress 3–20 jugadores conserva a todos para objetivos 3, 4 y 5", () => {
  for (let total = 3; total <= 20; total += 1) {
    for (const target of [3, 4, 5] as GroupTarget[]) {
      const source = players(total);
      const random = generateRandomGroups(source, target, total * 100 + target);
      const balanced = generateBalancedGroups(source, target, total * 100 + target);
      for (const result of [random, balanced]) {
        assert.equal(validateGroups(result, source), true, `${total} jugadores, objetivo ${target}`);
        assert.ok(result.every((group) => group.length >= 3 && group.length <= 5));
        assert.equal(new Set(result.flat().map((player) => player.id)).size, total);
      }
    }
  }
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

test("mover desde un grupo de tres funciona y conserva al jugador una sola vez", () => {
  const source = players(6);
  const original = [source.slice(0, 3), source.slice(3)];
  const player = original[0][0];
  const moved = moveGroupPlayer(original, player.id, 1);

  assert.deepEqual(moved.map((group) => group.length), [2, 4]);
  assert.equal(moved.flat().filter((item) => item.id === player.id).length, 1);
  assert.deepEqual(moved[1].find((item) => item.id === player.id), player);

  const returned = moveGroupPlayer(moved, player.id, 0);
  assert.deepEqual(returned.map((group) => group.length), [3, 3]);
  assert.equal(returned.flat().filter((item) => item.id === player.id).length, 1);
});

test("movimientos consecutivos usan el acomodo más reciente sin pérdidas", () => {
  const source = players(9);
  let groups = [source.slice(0, 3), source.slice(3, 6), source.slice(6)];
  groups = moveGroupPlayer(groups, source[0].id, 1);
  groups = moveGroupPlayer(groups, source[3].id, 2);
  groups = moveGroupPlayer(groups, source[7].id, 0);

  const ids = groups.flat().map((player) => player.id);
  assert.equal(ids.length, source.length);
  assert.equal(new Set(ids).size, source.length);
  assert.deepEqual([...ids].sort(), source.map((player) => player.id).sort());
});

test("mover repara una duplicación heredada del jugador seleccionado", () => {
  const source = players(6);
  const original = [source.slice(0, 3), [{ ...source[0] }, ...source.slice(3)]];
  const moved = moveGroupPlayer(original, source[0].id, 1);
  assert.equal(moved.flat().filter((item) => item.id === source[0].id).length, 1);
});

test("el acomodo movido se guarda y vuelve a cargar como grupo frecuente", () => {
  const source = players(6);
  const moved = moveGroupPlayer([source.slice(0, 3), source.slice(3)], source[0].id, 1);
  const expected = moved[1].map(({ name, handicap }) => ({ name, handicap }));
  const serialized = serializeFrequentGroups([{
    id: "frequent-moved",
    name: "Grupo reorganizado",
    players: expected,
    uses: 0,
    updatedAt: "2026-09-05T12:00:00.000Z",
  }]);
  const restored = parseFrequentGroups(serialized)[0];
  assert.deepEqual(restored.players, expected);
  assert.deepEqual(
    playersFromFrequentGroup(restored, (() => { let index = 0; return () => `restored-${++index}`; })()).map(({ name, handicap }) => ({ name, handicap })),
    expected,
  );
});

test("resumen para WhatsApp usa identidad The Backyard", () => {
  const text = groupsShareText([players(3)]);
  assert.match(text, /THE BACKYARD/);
  assert.match(text, /Grupo 1/);
  assert.match(text, /• Jugador 1/);
});
