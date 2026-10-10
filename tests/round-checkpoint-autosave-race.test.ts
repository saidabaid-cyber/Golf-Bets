import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { CloudHydrationBoundary } from "../lib/cloud-hydration";
import { RoundDraftTabBoundary } from "../lib/round-draft-tab-boundary";
import { persistRoundDraftCheckpoint } from "../lib/round-review";
import { STORAGE_KEYS } from "../lib/round-utils";
import { CLOUD_LOCAL_META_KEY, cloudDraftApplyPlan, cloudSyncPayloadFingerprint, collectLocalCloudData, mergeLocalAndCloud, persistCloudMetadata, restoreLocalRoundUi, type CloudDataBundle } from "../lib/cloud-sync";

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
  const boundary = new RoundDraftTabBoundary(); boundary.remember(staleDraft);
  const exports: Record<string, unknown> = {};
  const noOp = () => undefined;
  runInNewContext(source, { exports, STORAGE_KEYS, localStorage: storage, window: { localStorage: storage },
    localPersistRevision: revision, flushLocalState: flush, cloudHydrationBoundary: { current: new CloudHydrationBoundary() }, localDraftTabBoundary: { current: boundary },
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
    cloudHydrationBoundary: { current: new CloudHydrationBoundary() }, localDraftTabBoundary: { current: new RoundDraftTabBoundary() }, useCallback: (callback: unknown) => callback, mergeLocalAndCloud: () => reconciled,
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

test("applying a merged in-flight checkpoint preserves the actual server base for the next cycle", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const start = page.indexOf("  const applyCloudBundle = useCallback(");
  const end = page.indexOf("\n  useEffect(() =>", start);
  assert.ok(start > 0 && end > start);
  const source = ts.transpileModule(`${page.slice(start, end)}\nexports.apply = applyCloudBundle;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const before = { roundId: "qa-in-flight", scores: { 1: { qa: 4 } }, scoreEdits: { 2: { qa: 4 }, 3: { qa: 4 } } };
  const acknowledged = { roundId: "qa-in-flight", scores: { 1: { qa: 4 }, 2: { qa: 4 } }, scoreEdits: { 3: { qa: 4 } } };
  const newerLocal = { roundId: "qa-in-flight", scores: { 1: { qa: 4 }, 2: { qa: 4 }, 3: { qa: 4 } }, scoreEdits: {} };
  const bundle = (draft: unknown, at: string): CloudDataBundle => ({ version: 1, deviceId: "qa-device", courses: [], history: [], rivals: [], frequentPlayers: [], frequentGroups: [], tombstones: [],
    preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null }, activeDraft: draft, activeDraftUpdatedAt: at });
  const local = { ...bundle(newerLocal, "2026-10-03T03:09:25Z"), baseDraft: before, baseDraftFingerprint: JSON.stringify(before), baseDraftUpdatedAt: "2026-10-03T03:09:20Z" };
  const server = bundle(acknowledged, "2026-10-03T03:09:24Z");
  // Hole 3 was confirmed while the server was processing the upload of hole 2.
  const inFlightMerge = mergeLocalAndCloud(local, server);
  assert.deepEqual(inFlightMerge.activeDraft, newerLocal);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const noOp = () => undefined;
  const exports: Record<string, unknown> = {};
  runInNewContext(source, { exports, STORAGE_KEYS, localStorage: storage,
    localPersistRevision: { current: 0 }, flushLocalState: { current: noOp }, cloudHydrationBoundary: { current: new CloudHydrationBoundary() }, localDraftTabBoundary: { current: new RoundDraftTabBoundary() }, useCallback: (callback: unknown) => callback,
    mergeLocalAndCloud, stableValue: (value: unknown) => value, cloudDraftApplyPlan, preserveDraftConflict: noOp, setFeedback: noOp, applyDraft: noOp,
    mergeDefaultCourses: (courses: unknown) => courses, normalizeHistorySnapshot: (item: unknown) => item,
    setCourses: noOp, setHistory: noOp, setSavedPersonalRivals: noOp, setFrequentPlayers: noOp, setFrequentGroups: noOp,
    setHighContrast: noOp, applyCloudPreferences: noOp, serializeFrequentGroups: JSON.stringify, restoreLocalRoundUi,
    currentIndexRef: { current: 2 }, CLOUD_TOMBSTONES_KEY: "qa-tombstones", persistCloudMetadata,
    hadLocalPreferences: { current: true }, offlineDeviceId: { current: "qa-device" }, collectLocalCloudData, cloudSyncPayloadFingerprint,
  });
  (exports.apply as (...args: unknown[]) => unknown)(inFlightMerge, local);
  const metadata = JSON.parse(storage.getItem(CLOUD_LOCAL_META_KEY)!);
  assert.deepEqual(JSON.parse(metadata.cloudDraftFingerprint), acknowledged, "a local merge is not a server acknowledgment");
  const nextLocal = { ...local, activeDraft: JSON.parse(storage.getItem(STORAGE_KEYS.draft)!), baseDraft: JSON.parse(metadata.cloudDraftFingerprint), baseDraftFingerprint: metadata.cloudDraftFingerprint };
  const nextCycle = mergeLocalAndCloud(nextLocal, server);
  assert.deepEqual(nextCycle.activeDraft, newerLocal, "the next GET cannot resurrect the pending edit or drop confirmed hole 3");
});

test("the autosave installer captures its render revision before a confirmed click", () => {
  const page = readFileSync("app/page.tsx", "utf8").replaceAll("\r\n", "\n");
  const bodyStart = page.indexOf('    if (!hydrated || hydratedWorkspaceOwner !== identity.userId) return;\n    setSaveStatus("saving");');
  const start = page.lastIndexOf("  use", bodyStart);
  const end = page.indexOf("\n\n  useEffect(() =>", bodyStart);
  const effect = page.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const source = ts.transpileModule(effect, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const oldScores = { 1: { qa: 4 } };
  const confirmedScores = { ...oldScores, 2: { qa: 5 } };
  const revision = { current: 0 };
  let delayedInstaller: (() => void) | undefined;
  let delayedAutosave: (() => unknown) | undefined;
  const noOp = () => undefined;
  const names = ["course", "courseSelected", "pendingCourseIdentity", "playerTeeAssignments", "startHole", "roundHoles", "roundHandicapBasis", "roundPresentation", "players", "ownerId", "bets", "segments", "personalBets", "supplementalBets", "manualBets", "scorecardPhotoIds", "putts", "scoreCaptureMode", "advancedStats", "shots", "unitEvents", "counterBetEvents", "counterBetKeepers", "lobaHoles", "ballFriendSetup", "expenses", "roundId", "roundDate", "roundStartedAt", "roundTemplateOrigin", "currentIndex", "courses", "favoriteCourseIds", "recentCourseIds", "history", "savedPersonalRivals", "frequentPlayers", "frequentGroups", "highContrast", "notificationsEnabled", "roundReviewPending"];
  runInNewContext(source, { ...Object.fromEntries(names.map(name => [name, null])),
    useEffect: (install: () => void) => { delayedInstaller = install; },
    useLayoutEffect: (install: () => void) => install(),
    window: { setTimeout: (save: () => unknown) => { delayedAutosave = save; return 1; }, clearTimeout: noOp },
    localStorage: storage, STORAGE_KEYS, hydrated: true, hydratedWorkspaceOwner: "qa-owner", roundClosed: false,
    scores: oldScores, scoreEdits: { 2: { qa: 5 } }, identity: { userId: "qa-owner", defaultHandicap: null },
    localPersistRevision: revision, flushLocalState: { current: noOp }, applyDraft: noOp,
    accountDeletionMarkerKey: () => "qa-marker", ownsLocalWorkspace: () => true,
    withDerivedRoundLifecycle: (draft: unknown) => draft, normalizeRoundPresentation: (value: unknown) => value,
    trackLocalCloudEdits: noOp, serializeFrequentGroups: JSON.stringify,
    coursePreferenceStorageKey: (key: string) => key, hasRoundProgress: () => true,
    setSaveStatus: noOp, setDraftAvailable: noOp, collectLocalCloudData: () => ({}),
    hadLocalPreferences: { current: true }, offlineDeviceId: { current: "qa-device" },
    cloudLinked: true, persistOfflineBundle: async () => undefined,
  });
  // React can delay passive effects until after a click writes the durable
  // checkpoint. A layout effect must already have captured the older revision.
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ scores: confirmedScores, scoreEdits: {} }));
  revision.current += 1;
  delayedInstaller?.();
  assert.ok(delayedAutosave);
  assert.equal(delayedAutosave(), false);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.draft)!).scores, confirmedScores);
});
