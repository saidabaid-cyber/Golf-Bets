import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CloudRetryBudget, CloudSyncGate } from "../lib/cloud-sync-gate";
import { cloudDataFingerprint, cloudSyncPayloadFingerprint, cloudSyncUploadRequired, cloudUploadDelta, downloadCloudData, mergeLocalAndCloud, uploadCloudData, type CloudDataBundle } from "../lib/cloud-sync";
import { runCloudSyncCycle } from "../lib/cloud-sync-cycle";
import { ownerRoundSyncFingerprint, ownerRoundTransportPayload, syncOwnerRound } from "../lib/owner-round-sync";
import { readCloudBundle, writeCloudBundle } from "../lib/cloud-sync-service";
import { CloudDb } from "./helpers/cloud-db";
import type { RoundSnapshot } from "../lib/types";

const at = "2026-10-05T12:00:00.000Z";
function bundle(extra: Partial<CloudDataBundle> = {}): CloudDataBundle {
  return { version: 1, history: [], frequentPlayers: [], frequentGroups: [], rivals: [], courses: [],
    preferences: { highContrast: true, language: "es-MX", notificationsEnabled: true, defaultHandicap: null, hasLocalState: true, updatedAt: at },
    activeDraft: null, activeDraftUpdatedAt: at, tombstones: [], ...extra };
}
function round(id = "budget-owner"): RoundSnapshot {
  return { id, date: "2026-10-05", startedAt: at, lifecycleState: "live", scores: { 1: { p: 4 } }, players: [],
    personalSlidingAdjustments: [], courseSnapshot: { holes: [] } } as unknown as RoundSnapshot;
}
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

test("mount, visible and online share one acknowledged flight without idle/navigation requests", () => {
  const gate = new CloudSyncGate();
  assert.equal(gate.begin("a", "mount", 100), "run");
  assert.equal(gate.begin("a", "visible", 101), "busy");
  assert.equal(gate.begin("a", "online", 102), "busy");
  assert.equal(gate.success("a", 103), "online");
  assert.equal(gate.begin("a", "online", 104), "unchanged");
  assert.equal(gate.begin("a", "mount", 105), "unchanged");
  assert.equal(gate.begin("a", "local", 1_000_000), "unchanged");
  assert.equal(gate.begin("b", "local", 1_000_001), "run");
});

test("only a real foreground transition probes another device after the coalescing window", () => {
  const gate = new CloudSyncGate(); gate.begin("a", "mount", 100); gate.success("a", 101);
  assert.equal(gate.begin("a", "visible", 1_000), "unchanged");
  assert.equal(gate.begin("a", "visible", 40_000), "run");
  gate.success("a", 40_001);
  assert.equal(gate.begin("a", "online", 40_002), "unchanged");
});

test("failed hash is not retried by auth/visibility and explicit retry remains available", () => {
  const gate = new CloudSyncGate(); gate.begin("a", "local"); gate.failure("a");
  for (const trigger of ["local", "visible", "online", "mount"] as const) assert.equal(gate.begin("a", trigger), "failed");
  assert.equal(gate.begin("a", "manual"), "run"); gate.success("a");
});

test("automatic retries use backoff and stop after three failures even if rebase changes hashes", () => {
  const retry = new CloudRetryBudget();
  assert.equal(retry.allow("mount", 100), true);
  assert.equal(retry.failure(100), 5_000);
  assert.equal(retry.allow("online", 101), false);
  assert.equal(retry.allow("retry", 5_100), true);
  assert.equal(retry.failure(5_100), 10_000);
  assert.equal(retry.allow("retry", 15_100), true);
  assert.equal(retry.failure(15_100), null);
  assert.equal(retry.allow("visible", 999_999), false);
  assert.equal(retry.allow("retry", 999_999), false);
  assert.equal(retry.allow("manual", 999_999), true);
  retry.reset(); assert.equal(retry.allow("local", 1_000_000), true);
});

test("offline local edits coalesce into one online flight and ACK prevents a second upload", () => {
  const gate = new CloudSyncGate(); gate.begin("base", "mount", 100); gate.success("base", 101);
  // Durable offline edits do not enter the network gate until connectivity returns.
  assert.equal(gate.begin("latest-offline", "online", 200), "run");
  assert.equal(gate.begin("latest-offline", "local", 201), "busy");
  assert.equal(gate.success("latest-offline", 202), "local");
  assert.equal(gate.begin("latest-offline", "local", 203), "unchanged");
});

test("canonical fingerprint excludes collection order, navigation and device/base metadata", () => {
  const left = bundle({ history: [round("a"), round("b")], activeDraft: { roundId: "active", scores: {}, currentIndex: 0 } });
  const right = { ...left, history: [...left.history].reverse(), deviceId: "new-device", baseDraft: { other: true },
    activeDraft: { roundId: "active", scores: {}, currentIndex: 9 } };
  assert.equal(cloudSyncPayloadFingerprint(left), cloudSyncPayloadFingerprint(right));
  assert.notEqual(cloudDataFingerprint(left), cloudDataFingerprint(right));
});

test("an unchanged hydrated bundle does not upload", async () => {
  let local = bundle(), posts = 0, reads = 0;
  assert.equal(await runCloudSyncCycle({ read: () => local, download: async () => { reads++; return bundle(); },
    upload: async () => { posts++; }, shouldUpload: (_local, cloud, merged) => cloudSyncPayloadFingerprint(cloud) !== cloudSyncPayloadFingerprint(merged),
    media: async () => {}, apply: data => { local = data; }, current: () => true, status: () => {} }), true);
  assert.equal(posts, 0); assert.equal(reads, 1);
});

test("canonical POST receipt eliminates the second GET and preserves the server winner", async () => {
  let local = bundle({ activeDraft: { scores: { 1: { p: 4 } } } }), reads = 0, writes = 0;
  const winner = { ...local, history: [round("imported-by-server")] };
  assert.equal(await runCloudSyncCycle({ read: () => local, download: async () => { reads++; return bundle(); },
    upload: async () => { writes++; return { data: winner }; }, media: async () => {}, apply: data => { local = data; },
    current: () => true, status: () => {} }), true);
  assert.equal(reads, 1); assert.equal(writes, 1); assert.equal(local.history[0].id, "imported-by-server");
});

test("edit during canonical receipt is preserved and schedules exactly one follow-up", async () => {
  let local = bundle({ activeDraft: { roundId: "live", scores: { 1: { p: 4 } } } }), retries = 0;
  await runCloudSyncCycle({ read: () => local, download: async () => bundle(),
    upload: async data => { local = { ...local, activeDraft: { roundId: "live", scores: { 1: { p: 4 }, 2: { p: 5 } } } }; return { data }; },
    media: async () => {}, apply: data => { local = data; }, retry: () => { retries++; }, current: () => true, status: () => {} });
  assert.equal((local.activeDraft as { scores: Record<number, unknown> }).scores[2] !== undefined, true); assert.equal(retries, 1);
});

test("navigation while a request is in flight does not schedule another upload", async () => {
  let local = bundle({ activeDraft: { roundId: "live", scores: {}, currentIndex: 0 } }), retries = 0;
  assert.equal(await runCloudSyncCycle({ read: () => local, download: async () => local,
    upload: async data => { local = { ...local, activeDraft: { roundId: "live", scores: {}, currentIndex: 8 } }; return { data }; },
    media: async () => {}, apply: data => { local = data; }, retry: () => { retries++; }, current: () => true, status: () => {} }), true);
  assert.equal(retries, 0);
});

test("delta transport retains draft base and tombstones but omits unchanged history", () => {
  const base = bundle({ history: [round("preserved"), round("changed")] });
  const next = { ...base, history: [round("preserved"), { ...round("changed"), scores: { 1: { p: 3 } } }], baseDraft: { scores: {} } };
  const delta = cloudUploadDelta(next, base);
  assert.deepEqual(delta.history.map(item => item.id), ["changed"]);
  assert.deepEqual(delta.baseDraft, next.baseDraft);
  assert.deepEqual(mergeLocalAndCloud(delta, base).history, next.history);
  assert.ok(JSON.stringify(delta).length < JSON.stringify(next).length);
});

test("real cloud service delta merge keeps canonical history, draft scores and row identity", async () => {
  const db = new CloudDb();
  db.rows("rounds_cloud").push({ id: "canonical", owner_id: "qa", local_id: "old", snapshot: { ...round("old"), updatedAt: at }, updated_at: at });
  const base = await readCloudBundle(db.client, "qa", true);
  const next = { ...base, deviceId: "qa-device", activeDraft: { roundId: "new-live", scores: { 1: { p: 4 } } }, activeDraftUpdatedAt: "2026-10-05T12:01:00.000Z" };
  const delta = cloudUploadDelta(next, base);
  await writeCloudBundle(db.client, "qa", { data: delta, fingerprint: cloudDataFingerprint(delta) }, { extendedSchema: true });
  const canonical = await readCloudBundle(db.client, "qa", true);
  assert.equal(canonical.history.length, 1); assert.equal(db.rows("rounds_cloud")[0].id, "canonical");
  assert.deepEqual(canonical.activeDraft, next.activeDraft);
});

test("same-device equal-clock display hydration does not retransmit canonical history", () => {
  const original = { ...round("display-only"), lifecycleState: "completed" as const, updatedAt: at };
  const base = bundle({ history: [original], deviceId: "iphone" });
  const local = { ...base, history: [{ ...original, presentation: { playMode: "score_only" } } as RoundSnapshot] };
  assert.equal(cloudUploadDelta(local, base).history.length, 0);
  assert.equal(cloudSyncUploadRequired(local, base), false, "hydration alone never creates a POST");
  assert.equal(cloudUploadDelta({ ...local, deviceId: "another-device" }, base).history.length, 1,
    "another device still sends conflicting material for the existing server preflight");
  assert.equal(cloudUploadDelta({ ...local, history: [{ ...local.history[0], updatedAt: "2026-10-05T12:01:00.000Z" }] }, base).history.length, 1);
  assert.equal(cloudSyncUploadRequired({ ...local, history: [{ ...local.history[0], updatedAt: "2026-10-05T12:01:00.000Z" }] }, base), true);
});

test("a live-to-completed owner transition is sent even with an equal revision clock", () => {
  const original = { ...round("closing"), updatedAt: at, scorekeeping: { version: 1, mode: "owner" } } as RoundSnapshot;
  const base = bundle({ history: [original], deviceId: "iphone" });
  const local = { ...base, history: [{ ...original, lifecycleState: "completed" as const, completedAt: at }] };
  assert.equal(cloudUploadDelta(local, base).history.length, 1);
});

test("normalizing same-device course cache retains the canonical row and real drafts still upload", () => {
  const course = { id: "course", name: "Canonical course", updatedAt: at } as CloudDataBundle["courses"][number];
  const remote = bundle({ deviceId: "iphone", courses: [course] });
  const local = { ...remote, courses: [{ ...course, localRules: [] }] };
  assert.equal(cloudSyncUploadRequired(local, remote), false);
  const edited = { ...local, activeDraft: { roundId: "live", scores: { 1: { p: 4 } } }, activeDraftUpdatedAt: "2026-10-05T12:01:00.000Z" };
  assert.equal(cloudSyncUploadRequired(edited, remote), true);
});

test("conditional private GET returns known bundle using only a small receipt", async () => {
  const original = globalThis.fetch, known = bundle(); let url = "";
  try {
    globalThis.fetch = async (input, init) => { url = String(input); assert.equal(init?.cache, "no-store");
      return Response.json({ unchanged: true, fingerprint: cloudSyncPayloadFingerprint(known) }); };
    assert.equal(await downloadCloudData("qa-token", known), known);
    assert.match(url, /\?fingerprint=/);
  } finally { globalThis.fetch = original; }
});

test("upload validates both submitted ACK and canonical fingerprint", async () => {
  const original = globalThis.fetch, data = bundle();
  try {
    globalThis.fetch = async (_input, init) => { const body = JSON.parse(String(init?.body));
      return Response.json({ ok: true, fingerprint: body.fingerprint, data, canonicalFingerprint: "wrong" }); };
    await assert.rejects(uploadCloudData(data, "qa-token"), /canónica/);
    globalThis.fetch = async (_input, init) => { const body = JSON.parse(String(init?.body));
      return Response.json({ ok: true, fingerprint: body.fingerprint, data, canonicalFingerprint: cloudSyncPayloadFingerprint(data) }); };
    assert.deepEqual((await uploadCloudData(data, "qa-token")).data, data);
  } finally { globalThis.fetch = original; }
});

test("owner render timestamps do not make unchanged material dirty", () => {
  const first = { ...round(), personalSlidingAdjustments: [{ id: "slide", updatedAt: at }] } as unknown as RoundSnapshot;
  const next = { ...first, updatedAt: "later", completedAt: "later", personalSlidingAdjustments: [{ id: "slide", updatedAt: "later" }] } as unknown as RoundSnapshot;
  assert.equal(ownerRoundSyncFingerprint(ownerRoundTransportPayload(first)), ownerRoundSyncFingerprint(ownerRoundTransportPayload(next)));
  assert.equal(JSON.parse(ownerRoundTransportPayload(next)).personalSlidingAdjustments[0].updatedAt, "later");
  assert.notEqual(ownerRoundTransportPayload(first), ownerRoundTransportPayload({ ...next, scores: { 1: { p: 5 } } }));
});

test("owner ACK survives remount and sends no redundant GET/PUT", async () => {
  const local = storage(); let calls = 0;
  const request: typeof fetch = async (_input, init) => { calls++;
    return Response.json(init?.method ? { version: 1 } : { data: null }); };
  const serialized = ownerRoundTransportPayload(round("remount"));
  await syncOwnerRound(serialized, "qa", "token", local, () => true, request);
  await syncOwnerRound(serialized, "qa", "renewed-token", local, () => true, request);
  assert.equal(calls, 2);
});

test("rapid owner edits retain only the latest capture after a single flight", async () => {
  const local = storage(); let release!: () => void, gets = 0, writes = 0, middleCurrent = true, version = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const request: typeof fetch = async (_input, init) => {
    if (!init?.method) { gets++; if (gets === 1) await held; return Response.json({ data: version ? { id: "canonical", version } : null }); }
    writes++; version++; return Response.json({ version });
  };
  const first = round("rapid");
  const p1 = syncOwnerRound(ownerRoundTransportPayload(first), "qa", "token", local, () => true, request);
  const p2 = syncOwnerRound(ownerRoundTransportPayload({ ...first, scores: { 1: { p: 5 } } }), "qa", "token", local, () => middleCurrent, request);
  const p3 = syncOwnerRound(ownerRoundTransportPayload({ ...first, scores: { 1: { p: 6 } } }), "qa", "token", local, () => true, request);
  middleCurrent = false; release(); await Promise.all([p1, p2, p3]);
  assert.equal(gets, 2); assert.equal(writes, 2);
});

test("owner remote revision change never authorizes overwriting another device", async () => {
  const local = storage(); local.setItem("backyard-owner-round-revision:qa:conflict", "3"); let writes = 0;
  const request: typeof fetch = async (_input, init) => { if (init?.method) writes++; return Response.json({ data: { version: 4 } }); };
  await assert.rejects(syncOwnerRound(ownerRoundTransportPayload(round("conflict")), "qa", "token", local, () => true, request), /versión/);
  assert.equal(writes, 0);
});

test("owner failed hash cannot repeatedly request through renders; newer edits remain retryable", async () => {
  const local = storage(); let calls = 0;
  const request: typeof fetch = async () => { calls++; return Response.json({ error: "network" }, { status: 503 }); };
  const serialized = ownerRoundTransportPayload(round("failure"));
  await assert.rejects(syncOwnerRound(serialized, "qa", "token", local, () => true, request));
  await assert.rejects(syncOwnerRound(serialized, "qa", "token", local, () => true, request)); assert.equal(calls, 1);
  await assert.rejects(syncOwnerRound(serialized, "qa", "token", local, () => true, request, true)); assert.equal(calls, 2);
});

test("sync wiring has no idle interval or automatic manual retry; canonical receipt follows shared sync", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(page, /foregroundRefresh|45_000|dispatchEvent\(new Event\("backyard-sync-retry"\)/);
  assert.match(page, /retryBudget\.failure/); assert.match(page, /retryDelay !== null/);
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /detail: \{ trigger: "online" \}/); assert.match(provider, /detail: \{ trigger: "manual" \}/);
  const route = readFileSync("app/api/cloud/sync/route.ts", "utf8");
  assert.ok(route.indexOf("const delivery = await syncSharedRoundParticipants") < route.indexOf('request.headers.get("x-backyard-sync-canonical")'));
  assert.match(route, /scheduleSocialPublication/); assert.match(route, /private, no-store/);
});
