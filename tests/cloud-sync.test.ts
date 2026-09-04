import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_TOMBSTONES_KEY,
  cloudDataFingerprint,
  collectLocalCloudData,
  mergeLocalAndCloud,
  findAmbiguousCloudConflicts,
  resolveAmbiguousCloudConflicts,
  recordCloudDeletion,
  type CloudDataBundle,
} from "../lib/cloud-sync";
import { STORAGE_KEYS } from "../lib/round-utils";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function bundle(overrides: Partial<CloudDataBundle> = {}): CloudDataBundle {
  return {
    version: 1,
    history: [],
    frequentPlayers: [],
    frequentGroups: [],
    rivals: [],
    courses: [],
    preferences: { highContrast: false, language: "es-MX", notificationsEnabled: false, defaultHandicap: null },
    activeDraft: null,
    tombstones: [],
    ...overrides,
  };
}

test("fixture local conserva todas las colecciones y no modifica storage", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ id: "round-1", date: "2026-09-01" }]));
  storage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify([{ id: "player-1", name: "Said", handicap: 7, uses: 3, updatedAt: "2026-09-01T12:00:00Z" }]));
  storage.setItem(STORAGE_KEYS.frequentGroups, JSON.stringify([{ id: "group-1", name: "Miércoles", players: [{ name: "Said", handicap: 7 }], uses: 1, updatedAt: "2026-09-01T12:00:00Z" }]));
  storage.setItem(STORAGE_KEYS.rivals, JSON.stringify([{ id: "rival-1", name: "Cuau" }]));
  storage.setItem(STORAGE_KEYS.courses, JSON.stringify([{ id: "course-1", name: "Custom", holes: [], builtIn: false }]));
  const before = new Map(storage.values);
  const result = collectLocalCloudData(storage as unknown as Storage, 7);
  assert.deepEqual([result.history.length, result.frequentPlayers.length, result.frequentGroups.length, result.rivals.length, result.courses.length], [1, 1, 1, 1, 1]);
  assert.deepEqual(storage.values, before);
});

test("un dispositivo sin preferencia inicia alto contraste activado", () => {
  const storage = new MemoryStorage();
  const defaults = collectLocalCloudData(storage as unknown as Storage);
  assert.equal(defaults.preferences.highContrast, true);
  assert.equal(defaults.preferences.hasLocalState, false);
  storage.setItem(STORAGE_KEYS.contrast, "false");
  const explicit = collectLocalCloudData(storage as unknown as Storage);
  assert.equal(explicit.preferences.highContrast, false);
  assert.equal(explicit.preferences.hasLocalState, true);
});

test("merge local/cloud es idempotente, evita duplicados y conserva la versión más reciente", () => {
  const oldPlayer = { id: "p1", name: "Viejo", handicap: 9, uses: 1, updatedAt: "2026-09-01T10:00:00Z" };
  const newPlayer = { ...oldPlayer, name: "Nuevo", updatedAt: "2026-09-02T10:00:00Z" };
  const merged = mergeLocalAndCloud(bundle({ frequentPlayers: [newPlayer] }), bundle({ frequentPlayers: [oldPlayer] }));
  assert.equal(merged.frequentPlayers.length, 1);
  assert.equal(merged.frequentPlayers[0].name, "Nuevo");
  assert.deepEqual(mergeLocalAndCloud(merged, merged), merged);
  assert.equal(cloudDataFingerprint(merged), cloudDataFingerprint(structuredClone(merged)));
});

test("un dispositivo nuevo recibe preferencias cloud y uno ya configurado conserva su elección local", () => {
  const cloud = bundle({ preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: 8, hasLocalState: true } });
  const newDevice = bundle({ preferences: { highContrast: false, language: "es-MX", notificationsEnabled: false, defaultHandicap: null, hasLocalState: false } });
  assert.equal(mergeLocalAndCloud(newDevice, cloud).preferences.highContrast, true);
  const configured = bundle({ preferences: { ...newDevice.preferences, highContrast: false, hasLocalState: true } });
  assert.equal(mergeLocalAndCloud(configured, cloud).preferences.highContrast, false);
});

test("borrados cloud persisten y un dispositivo desactualizado no revive registros", () => {
  const storage = new MemoryStorage();
  recordCloudDeletion(storage as unknown as Storage, "round", "round-1", "2026-09-02T12:00:00Z");
  const tombstones = JSON.parse(storage.getItem(CLOUD_TOMBSTONES_KEY) || "[]");
  const staleRound = { id: "round-1", date: "2026-09-01" } as CloudDataBundle["history"][number];
  const merged = mergeLocalAndCloud(bundle({ history: [staleRound] }), bundle({ history: [staleRound], tombstones }));
  assert.equal(merged.history.length, 0);
  assert.equal(merged.tombstones.length, 1);
});

test("migración repetida conserva una sola ronda y el original local", () => {
  const round = { id: "round-1", date: "2026-09-01", completedAt: "2026-09-01T18:00:00Z" } as CloudDataBundle["history"][number];
  const local = bundle({ history: [round] });
  const first = mergeLocalAndCloud(local, bundle());
  const second = mergeLocalAndCloud(local, first);
  assert.equal(second.history.length, 1);
  assert.equal(local.history.length, 1);
  assert.equal(second.history[0].id, "round-1");
});

test("autosave vacío de un dispositivo nuevo no oculta el draft cloud con scores", () => {
  const draft = { players: [{ id: "a", name: "Said" }], scores: { 1: { a: 4 } }, currentIndex: 1 };
  const empty = { players: [], scores: {}, currentIndex: 0 };
  const synchronized = { players: draft.players, scores: draft.scores };
  assert.deepEqual(mergeLocalAndCloud(bundle({ activeDraft: empty }), bundle({ activeDraft: draft })).activeDraft, synchronized);
  assert.deepEqual(mergeLocalAndCloud(bundle({ activeDraft: draft }), bundle({ activeDraft: empty })).activeDraft, synchronized);
});

test("currentIndex es navegación local: no se sube ni produce conflictos", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ roundId: "round-1", players: [{ id: "p", name: "Said" }], scores: { 5: { p: 4 } }, currentIndex: 4 }));
  const local = collectLocalCloudData(storage as unknown as Storage);
  assert.equal("currentIndex" in (local.activeDraft as Record<string, unknown>), false);
  const remote = bundle({ activeDraft: { roundId: "round-1", players: [{ id: "p", name: "Said" }], scores: { 5: { p: 4 } }, currentIndex: 12 } });
  assert.equal(findAmbiguousCloudConflicts(local, remote).some(item => item.collection === "activeDraft"), false);
});

test("ediciones compatibles de hoyos y jugadores distintos se combinan por campo", () => {
  const base = { roundId: "round-1", players: [{ id: "a", name: "Said" }, { id: "b", name: "Juan" }], scores: { 5: { a: 4, b: 5 }, 6: { a: 4, b: 4 } } };
  const baseFingerprint = JSON.stringify(base);
  const local = bundle({ activeDraft: { ...base, scores: { 5: { a: 3, b: 5 }, 6: { a: 4, b: 4 } } }, activeDraftUpdatedAt: "2026-09-03T12:02:00Z", baseDraft: base, baseDraftFingerprint: baseFingerprint, deviceId: "computer" });
  const remote = bundle({ activeDraft: { ...base, scores: { 5: { a: 4, b: 5 }, 6: { a: 4, b: 3 } } }, activeDraftUpdatedAt: "2026-09-03T12:03:00Z", deviceId: "phone" });
  assert.equal(findAmbiguousCloudConflicts(local, remote).length, 0);
  assert.deepEqual((mergeLocalAndCloud(local, remote).activeDraft as typeof base).scores, { 5: { a: 3, b: 5 }, 6: { a: 4, b: 3 } });
});

test("dos jugadores distintos del mismo hoyo se combinan sin conflicto", () => {
  const base = { roundId: "round-1", players: [{ id: "a", name: "Said" }, { id: "b", name: "Juan" }], scores: { 5: { a: 4, b: 5 } } };
  const local = bundle({ activeDraft: { ...base, scores: { 5: { a: 3, b: 5 } } }, activeDraftUpdatedAt: "2026-09-03T12:02:00Z", baseDraft: base, baseDraftFingerprint: JSON.stringify(base), deviceId: "computer" });
  const remote = bundle({ activeDraft: { ...base, scores: { 5: { a: 4, b: 4 } } }, activeDraftUpdatedAt: "2026-09-03T12:03:00Z", deviceId: "phone" });
  assert.equal(findAmbiguousCloudConflicts(local, remote).length, 0);
  assert.deepEqual((mergeLocalAndCloud(local, remote).activeDraft as typeof base).scores, { 5: { a: 3, b: 4 } });
});

test("solo el mismo score divergente genera conflicto granular", () => {
  const base = { roundId: "round-1", players: [{ id: "a", name: "Said" }], scores: { 5: { a: 4 }, 6: { a: 4 } } };
  const local = bundle({ activeDraft: { ...base, scores: { 5: { a: 3 }, 6: { a: 4 } } }, activeDraftUpdatedAt: "2026-09-03T12:02:00Z", baseDraft: base, baseDraftFingerprint: JSON.stringify(base), deviceId: "computer" });
  const remote = bundle({ activeDraft: { ...base, scores: { 5: { a: 5 }, 6: { a: 3 } } }, activeDraftUpdatedAt: "2026-09-03T12:03:00Z", deviceId: "phone" });
  const conflicts = findAmbiguousCloudConflicts(local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].fieldPath, "/scores/5/a");
  assert.equal(conflicts[0].playerId, "a");
  assert.equal(conflicts[0].hole, 5);
  assert.equal((mergeLocalAndCloud(local, remote).activeDraft as typeof base).scores[6].a, 3);
  const resolved = resolveAmbiguousCloudConflicts(local, remote, conflicts, "local", "2026-09-03T12:04:00Z");
  assert.equal((resolved.activeDraft as typeof base).scores[5].a, 3);
  assert.equal((resolved.activeDraft as typeof base).scores[6].a, 3);
  assert.equal(findAmbiguousCloudConflicts(resolved, remote).length, 0, "el mismo conflicto no debe reaparecer");
});
