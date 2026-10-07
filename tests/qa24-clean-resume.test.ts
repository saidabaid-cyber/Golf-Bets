import test from "node:test";
import assert from "node:assert/strict";
import { pageHydrationHarness } from "./helpers/page-hydration";
import { collectLocalCloudData, cloudSyncUploadReasons } from "../lib/cloud-sync";
import { STORAGE_KEYS } from "../lib/round-utils";
import { ownerRoundCaptureMaterial, ownerRoundSyncFingerprint, ownerRoundTransportPayload, syncOwnerRound } from "../lib/owner-round-sync";
import { preserveUnfinishedRound } from "../lib/unfinished-round";
import type { RoundSnapshot } from "../lib/types";

/** Actual page apply/read/navigation/snapshot callbacks; only platform and
 * settlement outputs are fixture boundaries. No real account or requests. */
function setup(id: string) {
  const h = pageHydrationHarness();
  const draft = { ...h.fixture, roundId: id };
  const remote = { version: 1 as const, history: [], courses: h.scope.mergeDefaultCourses([draft.course]),
    rivals: [], frequentPlayers: [], frequentGroups: [], tombstones: [], activeDraft: draft,
    activeDraftUpdatedAt: "2026-10-01T10:00:00.000Z",
    preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null, hasLocalState: true } };
  h.apply(remote, collectLocalCloudData(h.storage, null, false));
  const snapshot = () => {
    // Snapshot builder receives the same deterministic settlement read model
    // before parking and after hydration. These outputs are NOT capture inputs.
    Object.assign(h.scope, { owner: h.scope.players[0], order: Array.from({ length: 18 }, (_, i) => i + 1),
      ownerClubChoices: [], ownerBetResult: 0, ownerExpenseTotal: 0, ownerNet: 0, categoryResults: {},
      allBetBalances: {}, rabbitBalances: {}, skinBalances: {}, pollaFirstBalances: {}, pollaSecondBalances: {},
      pollaNassauBalances: {}, miniPollaComponentBalances: {}, personalCombinedBalances: {},
      supplementalGeneralResults: [], personalOpponentResults: [], settlementTransfers: [], settlementDifference: 0,
    });
    for (const key of ["rabbits", "skins", "units", "monkey", "foursomes", "ballFriend", "polla", "miniPolla", "vipers", "camels", "fish", "loba", "supplemental", "personals", "manual"])
      h.scope[key] = { balances: {}, results: [] };
    return h.scope.exports.currentSnapshot() as RoundSnapshot;
  };
  return { ...h, remote, snapshot, read: () => collectLocalCloudData(h.storage, null, true) };
}

test("cold canonical H1=5/6 hydration stores its derived H2 cursor before any render/timer", () => {
  const h = setup("cold-resume-atomic");
  assert.equal(h.scope.currentIndex, 1);
  const stored = JSON.parse(h.storage.getItem(STORAGE_KEYS.draft)!);
  assert.equal(stored.currentIndex, 1, "canonical apply must durably store the recovered cursor, not lose it until autosave");
  // Recovery can happen before a passive effect or autosave fires.
  h.scope.exports.applyDraft(stored);
  assert.equal(h.scope.currentIndex, 1);
  assert.deepEqual(stored.scores[1], { "account:qa-owner": 5, "qa-guest": 6 });
  assert.deepEqual(cloudSyncUploadReasons(h.read(), h.remote), []);
});

test("fresh hydration → resume H2 → parked-owner reconciliation → Home stays H2 without a write/retry", async () => {
  const h = setup("qa24-reconciliation");
  const capture = h.snapshot();
  const canonical = preserveUnfinishedRound(capture, 1, "live");
  canonical.resumeCourseSelected = true;
  const calls: string[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push(init?.method || "GET");
    if (init?.method) throw new Error("An unchanged clean session must not write");
    return Response.json({ data: { id: "fixture-canonical", version: 5,
      ...(String(url).includes("metadata=1") ? {} : { snapshot: canonical }) } });
  };
  Object.assign(h.scope, { globalRoundAvailable: true, betConfigurationIssues: [], completedHoles: new Set([1]), pendingCourseIdentity: null });
  h.scope.window.scrollTo = () => {};
  h.scope.flushLocalState.current = () => true;
  h.scope.exports.resumeActiveRound();
  assert.equal(h.scope.tab, "round"); assert.equal(h.scope.currentIndex, 1);
  const result = await syncOwnerRound(ownerRoundTransportPayload(h.snapshot()), "qa-owner", "fixture-token", h.storage, () => true, request);
  assert.equal(result.unchanged, true);
  h.scope.setTab("welcome"); // actual capture exit uses this plus flush
  const summary = h.scope.exports.activeRoundSummary();
  assert.equal(summary.currentHole, 2); assert.equal(summary.playedHoles, 1);
  assert.deepEqual(h.scope.scores[1], { "account:qa-owner": 5, "qa-guest": 6 });
  assert.equal(h.scope.scores[2], undefined);
  await syncOwnerRound(ownerRoundTransportPayload(h.snapshot()), "qa-owner", "fixture-token", h.storage, () => true, request);
  assert.deepEqual(calls, ["GET", "GET"], "unchanged remount uses its canonical ACK");
});

test("same-round canonical refresh preserves an explicit local H1 review cursor without dirty cloud data", () => {
  const h = setup("local-review"); h.persist();
  h.scope.currentIndex = 0; h.scope.currentIndexRef.current = 0; h.persist();
  const refreshed = { ...h.remote, activeDraft: { ...h.remote.activeDraft, serverRevision: 8 } };
  h.apply(refreshed, h.read());
  assert.equal(h.scope.currentIndex, 0);
  assert.equal(JSON.parse(h.storage.getItem(STORAGE_KEYS.draft)!).currentIndex, 0);
  assert.deepEqual(cloudSyncUploadReasons(h.read(), refreshed), []);
});

test("resume derives the pending hole for any round order, without borrowing another round's cursor", () => {
  const h = setup("previous-round");
  const draft = { ...h.remote.activeDraft, roundId: "next-round", startHole: 10, scores: {
    10: { "account:qa-owner": 5, "qa-guest": 6 }, 11: { "account:qa-owner": 4, "qa-guest": 5 },
  } };
  h.apply({ ...h.remote, activeDraft: draft }, collectLocalCloudData({ getItem: () => null }, null, false));
  assert.equal(h.scope.currentIndex, 2);
  assert.equal(JSON.parse(h.storage.getItem(STORAGE_KEYS.draft)!).currentIndex, 2);
  assert.equal(h.scope.roundResumeContext.roundId, "next-round");
});

test("UI/parking/settlement divergence is nonmaterial, while scores, players, frozen HCP, tees and bets remain material", async () => {
  const h = setup("material-base"); const live = JSON.parse(ownerRoundTransportPayload(h.snapshot()));
  const parked = preserveUnfinishedRound(live, 0, "live"); parked.resumeCourseSelected = true;
  const withUi = { ...parked, currentIndex: 0, openModal: "local-review" };
  assert.equal(ownerRoundCaptureMaterial(live), ownerRoundCaptureMaterial(withUi));
  assert.equal(ownerRoundSyncFingerprint(ownerRoundTransportPayload(live)), ownerRoundSyncFingerprint(ownerRoundTransportPayload(withUi)));
  let seq = 0;
  for (const change of [
    { scores: { 1: { "account:qa-owner": 4, "qa-guest": 6 } } },
    { players: live.players.map((p: any, i: number) => i ? { ...p, handicap: 13 } : p) },
    { playerTeeAssignments: [] }, { teeName: "Another tee" },
    { courseSnapshot: { ...live.courseSnapshot, slopeRating: 138 } },
    { betConfig: { ...live.betConfig, skins: { ...live.betConfig.skins, enabled: true } } },
    { putts: { 1: { "account:qa-owner": 3 } } }, { shots: [{ id: "new-shot", roundId: live.id,
      playerId: "account:qa-owner", hole: 1, sequence: 1, clubLabel: "Driver", clubSnapshot: { label: "Driver" },
      source: "MANUAL" as const, startedAt: "2026-10-01T10:01:00.000Z" }] },
    { expenses: { ...live.expenses, greenFee: 100 } }, { additiveCapture: { confirmed: true } },
  ]) {
    const id = `material-conflict-${seq++}`;
    const local = { ...live, id }; const remote = { ...parked, ...change, id };
    const localBefore = structuredClone(local), remoteBefore = structuredClone(remote);
    assert.notEqual(ownerRoundCaptureMaterial(local), ownerRoundCaptureMaterial(remote));
    const values = new Map<string, string>(); let writes = 0;
    await assert.rejects(syncOwnerRound(ownerRoundTransportPayload(local), "qa-owner", "fixture-token",
      { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }, () => true,
      async (url, init) => {
        if (init?.method) { writes++; throw new Error("Conflicting captures cannot write"); }
        return Response.json({ data: { id: "fixture-canonical", version: 5,
          ...(String(url).includes("metadata=1") ? {} : { snapshot: remote }) } });
      }), /La tarjeta de nube cambió/);
    assert.equal(writes, 0); assert.equal(values.size, 0);
    assert.deepEqual(local, localBefore); assert.deepEqual(remote, remoteBefore);
  }
});
