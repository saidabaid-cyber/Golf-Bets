import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { persistRoundDraftCheckpoint } from "../lib/round-review";
import { STORAGE_KEYS } from "../lib/round-utils";

test("a confirmed hole fences the previous render's autosave before cloud readback", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const start = page.indexOf("  function persistCommittedHoleBeforeAdvance(");
  const end = page.indexOf("  function saveRound(", start);
  assert.ok(start > 0 && end > start);
  const source = ts.transpileModule(`${page.slice(start, end)}\nexports.persist = persistCommittedHoleBeforeAdvance;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const staleDraft = { roundId: "qa-checkpoint", scores: {}, scoreEdits: { 1: { qa: 4 } } };
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify(staleDraft));
  const revision = { current: 0 };
  const capturedRevision = revision.current;
  const staleAutosave = () => {
    if (capturedRevision !== revision.current) return false;
    storage.setItem(STORAGE_KEYS.draft, JSON.stringify(staleDraft));
    return true;
  };
  const flush = { current: staleAutosave };
  const exports: Record<string, unknown> = {};
  const noOp = () => undefined;
  runInNewContext(source, { exports, STORAGE_KEYS, localStorage: storage, window: { localStorage: storage },
    localPersistRevision: revision, flushLocalState: flush,
    identity: { userId: "qa-owner", mode: "authenticated", defaultHandicap: null },
    accountDeletionMarkerKey: () => "qa-deletion-marker",
    readStoredJson: (_store: unknown, key: string) => JSON.parse(storage.getItem(key) || "null"),
    roundDraftPayload: (overrides: object) => ({ roundId: "qa-checkpoint", ...overrides }),
    persistRoundDraftCheckpoint, trackLocalCloudCheckpoint: noOp,
    highContrast: true, notificationsEnabled: false, cloudLinked: true,
    setRoundReviewPending: noOp, setShowRoundFinishedNotice: noOp,
    setDraftAvailable: noOp, setSaveStatus: noOp, setFeedback: noOp,
    collectLocalCloudData: () => ({}), hadLocalPreferences: { current: true },
    offlineDeviceId: { current: "qa-device" }, persistOfflineBundle: async () => undefined,
    // Simulate the already-running sync reading before React's next effect.
    requestCloudSync: { current: () => { assert.equal(flush.current(), true); } },
  });
  const confirmed = { 1: { qa: 4 } };
  assert.equal((exports.persist as (...args: unknown[]) => boolean)(confirmed, {}, {}, 0), true);
  // A queued 250 ms callback from the previous render must not undo the checkpoint.
  assert.equal(staleAutosave(), false);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!).scores, confirmed);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!).scoreEdits, {});
});

test("cloud reconciliation fences a queued React autosave before the next render", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const start = page.indexOf("  const applyCloudBundle = useCallback(");
  const end = page.indexOf("\n  useEffect(() =>", start);
  assert.ok(start > 0 && end > start);
  const source = ts.transpileModule(`${page.slice(start, end)}\nexports.apply = applyCloudBundle;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const oldDraft = { roundId: "qa-cloud-checkpoint", scores: { 1: { qa: 4 } }, scoreEdits: { 2: { qa: 4 } } };
  const confirmedDraft = { roundId: "qa-cloud-checkpoint", scores: { 1: { qa: 4 }, 2: { qa: 4 } }, scoreEdits: {} };
  const revision = { current: 0 };
  const capturedRevision = revision.current;
  const staleAutosave = () => {
    if (capturedRevision !== revision.current) return false;
    storage.setItem(STORAGE_KEYS.draft, JSON.stringify(oldDraft));
    return true;
  };
  const flush = { current: staleAutosave };
  const preferences = { highContrast: true, defaultHandicap: null };
  const empty = { courses: [], history: [], rivals: [], frequentPlayers: [], frequentGroups: [], tombstones: [], preferences };
  const reconciled = { ...empty, activeDraft: confirmedDraft };
  const noOp = () => undefined;
  const exports: Record<string, unknown> = {};
  runInNewContext(source, { exports, STORAGE_KEYS, localStorage: storage,
    localPersistRevision: revision, flushLocalState: flush,
    useCallback: (callback: unknown) => callback, mergeLocalAndCloud: () => reconciled,
    stableValue: (value: unknown) => value,
    cloudDraftApplyPlan: () => ({ changed: true, preservePrevious: false }),
    preserveDraftConflict: noOp, setFeedback: noOp, applyDraft: noOp,
    mergeDefaultCourses: (courses: unknown) => courses, normalizeHistorySnapshot: (item: unknown) => item,
    setCourses: noOp, setHistory: noOp, setSavedPersonalRivals: noOp, setFrequentPlayers: noOp,
    setFrequentGroups: noOp, setHighContrast: noOp, applyCloudPreferences: noOp,
    serializeFrequentGroups: JSON.stringify, restoreLocalRoundUi: (draft: unknown) => draft,
    currentIndexRef: { current: 1 }, CLOUD_TOMBSTONES_KEY: "qa-tombstones", persistCloudMetadata: noOp,
    hadLocalPreferences: { current: true }, offlineDeviceId: { current: "qa-device" },
    collectLocalCloudData: () => ({ activeDraft: JSON.parse(storage.getItem(STORAGE_KEYS.draft)!) }),
    cloudSyncPayloadFingerprint: JSON.stringify,
  });
  (exports.apply as (...args: unknown[]) => unknown)(reconciled, { ...empty, activeDraft: oldDraft });
  // A sync read before React installs its next persistence effect must preserve
  // the reconciled scores, as must the already-queued 250 ms autosave callback.
  assert.equal(flush.current(), true);
  assert.equal(staleAutosave(), false);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!), confirmedDraft);
});
