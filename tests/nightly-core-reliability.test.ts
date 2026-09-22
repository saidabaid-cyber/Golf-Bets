import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { cloudDataFingerprint, findAmbiguousCloudConflicts, mergeLocalAndCloud, restoreLocalRoundUi, type CloudDataBundle } from "../lib/cloud-sync";
import { runCloudSyncCycle, type SyncStatus } from "../lib/cloud-sync-cycle";
import { CloudSyncGate } from "../lib/cloud-sync-gate";
import { getOfflineDeviceId, persistOfflineBundle, readOfflineBundle, readOfflineOutbox, acknowledgeOfflineBundle, markOfflineAttempt, offlineRetryDelayMs } from "../lib/offline-store";
import { backupActiveRoundForReplacement } from "../lib/new-round-safety";
import { CLOUD_CONFLICTS_KEY, switchAccountWorkspace, ownsLocalWorkspace } from "../lib/account-workspace";
import { deriveRoundLifecycleState, markRoundDraftCancelled, normalizeHistoricalRoundLifecycle } from "../lib/round-lifecycle";
import { STORAGE_KEYS } from "../lib/round-utils";
import { roundBetResult } from "../lib/round-betting-boundary";
import { createTotalScoreRound, validTotalOnly } from "../lib/total-score-round";
import { writeVersionedRow } from "../lib/cloud-write";
import { readCloudBundle, writeCloudBundle } from "../lib/cloud-sync-service";
import { fullRoundCourse, fullRoundPlayers } from "./fixtures/full-round";
import { CloudDb } from "./helpers/cloud-db";

// Synthetic protocol fixtures only. These do not substitute for live DB RLS QA.
class Storage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const at = (n = 0) => new Date(Date.UTC(2026, 8, 22, 0, 0, n)).toISOString();
function draft() {
  return { roundId: "synthetic-round", players: [{ id: "qa-a", name: "Synthetic A", handicap: 10 }],
    scores: {} as Record<number, Record<string, number>>, putts: {} as Record<number, Record<string, number>>,
    startedAt: at(), lifecycleState: "live", currentIndex: 0, reviewPending: false };
}
function bundle(activeDraft: unknown = draft(), deviceId = "session-a"): CloudDataBundle {
  return { version: 1, deviceId, history: [], frequentPlayers: [], frequentGroups: [], rivals: [], courses: [], tombstones: [],
    preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null },
    activeDraft, activeDraftUpdatedAt: at() };
}
async function withFallback(run: (storage: Storage) => Promise<void>) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const storage = new Storage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try { await run(storage); }
  finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalDb) Object.defineProperty(globalThis, "indexedDB", originalDb);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
}

test("nightly: offline H1 → outage H2 → reconnect preserves exact scores and putts", async () => withFallback(async () => {
  const captured = draft(); captured.scores[1] = { "qa-a": 4 }; captured.putts[1] = { "qa-a": 2 };
  await persistOfflineBundle("qa-a", bundle(captured), true);
  captured.scores[2] = { "qa-a": 5 }; captured.putts[2] = { "qa-a": 1 };
  await persistOfflineBundle("qa-a", { ...bundle(captured), activeDraftUpdatedAt: at(2) }, true);
  await markOfflineAttempt("qa-a", "offline");
  let local = (await readOfflineBundle("qa-a"))!.bundle;
  let cloud = bundle(null);
  assert.equal((await readOfflineOutbox("qa-a"))?.attempts, 1);
  assert.equal(await runCloudSyncCycle({ read: () => local, download: async () => structuredClone(cloud),
    upload: async b => { cloud = structuredClone(b); }, media: async () => {}, apply: b => { local = b; }, current: () => true, status: () => {} }), true);
  assert.deepEqual((cloud.activeDraft as ReturnType<typeof draft>).scores, captured.scores);
  assert.deepEqual((cloud.activeDraft as ReturnType<typeof draft>).putts, captured.putts);
  assert.equal(await acknowledgeOfflineBundle("qa-a", (await readOfflineOutbox("qa-a"))!.fingerprint), true);
  assert.equal(await readOfflineOutbox("qa-a"), null);
}));

test("nightly regression: mutable payload cannot diverge from its durable fingerprint", async () => withFallback(async () => {
  const payload = bundle();
  const saving = persistOfflineBundle("qa-a", payload, true);
  (payload.activeDraft as ReturnType<typeof draft>).scores[1] = { "qa-a": 19 };
  const fingerprint = await saving;
  const saved = (await readOfflineBundle("qa-a"))!;
  assert.deepEqual((saved.bundle.activeDraft as ReturnType<typeof draft>).scores, {});
  assert.equal(cloudDataFingerprint(saved.bundle), fingerprint);
  assert.equal((await readOfflineOutbox("qa-a"))?.fingerprint, fingerprint);
}));

test("nightly regression: edit in place during upload is pending, rebased and retried", async () => {
  let local = bundle(); let cloud = bundle(); let retries = 0; let first = true;
  const run = () => runCloudSyncCycle({ read: () => local, download: async () => structuredClone(cloud),
    upload: async b => { cloud = structuredClone(b); if (first) { first = false; (local.activeDraft as ReturnType<typeof draft>).scores[2] = { "qa-a": 3 }; local.activeDraftUpdatedAt = at(2); } },
    media: async () => {}, apply: b => { local = b; }, current: () => true, status: () => {}, retry: () => { retries++; } });
  assert.equal(await run(), false);
  assert.equal(retries, 1);
  assert.equal(await run(), true);
  assert.equal((cloud.activeDraft as ReturnType<typeof draft>).scores[2]["qa-a"], 3);
});

test("nightly regression: replacing a round cannot import the old round's hole navigation", () => {
  assert.deepEqual(restoreLocalRoundUi({ roundId: "new", currentIndex: 0 }, { roundId: "old", currentIndex: 17 }), { roundId: "new", currentIndex: 0 });
  assert.deepEqual(restoreLocalRoundUi({ roundId: "same" }, { roundId: "same", currentIndex: 8 }), { roundId: "same", currentIndex: 8 });
  assert.deepEqual(restoreLocalRoundUi({}, { currentIndex: 17 }), {});
});

test("nightly regression: unavailable IndexedDB retains distinct browser IDs across reload calls", async () => withFallback(async storage => {
  const first = await getOfflineDeviceId();
  assert.notEqual(first, "browser-no-indexeddb");
  assert.equal(await getOfflineDeviceId(), first);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new Storage() });
  const second = await getOfflineDeviceId(); assert.notEqual(first, second);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  assert.equal(await getOfflineDeviceId(), first);
}));

test("nightly regression: device identity initialization uses one atomic readwrite transaction", async () => withFallback(async () => {
  const modes: string[] = []; let stored: { key: string; value: string } | undefined; let closes = 0;
  // Minimal IndexedDB event protocol. Real multi-tab browser QA is separate.
  const database = {
    close: () => { closes++; },
    transaction: (_store: string, mode: string) => {
      modes.push(mode);
      const tx = { oncomplete: undefined as (() => void) | undefined, objectStore: () => ({
        get: () => {
          const request = { result: stored, onsuccess: undefined as (() => void) | undefined };
          queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
          return request;
        },
        put: (value: { key: string; value: string }) => { stored = value; },
      }) };
      return tx;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => {
    const request = { result: database, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } } });
  const first = await getOfflineDeviceId();
  assert.equal(await getOfflineDeviceId(), first);
  assert.deepEqual(modes, ["readwrite", "readwrite"]);
  assert.equal(closes, 2);
}));

for (const failure of ["request-error", "abort"] as const) {
  test(`nightly regression: device ID ${failure} returns fallback without unhandled transaction rejection`, () => {
    // A subprocess with strict rejection handling verifies the asynchronous
    // failure after fallback returns, without altering this runner's listeners.
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "-e", `
      const assert = require('node:assert/strict');
      const { getOfflineDeviceId } = require(${JSON.stringify(resolve(__dirname, "../lib/offline-store.js"))});
      const values = new Map(); let closed = 0;
      global.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
      const database = {
        close: () => { closed++; },
        transaction: () => {
          const tx = { error: new Error('Synthetic transaction failure'), objectStore: () => ({
            get: () => {
              const request = { error: new Error('Synthetic request failure') };
              queueMicrotask(() => {
                request.onerror();
                tx[${JSON.stringify(failure === "abort" ? "onabort" : "onerror")}]();
              });
              return request;
            }
          }) };
          return tx;
        }
      };
      global.indexedDB = { open: () => {
        const request = { result: database };
        queueMicrotask(() => request.onsuccess()); return request;
      } };
      getOfflineDeviceId().then(id => {
        assert.ok(id && id !== 'browser-no-indexeddb'); assert.equal(closed, 1);
        setImmediate(() => process.stdout.write('fallback recovered'));
      }).catch(error => { console.error(error); process.exitCode = 1; });
    `], { encoding: "utf8", timeout: 5_000 });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, "fallback recovered");
  });
}

for (const stage of ["download", "upload", "readback", "media"] as const) {
  test(`nightly: logout/reload cancellation at ${stage} never applies stale session data`, async () => {
    let current = true, downloads = 0, applied = 0;
    const statuses: SyncStatus[] = [];
    await assert.rejects(runCloudSyncCycle({ read: () => bundle(),
      download: async () => { downloads++; if (stage === "download" || (stage === "readback" && downloads === 2)) current = false; return bundle(); },
      upload: async () => { if (stage === "upload") current = false; }, media: async () => { if (stage === "media") current = false; },
      apply: () => { applied++; }, current: () => current, status: s => statuses.push(s) }), /cancelled/);
    assert.equal(applied, 0); assert.equal(statuses.includes("synced"), false);
  });
}

test("nightly: same-user sessions merge disjoint holes and stop on same-cell conflict", () => {
  const base = draft();
  const local = { ...bundle({ ...base, scores: { 1: { "qa-a": 4 } } }), baseDraft: base, baseDraftFingerprint: JSON.stringify(base) };
  const remote = bundle({ ...base, scores: { 2: { "qa-a": 5 } } }, "session-b");
  assert.equal(findAmbiguousCloudConflicts(local, remote).length, 0);
  assert.deepEqual((mergeLocalAndCloud(local, remote).activeDraft as ReturnType<typeof draft>).scores, { 1: { "qa-a": 4 }, 2: { "qa-a": 5 } });
  remote.activeDraft = { ...base, scores: { 1: { "qa-a": 6 } } };
  assert.ok(findAmbiguousCloudConflicts(local, remote).some(c => c.fieldPath === "/scores/1/qa-a"));
});

test("nightly: new round backup and logout/login preserve draft and immutable history", () => {
  const storage = new Storage(); switchAccountWorkspace(storage, "qa-a");
  const active = draft(); active.scores[1] = { "qa-a": 4 }; active.putts[1] = { "qa-a": 2 };
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(active));
  storage.setItem(STORAGE_KEYS.history, '[{"id":"historical","score":80}]');
  assert.equal(backupActiveRoundForReplacement(storage, () => true), true);
  switchAccountWorkspace(storage, "guest"); assert.equal(ownsLocalWorkspace(storage, "qa-a"), false);
  switchAccountWorkspace(storage, "qa-b"); assert.equal(storage.getItem(STORAGE_KEYS.draft), null);
  storage.setItem(STORAGE_KEYS.draft, '{"roundId":"b"}');
  switchAccountWorkspace(storage, "qa-a");
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!), active);
  const cancelled = JSON.parse(storage.getItem(CLOUD_CONFLICTS_KEY)!)[0];
  assert.equal(cancelled.lifecycleState, "cancelled"); assert.deepEqual(cancelled.putts, active.putts);
  assert.equal(storage.getItem(STORAGE_KEYS.history), '[{"id":"historical","score":80}]');
});

test("nightly: CAS detects concurrent session winner; repeated writes remain idempotent", async () => {
  const db = new CloudDb(); const keys = { owner_id: "qa-a", local_id: "round" };
  await writeVersionedRow(db.client, "rounds_cloud", keys, { ...keys, updated_at: at(), snapshot: { score: 4 } });
  db.before = (table, op) => { if (table === "rounds_cloud" && op === "update") { db.rows(table)[0].updated_at = at(1); db.rows(table)[0].snapshot = { score: 3 }; } };
  await assert.rejects(writeVersionedRow(db.client, "rounds_cloud", keys, { ...keys, updated_at: at(2), snapshot: { score: 5 } }), /Otro dispositivo/);
  db.before = undefined;
  for (let i = 0; i < 100; i++) assert.equal(await writeVersionedRow(db.client, "rounds_cloud", keys, { ...keys, updated_at: at(1), snapshot: { score: 3 } }), false);
  assert.equal(db.rows("rounds_cloud").length, 1); assert.deepEqual(db.rows("rounds_cloud")[0].snapshot, { score: 3 });
});

test("nightly: owner-filtered protocol reads/writes cannot cross A and B (not live RLS)", async () => {
  const db = new CloudDb();
  await writeCloudBundle(db.client, "qa-a", { data: bundle(), fingerprint: "a" }, { extendedSchema: true });
  const before = structuredClone(db.rows("user_cloud_state").filter(r => r.user_id === "qa-a"));
  assert.equal((await readCloudBundle(db.client, "qa-b", true)).activeDraft, null);
  await writeCloudBundle(db.client, "qa-b", { data: bundle({ ...draft(), roundId: "b" }), fingerprint: "b" }, { extendedSchema: true });
  assert.deepEqual(db.rows("user_cloud_state").filter(r => r.user_id === "qa-a"), before);
  assert.equal(((await readCloudBundle(db.client, "qa-a", true)).activeDraft as ReturnType<typeof draft>).roundId, "synthetic-round");
});

for (const holes of [9, 18] as const) for (const start of [1, 10] as const) {
  test(`nightly: total-only ${holes} holes start ${start} stays empty through history/catalog merge`, () => {
    const course = structuredClone(fullRoundCourse); const player = { ...fullRoundPlayers[0], accountUserId: "qa-a" };
    const round = createTotalScoreRound({ id: `total-${holes}-${start}`, course, player, date: "2026-09-22", holes, start, total: holes * 4, now: at() });
    const frozen = JSON.stringify(round);
    course.name = "Synthetic catalog edit"; course.holes[0].par = 5;
    const merged = mergeLocalAndCloud({ ...bundle(null), history: [round], courses: [course] }, bundle(null));
    assert.equal(JSON.stringify(merged.history[0]), frozen);
    assert.equal(validTotalOnly(merged.history[0], "qa-a"), true);
    assert.deepEqual(merged.history[0].scores, {}); assert.deepEqual(merged.history[0].putts, {});
  });
}

test("nightly: every score-only engine boundary bypasses monetary computation on retries", () => {
  const engines = ["calculateRabbits", "calculateSkins", "calculateUnits", "calculateMonkey", "calculateFoursomes", "calculateBallFriend", "calculatePersonalBets", "calculatePolla", "calculateMiniPolla", "calculateManualBets", "calculateCounterBet", "calculateLoba", "calculateSupplementalBets"] as const;
  for (const engine of engines) for (let retry = 0; retry < 10; retry++) {
    assert.doesNotThrow(() => roundBetResult("score_only", engine, () => { throw new Error("engine must not run"); }));
  }
});

test("nightly: cancelled never promotes; live pause/resume and review preserve durable states", () => {
  // Paused/reviewed are UI workflow states, not new persisted lifecycle enums.
  for (const reviewPending of [false, true]) for (const scores of [{}, { 18: { "qa-a": 4 } }]) {
    const cancelled = markRoundDraftCancelled({ ...draft(), scores, reviewPending }, at(2));
    assert.equal(deriveRoundLifecycleState(cancelled), "cancelled");
    assert.equal(normalizeHistoricalRoundLifecycle(cancelled).lifecycleState, "cancelled");
    assert.equal(deriveRoundLifecycleState({ ...draft(), scores, reviewPending, holeSummaryPaused: true }), reviewPending ? "completed" : "live");
  }
});

test("nightly: 32 deterministic outage/reload/retry schedules preserve every durable edit", async () => withFallback(async () => {
  for (let seed = 1; seed <= 32; seed++) {
    const owner = `synthetic-${seed}`, state = draft();
    for (let hole = 1; hole <= 18; hole++) {
      state.scores[hole] = { "qa-a": 2 + ((seed * 17 + hole * 7) % 8) };
      state.putts[hole] = { "qa-a": (seed + hole) % 4 };
      const fp = await persistOfflineBundle(owner, { ...bundle(state), activeDraftUpdatedAt: at(hole) }, true);
      if ((seed + hole) % 3 === 0) await markOfflineAttempt(owner, "deterministic network interruption");
      assert.deepEqual((await readOfflineBundle(owner))!.bundle.activeDraft, state);
      if ((seed + hole) % 4 === 0) { assert.equal(await acknowledgeOfflineBundle(owner, fp), true); assert.equal(await readOfflineOutbox(owner), null); }
    }
    const recovered = (await readOfflineBundle(owner))!.bundle.activeDraft as ReturnType<typeof draft>;
    assert.equal(Object.keys(recovered.scores).length, 18); assert.deepEqual(recovered.putts, state.putts);
  }
}));

test("nightly: scheduler coalesces 100 tab events and bounded retries without duplicate runs", () => {
  const gate = new CloudSyncGate(); assert.equal(gate.begin("v1", "mount"), "run");
  for (let i = 0; i < 100; i++) assert.equal(gate.begin("v2", i % 2 ? "online" : "local"), "busy");
  assert.equal(gate.success("v1"), "online"); assert.equal(gate.begin("v2", "online"), "run");
  gate.success("v2"); assert.equal(gate.begin("v2", "local"), "unchanged");
  gate.cancel(); assert.equal(gate.begin("v3", "manual"), "cancelled");
  for (let attempt = 0; attempt < 100; attempt++) assert.ok(offlineRetryDelayMs(attempt) <= 300_000);
});
