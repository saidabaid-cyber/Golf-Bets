import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageHydrationHarness } from "./helpers/page-hydration";
import { CLOUD_LOCAL_META_KEY, cloudSyncPayloadFingerprint, cloudSyncUploadReasons, cloudSyncUploadRequired, collectLocalCloudData, mergeLocalAndCloud, findAmbiguousCloudConflicts, cloudUploadDelta } from "../lib/cloud-sync";
import { CloudDb } from "./helpers/cloud-db";
import { writeCloudBundle } from "../lib/cloud-sync-service";
import { runCloudSyncCycle } from "../lib/cloud-sync-cycle";
import { CloudRetryBudget, CloudSyncGate } from "../lib/cloud-sync-gate";
import { CloudHydrationBoundary } from "../lib/cloud-hydration";
import { normalizeRoundDraft } from "../lib/round-utils";
import { parseFrequentGroups } from "../lib/frequent-templates";
import { projectAccountPrimaryFrequentPlayers } from "../lib/account-primary-player";
import type { CloudDataBundle } from "../lib/cloud-sync";
import type { RoundSnapshot } from "../lib/types";

const at = "2026-10-01T10:00:00.000Z";
function setup(transform?: (draft: any) => any) {
  const h = pageHydrationHarness();
  const frequent = { id: "account:qa-owner", accountUserId: "qa-owner", memberId: "owner-member", name: "QA Owner", handicap: 30.8, uses: 3, updatedAt: at };
  const history: RoundSnapshot = { id: "completed", lifecycleState: "completed", updatedAt: at, date: "2026-10-01", completedAt: at,
    courseName: "QA Course", teeName: "QA Tee", ownerName: "QA Owner", betResult: 0, netResult: 0, expenseTotal: 0, categoryResults: {}, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    ownerId: "account:qa-owner", players: h.fixture.players, order: [1], scores: { 1: { "account:qa-owner": 5 } } };
  const remote: CloudDataBundle = { version: 1, deviceId: "fixture-device", history: [history], frequentPlayers: [frequent],
    frequentGroups: parseFrequentGroups(JSON.stringify([{ id: "qa-group", name: "QA Fixture", players: [{ name: "QA Guest", handicap: 12, memberId: "guest-member", kind: "guest" }], uses: 1, updatedAt: at }])),
    rivals: [], courses: h.scope.mergeDefaultCourses([h.fixture.course]), preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null, hasLocalState: true, updatedAt: at },
    activeDraft: transform ? JSON.parse(JSON.stringify(transform(h.fixture))) : h.fixture, activeDraftUpdatedAt: at, tombstones: [] };
  const empty = collectLocalCloudData(h.storage, null, false);
  h.scope.courses = []; h.scope.setCourses ||= (courses: any) => { h.scope.courses = courses; };
  h.apply(remote, empty); h.persist();
  const read = () => ({ ...collectLocalCloudData(h.storage, h.scope.identity.defaultHandicap, true), deviceId: "fixture-device" });
  return { ...h, remote, read };
}

test("actual empty-browser apply → editor persist → read → sync gate needs zero uploads", async () => {
  const h = setup(); const gate = new CloudSyncGate(); let gets = 0, posts = 0, retry = 0;
  const fingerprint = cloudSyncPayloadFingerprint(h.read()); assert.equal(gate.begin(fingerprint, "mount"), "run");
  assert.deepEqual(cloudSyncUploadReasons(h.read(), h.remote), []);
  assert.equal(cloudSyncUploadRequired(h.read(), h.remote), false);
  const ok = await runCloudSyncCycle({ read: h.read, download: async () => { gets++; return h.remote; }, upload: async () => { posts++; throw new Error("Unexpected hydration POST"); },
    shouldUpload: cloudSyncUploadRequired, media: async () => {}, apply: data => { h.apply(data, h.read()); h.persist(); }, current: () => true, status() {}, retry: () => { retry++; } });
  assert.equal(ok, true); gate.success(cloudSyncPayloadFingerprint(h.read()));
  assert.equal(gate.begin(cloudSyncPayloadFingerprint(h.read()), "local"), "unchanged");
  assert.deepEqual({ gets, posts, retry }, { gets: 1, posts: 0, retry: 0 });
});

test("profile/Index loading stays a presentation projection, preserving frequent identity/usage/order/clocks", () => {
  const h = setup(), original = structuredClone(h.remote.frequentPlayers);
  for (const index of [{ source: null, value: null }, { source: "BACKYARD", value: 5.5 }, { source: "GHIN", value: 30.8 }] as const) {
    const displayed = projectAccountPrimaryFrequentPlayers(h.remote.frequentPlayers, h.scope.identity, index);
    assert.equal(displayed[0].handicap, index.value); assert.equal(displayed[0].memberId, "owner-member");
    h.persist(); assert.deepEqual(h.read().frequentPlayers, original); assert.deepEqual(cloudSyncUploadReasons(h.read(), h.remote), []);
  }
  assert.deepEqual(projectAccountPrimaryFrequentPlayers([], h.scope.identity, { source: "GHIN", value: 30.8 }), [], "reading a profile cannot create a template");
});

test("QA24-style hydration preserves H1=5/6, frozen CH5/12, derives H2 and leaves canonical draft revision intact", () => {
  const h = setup(); const after = h.read().activeDraft as any;
  assert.deepEqual(after, h.fixture); assert.equal(h.scope.currentIndex, 1); assert.equal(after.scores[1][after.players[0].id], 5); assert.equal(after.scores[1][after.players[1].id], 6);
  assert.deepEqual(after.players.map((p: any) => p.handicap), [5, 12]);
  assert.equal(h.read().activeDraftUpdatedAt, at); assert.equal(JSON.parse(h.storage.getItem(CLOUD_LOCAL_META_KEY)!).draftAt, at);
  h.scope.currentIndex = 8; h.persist(); assert.equal(h.read().activeDraftUpdatedAt, at); assert.deepEqual(cloudSyncUploadReasons(h.read(), h.remote), []);
});

test("completed history display normalization never rewrites stored history or updatedAt", () => {
  const h = setup(); assert.deepEqual(h.read().history, h.remote.history);
  h.scope.history = h.scope.history.map((r: any) => ({ ...r, updatedAt: "2026-10-02T00:00:00Z" })); h.persist();
  assert.deepEqual(h.read().history, h.remote.history); assert.deepEqual(cloudUploadDelta(h.read(), h.remote).history, []);
});

test("timestamp-only history changes cannot create an upload/version on a different installation", () => {
  const h = setup(); const local = { ...h.remote, deviceId: "other-device", history: h.remote.history.map(r => ({ ...r, updatedAt: "2026-10-02T00:00:00Z" })) };
  assert.deepEqual(cloudUploadDelta(local, h.remote).history, []); assert.equal(cloudSyncUploadRequired(local, h.remote), false);
  local.history[0] = { ...local.history[0], scores: { 1: { "account:qa-owner": 6 } } };
  assert.equal(cloudSyncUploadRequired(local, h.remote), true); assert.equal(cloudUploadDelta(local, h.remote).history.length, 1);
});

test("a real local hole edit still becomes dirty and uploads only its draft delta", async () => {
  const h = setup(); h.scope.scores = { ...h.scope.scores, 2: { "account:qa-owner": 4, "qa-guest": 5 } }; h.persist();
  assert.equal(cloudSyncUploadRequired(h.read(), h.remote), true); assert.ok(cloudSyncUploadReasons(h.read(), h.remote).includes("activeDraft"));
  let posts = 0; const ok = await runCloudSyncCycle({ read: h.read, download: async () => h.remote, shouldUpload: cloudSyncUploadRequired,
    upload: async data => { posts++; assert.deepEqual(cloudUploadDelta(data, h.remote).history, []); return { data: mergeLocalAndCloud(data, h.remote) }; },
    media: async () => {}, apply: data => { h.apply(data, h.read()); h.persist(); }, current: () => true, status() {} });
  assert.equal(ok, true); assert.equal(posts, 1); assert.equal((h.read().activeDraft as any).scores[2]["account:qa-owner"], 4);
});

test("true material history editing preserves ID, score change and the new revision", () => {
  const h = setup(); h.scope.history = h.scope.history.map((r: any) => ({ ...r, updatedAt: "2026-10-02T00:00:00Z", scores: { 1: { "account:qa-owner": 6 } } })); h.persist();
  assert.equal(cloudSyncUploadRequired(h.read(), h.remote), true); assert.equal(h.read().history[0].updatedAt, "2026-10-02T00:00:00Z");
  assert.equal(h.read().history[0].scores![1]["account:qa-owner"], 6);
});

test("same-field remote concurrent edit still produces an actionable field conflict; retries remain bounded", () => {
  const h = setup(); h.scope.scores = { 1: { "account:qa-owner": 4, "qa-guest": 6 } }; h.persist();
  const remote = { ...h.remote, deviceId: "other-device", activeDraftUpdatedAt: "2026-10-02T00:00:00Z", activeDraft: { ...h.fixture, scores: { 1: { "account:qa-owner": 3, "qa-guest": 6 } } } };
  const conflicts = findAmbiguousCloudConflicts(h.read(), remote); assert.ok(conflicts.some(c => c.fieldPath === "/scores/1/account:qa-owner"));
  const budget = new CloudRetryBudget(); assert.equal(budget.failure(0), 5000); assert.equal(budget.failure(5000), 10000); assert.equal(budget.failure(15000), null); assert.equal(budget.allow("retry", 1e9), false);
});

test("the actual server write still rejects a genuine concurrent score edit with CLOUD_FIELD_CONFLICT", async () => {
  const h = setup(); h.scope.scores = { 1: { "account:qa-owner": 4, "qa-guest": 6 } }; h.persist();
  const db = new CloudDb(); db.rows("user_cloud_state").push({ user_id: "qa-owner", active_draft: { ...h.fixture, scores: { 1: { "account:qa-owner": 3, "qa-guest": 6 } } }, updated_at: "2026-10-02T00:00:00Z", updated_by_device: "other-device" });
  await assert.rejects(writeCloudBundle(db.client, "qa-owner", { data: h.read(), fingerprint: cloudSyncPayloadFingerprint(h.read()) }),
    (error: any) => error.code === "CLOUD_FIELD_CONFLICT");
  assert.equal((db.rows("user_cloud_state")[0].active_draft as any).scores[1]["account:qa-owner"], 3);
});

test("draft/groups normalization is idempotent and independent of the clock", () => {
  const h = setup(); const first = normalizeRoundDraft(h.fixture, h.fixture.ownerId); assert.deepEqual(normalizeRoundDraft(first, h.fixture.ownerId), first);
  const group = h.remote.frequentGroups; assert.deepEqual(parseFrequentGroups(JSON.stringify(parseFrequentGroups(JSON.stringify(group)))), group);
  const view = h.scope.roundDraftHydrationView(h.fixture, h.fixture.course, h.scope.resolveRoundDraftCore(h.fixture, "qa-owner"));
  assert.deepEqual(h.scope.roundDraftHydrationView(view, h.fixture.course, h.scope.resolveRoundDraftCore(view, "qa-owner")), view);
});

test("canonical fields omitted by the editor survive hydration and a later score mutation", () => {
  const h = setup(), canonical = { ...h.fixture, version: 12, serverRevision: 7, updatedAt: at, scorekeeping: { version: 1, mode: "owner", organizerAccountUserId: "qa-owner" } };
  h.apply({ ...h.remote, activeDraft: canonical }, h.read()); h.persist();
  assert.deepEqual(h.read().activeDraft, canonical);
  h.scope.scores = { ...h.scope.scores, 2: { "account:qa-owner": 4 } }; h.persist(); const after = h.read().activeDraft as any;
  assert.equal(after.version, 12); assert.equal(after.serverRevision, 7); assert.deepEqual(after.scorekeeping, canonical.scorekeeping);
  assert.equal(h.scope.exports.persistCommittedHoleBeforeAdvance({ ...after.scores, 3: { "account:qa-owner": 5 } }, {}, h.scope.bets, 2), true);
  const checkpoint = h.read().activeDraft as any;
  assert.equal(checkpoint.version, 12); assert.equal(checkpoint.serverRevision, 7); assert.deepEqual(checkpoint.scorekeeping, canonical.scorekeeping);
  assert.equal(checkpoint.scores[3]["account:qa-owner"], 5);
});

test("unstarted draft hydration and asynchronous profile Index loading stay clean; explicit start uses the current provider", () => {
  const h = setup(draft => ({ ...draft, startedAt: null, lifecycleState: "draft", scores: {}, scoreEdits: {}, players: draft.players.map((p: any) => ({ ...p, courseHandicapSnapshot: undefined })) }));
  const { remote } = h; const draft = remote.activeDraft;
  for (const index of [{ source: null, value: null }, { source: "BACKYARD", value: 5.5 }, { source: "GHIN", value: 30.8 }] as const) {
    h.scope.accountIndex = index;
    h.scope.exports.teeEffect(); h.scope.exports.handicapEffect(); h.persist();
    assert.deepEqual(h.read().activeDraft, draft); assert.deepEqual(cloudSyncUploadReasons(h.read(), remote), []);
  }
  const startedPlayers = h.scope.exports.playersForRoundStart();
  const preflightPlayers = h.scope.exports.setupPlayers();
  assert.equal(preflightPlayers[0].handicapIndex, 30.8, "preflight reads the same current provider without writing a draft");
  assert.deepEqual(cloudSyncUploadReasons(h.read(), remote), []);
  assert.equal(startedPlayers[0].handicapIndex, 30.8); assert.equal(startedPlayers[0].courseHandicapSnapshot.index, 30.8);
  assert.equal(startedPlayers[0].handicapIndexSource, "GHIN_OFFICIAL_FUTURE");
  h.scope.players = startedPlayers; h.scope.roundStartedAt = "2026-10-02T12:00:00Z"; h.persist();
  assert.equal(cloudSyncUploadRequired(h.read(), remote), true); assert.equal((h.read().activeDraft as any).players[0].handicapIndex, 30.8);
  h.scope.accountIndex = { source: "GHIN", value: 15 };
  assert.deepEqual(h.scope.exports.playersForRoundStart(), startedPlayers, "an already started snapshot stays frozen");
});

test("boundary reset cannot carry another account or round's canonical data into a new edit", () => {
  const boundary = new CloudHydrationBoundary(); boundary.rememberDraft({ roundId: "one", secretOwnerField: "qa" }, { roundId: "one" });
  assert.deepEqual(boundary.projectDraft({ roundId: "two", scores: {} }), { roundId: "two", scores: {} }); boundary.clear();
  assert.deepEqual(boundary.projectDraft({ roundId: "one" }), { roundId: "one" });
});

test("profile default handicap updates cannot rerun workspace recovery or mutate a completed timestamp", () => {
  const source = readFileSync("app/page.tsx", "utf8"); const start = source.indexOf("    const hydrate = async () =>"); const end = source.indexOf("// Local navigation", start);
  assert.match(source.slice(start, end), /liveIdentity\.current\.defaultHandicap/);
  assert.doesNotMatch(source.slice(start, end).match(/\}, \[([^\]]+)\]\);/)![1], /defaultHandicap/);
  assert.doesNotMatch(source, /setFrequentPlayers\(\(current\) => syncAccountPrimaryFrequentPlayer/);
  assert.doesNotMatch(source, /setPlayers\(\(current\) => syncLinkedRoundPlayerName/);
});

test("UI normalization does not acknowledge a pending local edit as persisted", () => {
  const h = setup(); h.scope.scores = { ...h.scope.scores, 2: { "account:qa-owner": 4 } }; h.persist();
  const pending = h.read(), baseBefore = JSON.parse(h.storage.getItem(CLOUD_LOCAL_META_KEY)!).cloudDraftFingerprint;
  h.apply(mergeLocalAndCloud(pending, h.remote), pending); h.persist();
  assert.equal(JSON.parse(h.storage.getItem(CLOUD_LOCAL_META_KEY)!).cloudDraftFingerprint, baseBefore);
  assert.equal(cloudSyncUploadRequired(h.read(), h.remote), true);
});

test("legacy missing defaults/tee assignments normalize for display without becoming new canonical fields", () => {
  const h = setup(); const legacy = { ...h.fixture, version: 9 };
  for (const key of ["presentation", "playerTeeAssignments", "counterBetKeepers", "segments", "advancedStats", "expenses"]) delete legacy[key];
  const remote = { ...h.remote, activeDraft: legacy };
  h.apply(remote, collectLocalCloudData(h.storage, null, false)); h.persist();
  assert.deepEqual(h.read().activeDraft, legacy); assert.deepEqual(cloudSyncUploadReasons(h.read(), remote), []);
  const once = structuredClone(h.scope.playerTeeAssignments); h.apply(remote, h.read()); h.persist();
  assert.deepEqual(h.scope.playerTeeAssignments, once); assert.deepEqual(h.read().activeDraft, legacy);
});
