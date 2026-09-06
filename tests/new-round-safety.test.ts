import assert from "node:assert/strict";
import test from "node:test";

import { CLOUD_CONFLICTS_KEY, preserveDraftConflict } from "../lib/account-workspace";
import { backupActiveRoundForReplacement } from "../lib/new-round-safety";
import { STORAGE_KEYS } from "../lib/round-utils";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

test("la ronda reemplazada queda verificada en recuperación local sin duplicarse", () => {
  const storage = new MemoryStorage();
  const draft = { roundId: "active-1", players: [{ id: "p1", name: "Jugador A", handicap: 8 }], scores: { 1: { p1: 4 } } };
  assert.equal(preserveDraftConflict(storage, draft), true);
  assert.equal(preserveDraftConflict(storage, draft), true);
  assert.deepEqual(JSON.parse(storage.getItem(CLOUD_CONFLICTS_KEY) || "[]"), [draft]);
});

test("no se confirma un respaldo vacío", () => {
  const storage = new MemoryStorage();
  assert.equal(preserveDraftConflict(storage, null), false);
  assert.equal(storage.getItem(CLOUD_CONFLICTS_KEY), null);
});

test("reemplazar una ronda aplica el respaldo cancelado sólo después del flush", () => {
  const storage = new MemoryStorage();
  const draft = { roundId: "active-group", players: [{ id: "p1", name: "Jugador A", handicap: 8 }], scores: { 1: { p1: 4 } } };
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
  let flushed = 0;
  assert.equal(backupActiveRoundForReplacement(storage, () => { flushed += 1; return true; }), true);
  assert.equal(flushed, 1);
  assert.deepEqual(JSON.parse(storage.getItem(CLOUD_CONFLICTS_KEY) || "[]"), [{ ...draft, lifecycleState: "cancelled", cancelledAt: JSON.parse(storage.getItem(CLOUD_CONFLICTS_KEY) || "[]")[0].cancelledAt }]);
});

test("un flush fallido bloquea el reemplazo y no crea respaldo falso", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ roundId: "active", players: [{ id: "p1", name: "A" }], scores: {} }));
  assert.equal(backupActiveRoundForReplacement(storage, () => false), false);
  assert.equal(storage.getItem(CLOUD_CONFLICTS_KEY), null);
});
