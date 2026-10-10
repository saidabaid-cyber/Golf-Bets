import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { CloudHydrationBoundary } from "../lib/cloud-hydration";
import { RoundDraftTabBoundary } from "../lib/round-draft-tab-boundary";
import { STORAGE_KEYS, readStoredJson } from "../lib/round-utils";

const card = { roundId: "r", scores: { 1: { a: 4, b: 5 } }, scoreEdits: {}, currentIndex: 0 };

test("a stale tab adopts a different active card without resurrecting its old one", () => {
  const boundary = new RoundDraftTabBoundary(); boundary.remember(card);
  const incoming = { ...card, roundId: "new-card", scores: {} };
  assert.equal(boundary.isCurrent(incoming), false);
  assert.deepEqual(boundary.reconcile(card, incoming), { draft: incoming, preserveLocal: false });
  assert.deepEqual(boundary.reconcile(card, null), { draft: null, preserveLocal: false });
});

test("different-card pending edits are retained for recovery, never merged into the new card", () => {
  const boundary = new RoundDraftTabBoundary(); boundary.remember(card);
  const local = { ...card, scoreEdits: { 2: { a: 7 } } };
  const incoming = { roundId: "new-card", scores: { 1: { a: 3 } } };
  assert.deepEqual(boundary.reconcile(local, incoming), { draft: incoming, preserveLocal: true });
});

test("same-card saved scores and disjoint pending edits are merged against the actual tab baseline", () => {
  const boundary = new RoundDraftTabBoundary(); boundary.remember(card);
  const local = { ...card, scoreEdits: { 2: { a: 7 } } };
  const incoming = { ...card, scores: { 1: { a: 4, b: 5 }, 2: { b: 6 } } };
  const result = boundary.reconcile(local, incoming);
  assert.equal(result.preserveLocal, false);
  assert.deepEqual((result.draft as typeof incoming).scores, incoming.scores);
  assert.deepEqual((result.draft as typeof local).scoreEdits, local.scoreEdits);
});

test("divergent edits to the same cell require preservation rather than silent replacement", () => {
  const boundary = new RoundDraftTabBoundary(); boundary.remember(card);
  const local = { ...card, scores: { 1: { a: 6, b: 5 } } };
  const incoming = { ...card, scores: { 1: { a: 7, b: 5 } } };
  assert.equal(boundary.reconcile(local, incoming).preserveLocal, true);
});

test("navigation changes and key order do not claim a new score revision", () => {
  const boundary = new RoundDraftTabBoundary(); boundary.remember(card);
  assert.equal(boundary.isCurrent({ currentIndex: 5, scoreEdits: {}, scores: { 1: { b: 5, a: 4 } }, roundId: "r" }), true);
});

test("the actual page autosave fences a stale tab before any writes and archives its pending capture", () => {
  const source = ts.createSourceFile("page.tsx", readFileSync("app/page.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let action: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "persist" && node.initializer?.getText(source).includes("localDraftTabBoundary")) action = node.initializer;
    if (!action) ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(action);
  const js = ts.transpileModule(`exports.persist = ${action.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const incoming = { ...card, roundId: "new-card", scores: { 1: { a: 3 } } };
  const boundary = new RoundDraftTabBoundary(); boundary.remember(card);
  const storage = { getItem: (key: string) => key === STORAGE_KEYS.draft ? JSON.stringify(incoming) : null, setItem: () => assert.fail("stale autosave must not write") };
  const archived: unknown[] = []; let applied: unknown; const exported: any = {};
  const context: Record<string, unknown> = {
    exports: exported, revision: 0, localPersistRevision: { current: 0 },
    identity: { userId: "qa-a" }, localStorage: storage, STORAGE_KEYS, readStoredJson,
    ownsLocalWorkspace: () => true, accountDeletionMarkerKey: () => "deletion",
    withDerivedRoundLifecycle: (value: unknown) => value, normalizeRoundPresentation: (value: unknown) => value,
    hadLocalPreferences: { current: true }, collectLocalCloudData: () => ({}), cloudSyncPayloadFingerprint: () => "old",
    hasRoundToPreserve: () => true, cloudHydrationBoundary: { current: new CloudHydrationBoundary() },
    localDraftTabBoundary: { current: boundary }, flushLocalState: { current: null },
    preserveDraftConflict: (_storage: unknown, draft: unknown) => { archived.push(draft); return true; }, setFeedback() {},
    applyDraft: (draft: unknown) => { applied = draft; }, setSaveStatus: () => assert.fail("unexpected persistence error"),
    roundClosed: false, courseSelected: true, pendingCourseIdentity: null, roundId: card.roundId, scores: card.scores, scoreEdits: { 2: { a: 7 } },
  };
  for (const name of ["course", "playerTeeAssignments", "startHole", "roundHoles", "roundHandicapBasis", "roundPresentation", "players", "ownerId", "bets", "segments", "personalBets", "supplementalBets", "manualBets", "putts", "scorecardPhotoIds", "scoreCaptureMode", "advancedStats", "shots", "unitEvents", "counterBetEvents", "counterBetKeepers", "lobaHoles", "ballFriendSetup", "expenses", "roundDate", "roundStartedAt", "currentIndex", "roundReviewPending", "roundTemplateOrigin"]) context[name] = undefined;
  runInNewContext(js, context);
  assert.equal(exported.persist(), false);
  assert.deepEqual(applied, incoming);
  assert.equal(archived.length, 2);
  assert.deepEqual((archived[0] as typeof card & { scoreEdits: unknown }).scoreEdits, { 2: { a: 7 } });
  assert.deepEqual(archived[1], incoming);
  assert.equal(boundary.isCurrent(incoming), true);

  boundary.remember(card); applied = undefined; let status = "";
  context.localPersistRevision = { current: 0 };
  context.preserveDraftConflict = () => false;
  context.setSaveStatus = (value: string) => { status = value; };
  runInNewContext(js, context);
  assert.equal(exported.persist(), false);
  assert.equal(applied, undefined, "a failed archive cannot discard pending capture by applying the other card");
  assert.equal(status, "error");
  assert.equal(boundary.isCurrent(incoming), false);
});
