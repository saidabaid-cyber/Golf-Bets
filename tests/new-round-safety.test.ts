import assert from "node:assert/strict";
import test from "node:test";

import { CLOUD_CONFLICTS_KEY, preserveDraftConflict } from "../lib/account-workspace";

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
