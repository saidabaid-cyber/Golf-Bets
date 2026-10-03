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
