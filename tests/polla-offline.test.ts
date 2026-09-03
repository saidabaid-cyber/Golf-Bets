import assert from "node:assert/strict";
import test from "node:test";

import { acknowledgePollaScore, discardPollaScoreConflicts, enqueuePollaScore, flushPollaScoreQueue, readPendingPollaScores, type PendingPollaScore } from "../lib/polla-offline";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const score = (overrides: Partial<PendingPollaScore> = {}): PendingPollaScore => ({
  id: "change-1", tournamentId: "t1", groupId: "g1", playerId: "p1", hole: 1, score: 4, queuedAt: "2026-09-02T12:00:00Z", ...overrides,
});

test("offline guarda, reabre y reemplaza el mismo jugador/hoyo sin duplicarlo", () => {
  const storage = new MemoryStorage();
  enqueuePollaScore(score(), storage as unknown as Storage);
  enqueuePollaScore(score({ id: "change-2", score: 5 }), storage as unknown as Storage);
  const reopened = readPendingPollaScores(storage as unknown as Storage);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].score, 5);
});

test("reconexión sincroniza y vacía la cola", async () => {
  const storage = new MemoryStorage();
  enqueuePollaScore(score(), storage as unknown as Storage);
  const calls: string[] = [];
  const result = await flushPollaScoreQueue("token", {
    storage: storage as unknown as Storage,
    fetcher: async (_input, init) => { calls.push(String(init?.body)); return new Response(JSON.stringify({ score: { updated_at: "v2" } }), { status: 200 }); },
  });
  assert.equal(result.synced, 1);
  assert.equal(calls.length, 1);
  assert.equal(readPendingPollaScores(storage as unknown as Storage).length, 0);
});

test("conflicto no se sobrescribe ni se pierde", async () => {
  const storage = new MemoryStorage();
  enqueuePollaScore(score({ baseUpdatedAt: "v1" }), storage as unknown as Storage);
  const result = await flushPollaScoreQueue("token", { storage: storage as unknown as Storage, fetcher: async () => new Response("{}", { status: 409 }) });
  assert.equal(result.synced, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(readPendingPollaScores(storage as unknown as Storage).length, 1);
  assert.equal(readPendingPollaScores(storage as unknown as Storage)[0].status, "conflict");
});

test("cada sesión sincroniza solo su torneo/grupo y conserva las otras colas", async () => {
  const storage = new MemoryStorage();
  enqueuePollaScore(score({ id: "g1" }), storage as unknown as Storage);
  enqueuePollaScore(score({ id: "g2", tournamentId: "t2", groupId: "g2" }), storage as unknown as Storage);
  const result = await flushPollaScoreQueue("token-t1", {
    storage: storage as unknown as Storage,
    tournamentId: "t1",
    groupId: "g1",
    fetcher: async () => new Response("{}", { status: 200 }),
  });
  assert.equal(result.synced, 1);
  assert.deepEqual(readPendingPollaScores(storage as unknown as Storage).map((item) => item.id), ["g2"]);
});

test("ack elimina solo el envío confirmado y descartar conflictos respeta grupo", () => {
  const storage = new MemoryStorage();
  enqueuePollaScore(score({ id: "ok" }), storage as unknown as Storage);
  enqueuePollaScore(score({ id: "conflict-1", playerId: "p2", status: "conflict" }), storage as unknown as Storage);
  enqueuePollaScore(score({ id: "conflict-2", tournamentId: "t2", groupId: "g2", status: "conflict" }), storage as unknown as Storage);
  acknowledgePollaScore("ok", storage as unknown as Storage);
  assert.equal(discardPollaScoreConflicts("t1", "g1", storage as unknown as Storage), 1);
  assert.deepEqual(readPendingPollaScores(storage as unknown as Storage).map((item) => item.id), ["conflict-2"]);
});
