import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CLOUD_TOMBSTONES_KEY, collectLocalCloudData, mergeLocalAndCloud, type CloudDataBundle } from "../lib/cloud-sync";
import { acknowledgeOfflineBundle, markOfflineAttempt, persistOfflineBundle, readOfflineBundle, readOfflineOutbox, writeCloudBundleToStorage } from "../lib/offline-store";
import { saveRoundHistoryLocalFirst } from "../lib/round-history-save";
import { readStoredJson, STORAGE_KEYS } from "../lib/round-utils";
import type { Course, Player, RoundSnapshot } from "../lib/types";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const players: Player[] = ["said", "abel", "bringas", "pepe"].map((id, index) => ({ id, name: id, handicap: index * 3 }));
const course: Course = {
  id: "qa-course",
  name: "QA Histórico",
  teeName: "General",
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
};

function snapshot(id = "round-qa"): RoundSnapshot {
  const order = Array.from({ length: 18 }, (_, index) => index + 1);
  return {
    id,
    date: "2026-09-04",
    ownerId: "said",
    ownerName: "said",
    courseName: course.name,
    teeName: course.teeName,
    roundHoles: 18,
    startHole: 1,
    betResult: 0,
    expenseTotal: 0,
    netResult: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    categoryResults: {},
    players,
    scores: Object.fromEntries(order.map((hole) => [hole, Object.fromEntries(players.map((player) => [player.id, 4]))])),
    courseSnapshot: course,
    order,
    photoId: "photo-qa",
    completedAt: "2026-09-04T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z",
  };
}

test("Guardar → persistencia local/IndexedDB → Histórico → reload conserva 72 scores y otras rondas", async () => {
  const storage = new MemoryStorage();
  const previous = snapshot("round-anterior");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([previous]));
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ roundId: "round-qa", players, scores: { 1: { said: 4 } } }));
  storage.setItem(CLOUD_TOMBSTONES_KEY, JSON.stringify([
    { entityType: "round", localId: "round-qa", deletedAt: "2026-09-03T10:00:00.000Z" },
    { entityType: "round", localId: "otra", deletedAt: "2026-09-03T10:00:00.000Z" },
  ]));
  const offlineBundles: CloudDataBundle[] = [];
  let queued = false;

  const saved = await saveRoundHistoryLocalFirst({
    storage: storage as unknown as Storage,
    ownerId: "account-1",
    snapshot: snapshot(),
    deviceId: "device-a",
    defaultHandicap: 8.4,
    hasLocalPreferenceState: true,
    queueForCloud: true,
    persistOffline: async (_ownerId, bundle, queueForCloud) => {
      offlineBundles.push(structuredClone(bundle));
      queued = queueForCloud;
      return "fingerprint-qa";
    },
  });

  const reloaded = readStoredJson<RoundSnapshot[]>(storage as unknown as Storage, STORAGE_KEYS.history, []);
  assert.deepEqual(reloaded.map((round) => round.id), ["round-qa", "round-anterior"]);
  assert.equal(Object.values(reloaded[0].scores || {}).flatMap((row) => Object.values(row)).length, 72);
  assert.equal(saved.history[0].photoId, "photo-qa");
  assert.equal(offlineBundles[0].activeDraft, null);
  assert.equal(offlineBundles[0].history.length, 2);
  assert.equal(queued, true);
  assert.deepEqual(readStoredJson<any[]>(storage as unknown as Storage, CLOUD_TOMBSTONES_KEY, []).map((item) => item.localId), ["otra"]);
  assert.ok(storage.getItem(STORAGE_KEYS.draft), "el flujo de página limpia el draft solo después de esta confirmación");
});

test("reintentar guardado o corregir usa el mismo ID, conserva foto y crea una sola operación idempotente", async () => {
  const storage = new MemoryStorage();
  const original = snapshot();
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([original]));
  const fingerprints: string[] = [];
  const persistOffline = async (_ownerId: string, bundle: CloudDataBundle) => {
    const fingerprint = JSON.stringify(bundle.history.map((round) => [round.id, round.updatedAt]));
    fingerprints.push(fingerprint);
    return fingerprint;
  };
  const corrected = { ...snapshot(), photoId: undefined, updatedAt: "2026-09-04T13:00:00.000Z" };
  const options = { storage: storage as unknown as Storage, ownerId: "account-1", snapshot: corrected, deviceId: "device-a", defaultHandicap: null, hasLocalPreferenceState: false, queueForCloud: true, persistOffline };

  await saveRoundHistoryLocalFirst(options);
  await saveRoundHistoryLocalFirst(options);

  const reloaded = readStoredJson<RoundSnapshot[]>(storage as unknown as Storage, STORAGE_KEYS.history, []);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, original.id);
  assert.equal(reloaded[0].photoId, original.photoId);
  assert.equal(reloaded[0].updatedAt, corrected.updatedAt);
  assert.equal(new Set(fingerprints).size, 1);
});

test("localStorage confirmado conserva Histórico aunque IndexedDB falle y marca persistencia secundaria pendiente", async () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ roundId: "round-qa", players, scores: { 1: { said: 4 } } }));

  const saved = await saveRoundHistoryLocalFirst({
    storage: storage as unknown as Storage,
    ownerId: "account-1",
    snapshot: snapshot(),
    deviceId: "device-a",
    defaultHandicap: null,
    hasLocalPreferenceState: false,
    queueForCloud: true,
    persistOffline: async () => { throw new Error("IndexedDB bloqueado"); },
  });

  assert.equal(saved.offlinePersisted, false);
  assert.equal(saved.fingerprint, null);
  assert.ok(storage.getItem(STORAGE_KEYS.draft));
  assert.equal(readStoredJson<RoundSnapshot[]>(storage as unknown as Storage, STORAGE_KEYS.history, [])[0].id, "round-qa");
});

test("si IndexedDB no existe, la cola local alternativa sobrevive, reintenta y se confirma sin duplicados", async () => {
  const storage = new MemoryStorage();
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    const bundle = collectLocalCloudData(storage as unknown as Storage, null, false);
    bundle.history = [snapshot("fallback-round")];
    const first = await persistOfflineBundle("fallback-owner", bundle, true);
    const second = await persistOfflineBundle("fallback-owner", bundle, true);
    assert.equal(second, first);
    assert.equal((await readOfflineBundle("fallback-owner"))?.bundle.history[0]?.id, "fallback-round");
    assert.equal((await readOfflineOutbox("fallback-owner"))?.fingerprint, first);
    assert.equal([...storage.values.keys()].filter((key) => key.includes("outbox-fallback")).length, 1);

    await markOfflineAttempt("fallback-owner", "Sin red");
    assert.equal((await readOfflineOutbox("fallback-owner"))?.attempts, 1);
    assert.equal(await acknowledgeOfflineBundle("fallback-owner", "respuesta-atrasada"), false);
    assert.ok(await readOfflineOutbox("fallback-owner"));
    assert.equal(await acknowledgeOfflineBundle("fallback-owner", first), true);
    assert.equal(await readOfflineOutbox("fallback-owner"), null);
    assert.equal((await readOfflineBundle("fallback-owner"))?.syncedAt?.length ? true : false, true);
  } finally {
    if (localStorageDescriptor) Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
    else delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
});

test("si localStorage falla no confirma el Histórico ni permite cerrar el borrador", async () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ roundId: "round-qa", players, scores: { 1: { said: 4 } } }));
  const failingStorage = {
    getItem: storage.getItem.bind(storage),
    setItem(key: string, value: string) {
      if (key === STORAGE_KEYS.history) throw new Error("Cuota local agotada");
      storage.setItem(key, value);
    },
  };

  await assert.rejects(saveRoundHistoryLocalFirst({
    storage: failingStorage as unknown as Storage,
    ownerId: "account-1",
    snapshot: snapshot(),
    deviceId: "device-a",
    defaultHandicap: null,
    hasLocalPreferenceState: false,
    queueForCloud: true,
  }), /Cuota local agotada/);

  assert.ok(storage.getItem(STORAGE_KEYS.draft));
  assert.equal(storage.getItem(STORAGE_KEYS.history), null);
});

test("un almacenamiento que conserva el ID pero corrompe el contenido no se considera guardado", async () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ roundId: "round-qa", scores: { 1: { said: 4 } } }));
  const corrupting = {
    getItem: storage.getItem.bind(storage),
    setItem(key: string, value: string) {
      if (key !== STORAGE_KEYS.history) { storage.setItem(key, value); return; }
      const rounds = JSON.parse(value) as RoundSnapshot[];
      storage.setItem(key, JSON.stringify(rounds.map((round) => ({ ...round, scores: {} }))));
    },
  };
  await assert.rejects(saveRoundHistoryLocalFirst({
    storage: corrupting as unknown as Storage,
    ownerId: "account-1",
    snapshot: snapshot(),
    deviceId: "device-a",
    defaultHandicap: null,
    hasLocalPreferenceState: false,
    queueForCloud: true,
  }), /comprobar la ronda/);
  assert.ok(storage.getItem(STORAGE_KEYS.draft));
});

test("el botón finaliza solo después de persistir local/IndexedDB y nunca pide confirmar el estado cloud", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const saveStart = page.indexOf("async function saveConfirmedRound");
  const saveEnd = page.indexOf("function editHistoricalRound", saveStart);
  const flow = page.slice(saveStart, saveEnd);
  const persist = flow.indexOf("await saveRoundHistoryLocalFirst");
  const clearDraft = flow.indexOf("clearActiveRoundStorage(window.localStorage)");
  const closeRound = flow.indexOf("setRoundClosed(true)");
  const queueCloud = flow.indexOf("requestCloudSync.current?.()");

  assert.ok(persist >= 0 && persist < clearDraft);
  assert.ok(clearDraft < closeRound);
  assert.ok(closeRound < queueCloud);
  assert.doesNotMatch(page.slice(page.indexOf("function saveRound()"), saveEnd), /cloudStatus\s*!==\s*["']synced["']/);
});

test("Guardar → nube atrasada → aplicar respuesta → Histórico → reload nunca pierde la ronda", async () => {
  const storage = new MemoryStorage();
  const previous = snapshot("round-anterior");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([previous]));
  const beforeSave = collectLocalCloudData(storage as unknown as Storage, null, false);
  beforeSave.deviceId = "device-cloud";

  await saveRoundHistoryLocalFirst({
    storage: storage as unknown as Storage,
    ownerId: "account-1",
    snapshot: snapshot("round-local-final"),
    deviceId: "device-local",
    defaultHandicap: null,
    hasLocalPreferenceState: false,
    queueForCloud: true,
    persistOffline: async () => "stored-offline",
  });

  const localAfterSave = collectLocalCloudData(storage as unknown as Storage, null, false);
  localAfterSave.deviceId = "device-local";
  const reconciled = mergeLocalAndCloud(localAfterSave, beforeSave);
  writeCloudBundleToStorage(storage as unknown as Storage, reconciled);

  const reloaded = readStoredJson<RoundSnapshot[]>(storage as unknown as Storage, STORAGE_KEYS.history, []);
  assert.deepEqual(reloaded.map((round) => round.id).sort(), ["round-anterior", "round-local-final"]);
  const finalRound = reloaded.find((round) => round.id === "round-local-final");
  assert.equal(Object.values(finalRound?.scores || {}).flatMap((row) => Object.values(row)).length, 72);

  const page = readFileSync("app/page.tsx", "utf8");
  const start = page.indexOf("const applyCloudBundle");
  const end = page.indexOf("useEffect(() =>", start);
  assert.match(page.slice(start, end), /const reconciled = mergeLocalAndCloud\(local, data\)/);
  assert.match(page.slice(start, end), /JSON\.stringify\(reconciled\.history\)/);
});
