import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { cloudCycleErrorFields, runCloudSyncCycle, type CloudCycleTrace } from "../lib/cloud-sync-cycle";
import { CloudCanonicalSession } from "../lib/cloud-canonical-session";
import { CloudSyncGate } from "../lib/cloud-sync-gate";
import { CLOUD_LOCAL_META_KEY, collectLocalCloudData, trackLocalCloudCheckpoint, persistCloudMetadata, cloudSyncPayloadFingerprint, downloadCloudData, cloudSyncUploadRequired, type CloudDataBundle } from "../lib/cloud-sync";
import { saveRoundHistoryLocalFirst } from "../lib/round-history-save";
import { clearActiveRoundStorage, readStoredJson, STORAGE_KEYS } from "../lib/round-utils";
import type { RoundSnapshot } from "../lib/types";

const at = "2026-10-05T12:00:00.000Z";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function closingRound(): RoundSnapshot {
  return { id: "closing", date: "2026-10-05", updatedAt: at, completedAt: at, startedAt: at,
    lifecycleState: "completed", roundHoles: 18, ownerId: "p", players: [{ id: "p", name: "Controlled fixture", handicap: 0 }],
    order: Array.from({ length: 18 }, (_, i) => i + 1), scores: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, { p: 4 }])),
    courseSnapshot: { id: "fixture", name: "Local fixture", teeName: "Fixture", holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })) },
    courseName: "Local fixture", teeName: "Fixture", ownerName: "Controlled fixture",
    expenses: { greenFee: 0, cartRental: 0, food: 0, drinks: 0, caddie: 0, other: 0 },
    personalSlidingAdjustments: [], betResult: 0, netResult: 0, expenseTotal: 0, categoryResults: {},
  } as RoundSnapshot;
}
function pageCloseout() {
  const page = readFileSync("app/page.tsx", "utf8");
  const start = page.indexOf("  async function saveConfirmedRound(");
  const source = page.slice(start, page.indexOf("  useLayoutEffect(", start));
  assert.ok(source.includes("saveRoundHistoryLocalFirst"));
  return ts.transpileModule("const closeout = " + source + "; closeout;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
function harness() {
  const storage = new MemoryStorage(), offline = deferred<string>(), uploaded = deferred<unknown>(), uploadStarted = deferred<void>();
  const revision = { current: 0 }, flush = { current: (() => revision.current === 0) as (() => boolean) | null };
  const draft = { roundId: "closing", scores: { 1: { p: 4 } } };
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
  storage.setItem(CLOUD_LOCAL_META_KEY, JSON.stringify({ draftValue: JSON.stringify(draft), draftAt: "2026-01-01T00:00:00.000Z" }));
  const identity = { userId: "qa", mode: "authenticated", defaultHandicap: null, accessToken: "fixture-not-a-real-token" };
  const noop = () => {};
  const scope = {
    roundSaveInFlight: { current: false }, localPersistRevision: revision, flushLocalState: flush,
    setSaveStatus: noop, identity, cloudLinked: true, window: { localStorage: storage }, localStorage: storage,
    history: [], indexControl: { preference: {} }, offlineDeviceId: { current: "fixture-device" }, hadLocalPreferences: { current: true },
    preserveRoundStatisticsOrigin: (s: RoundSnapshot) => s, captureCompletedRoundIndex: (s: RoundSnapshot) => s,
    readIndexPreference: () => null, clearActiveRoundStorage, normalizeHistorySnapshot: (s: RoundSnapshot) => s,
    readStoredJson, STORAGE_KEYS, trackLocalCloudCheckpoint, highContrast: false, notificationsEnabled: true,
    saveRoundHistoryLocalFirst: (options: Parameters<typeof saveRoundHistoryLocalFirst>[0]) => saveRoundHistoryLocalFirst({ ...options, persistOffline: () => offline.promise }),
    setHistory: noop, setRoundClosed: noop, setRoundReviewPending: noop, setShowRoundFinishedNotice: noop,
    setDraftAvailable: noop, updateBackyardAiMetrics: noop, recordRoundCompletionMetric: noop, recordProductEvent: noop,
    setFrequentPlayers: noop, players: [], setSavedPersonalRivals: noop, setCloudStatus: noop, navigator: { onLine: true },
    setFeedback: noop, requestCloudSync: { current: noop }, recordScorecardResultReached: noop, openHistoricalRound: noop,
    setJustSavedGroupRound: noop,
  };
  const closeout = vm.runInNewContext(pageCloseout(), scope) as (snapshot: RoundSnapshot) => Promise<void>;
  const read = () => {
    if (!flush.current?.()) throw Object.assign(new Error("Local persistence fence rejected a stale closure"), { code: "LOCAL_CHECKPOINT_UNAVAILABLE" });
    return collectLocalCloudData(storage, null, true);
  };
  let gets = 0, posts = 0, retries = 0, applied: CloudDataBundle | null = null;
  let canonical = collectLocalCloudData(new MemoryStorage(), null, true);
  const cycle = () => runCloudSyncCycle({
    read, current: () => true, download: async () => { gets++; return canonical; },
    upload: async data => { posts++; uploadStarted.resolve(); await uploaded.promise; canonical = data; return { data }; },
    media: async () => {}, apply: data => { applied = data; persistCloudMetadata(storage, data); }, status: noop,
    retry: () => { retries++; },
  });
  return { storage, offline, uploaded, uploadStarted, revision, flush, closeout, cycle, counts: () => ({ gets, posts, retries }), applied: () => applied };
}

test("closeout during a canonical POST reads the verified checkpoint while IndexedDB waits", async () => {
  const h = harness();
  const cycle = h.cycle();
  await h.uploadStarted.promise;
  const saving = h.closeout(closingRound());
  assert.equal(h.revision.current, 1);
  h.uploaded.resolve({});
  // This is a newer real local edit, so one coalesced follow-up is required;
  // it is not a failure/retry of the already acknowledged POST.
  assert.equal(await cycle, false);
  assert.deepEqual(h.counts(), { gets: 1, posts: 1, retries: 1 });
  assert.equal(JSON.parse(h.storage.getItem(STORAGE_KEYS.history)!)[0].id, "closing");
  assert.equal(h.storage.getItem(STORAGE_KEYS.draft), null);
  assert.equal(await h.cycle(), true);
  assert.equal(h.applied()?.history[0].id, "closing");
  assert.equal(h.applied()?.activeDraft, null);
  assert.deepEqual(h.counts(), { gets: 2, posts: 2, retries: 1 });
  h.offline.resolve("durable");
  await saving;
});

test("a completed checkpoint POST succeeds before IndexedDB resolves, with no retry or receipt GET", async () => {
  const h = harness();
  const saving = h.closeout(closingRound());
  const cycle = h.cycle();
  await h.uploadStarted.promise;
  h.uploaded.resolve({});
  assert.equal(await cycle, true);
  assert.deepEqual(h.counts(), { gets: 1, posts: 1, retries: 0 });
  assert.equal(h.applied()?.history[0].scores?.[18]?.p, 4);
  assert.equal(h.applied()?.activeDraft, null);
  h.offline.resolve("durable");
  await saving;
});

test("the former stale persistence fence is diagnosed at the exact post-POST read, not as HTTP failure", async () => {
  const canonical = collectLocalCloudData(new MemoryStorage(), null, true);
  let reads = 0;
  const error = Object.assign(new Error("Do not log this private message"), { code: "LOCAL_CHECKPOINT_UNAVAILABLE" });
  const traces: CloudCycleTrace[] = [];
  await assert.rejects(runCloudSyncCycle({ read: () => { if (++reads === 2) throw error; return canonical; },
    download: async () => canonical, upload: async () => ({ data: canonical }), media: async () => {},
    apply: () => assert.fail("a failed local read cannot apply a stale response"), current: () => true, status: () => {}, trace: e => traces.push(e),
  }), actual => actual === error);
  assert.deepEqual(traces.at(-1), { stage: "sync:local-read-after-persistence", result: "failure", persisted: true,
    category: "post-persistence-client", errorName: "Error", errorCode: "LOCAL_CHECKPOINT_UNAVAILABLE" });
  assert.equal(JSON.stringify(traces).includes("private message"), false);
});

for (const sideEffect of ["media", "apply"] as const) {
  test(`a real ${sideEffect} failure keeps the canonical receipt and recovers without reupload/full GET`, async () => {
    const session = new CloudCanonicalSession(); session.select("account-a");
    let local = collectLocalCloudData(new MemoryStorage(), null, true), gets = 0, posts = 0, fails = true;
    const traces: CloudCycleTrace[] = [], error = new TypeError("Private fixture content");
    const gate = new CloudSyncGate();
    const cycle = () => runCloudSyncCycle({ read: () => local, current: () => true, status: () => {}, trace: e => traces.push(e),
      download: async () => { gets++; return session.select("account-a") || local; },
      shouldUpload: (_l, remote, merged) => !session.select("account-a") || cloudSyncUploadRequired(merged, remote),
      upload: async data => { posts++; session.remember("account-a", data); return { data }; },
      media: async () => { if (fails && sideEffect === "media") throw error; },
      apply: data => { if (fails && sideEffect === "apply") throw error; local = data; },
    });
    gate.begin("dirty", "local");
    await assert.rejects(cycle(), actual => actual === error);
    gate.failure("dirty");
    assert.equal(traces.at(-1)?.persisted, true);
    assert.equal(traces.at(-1)?.category, "secondary-side-effect");
    assert.ok(session.select("account-a"), "a failed local side effect cannot erase server evidence");
    fails = false;
    assert.equal(gate.begin("dirty", "retry"), "run");
    assert.equal(await cycle(), true);
    gate.success(cloudSyncPayloadFingerprint(local));
    assert.deepEqual({ gets, posts }, { gets: 2, posts: 1 });
    assert.equal(gate.begin(cloudSyncPayloadFingerprint(local), "local"), "unchanged");
  });
}

test("effect recreation uses a private conditional receipt and logout prevents cross-account/stale adoption", async () => {
  const session = new CloudCanonicalSession(); session.select("account-a");
  const canonical = collectLocalCloudData(new MemoryStorage(), null, true);
  canonical.history = [closingRound()]; session.remember("account-a", canonical);
  const original = globalThis.fetch;
  let responseBytes = 0;
  try {
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).includes("fingerprint=")); assert.equal(init?.cache, "no-store");
      const reply = { unchanged: true, fingerprint: cloudSyncPayloadFingerprint(canonical) };
      responseBytes = JSON.stringify(reply).length; return Response.json(reply);
    };
    const recreatedCoordinator = session.select("account-a");
    const received = await downloadCloudData("fixture-token", recreatedCoordinator);
    assert.equal(received.history, canonical.history);
    assert.ok(responseBytes < 300);
  } finally { globalThis.fetch = original; }
  session.select(null); assert.equal(session.select("account-a"), undefined);
  session.select("account-b"); session.remember("account-a", canonical);
  assert.equal(session.select("account-b"), undefined);
});

test("closeout does not recreate the cloud effect and diagnostics contain no arbitrary message/name", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const start = page.indexOf("const retryBudget = new CloudRetryBudget()");
  const dependencies = page.slice(start, page.indexOf("function resolveCloudConflict", start)).split("}, [").at(-1)!;
  for (const localState of ["roundClosed", "history", "roundId", "currentIndex", "tab"]) assert.equal(new RegExp(`\\b${localState}\\b`).test(dependencies), false);
  assert.deepEqual(cloudCycleErrorFields({ name: "user@example.invalid", code: "secret token", status: 409 }), { errorName: "Error", httpStatus: 409 });
});
