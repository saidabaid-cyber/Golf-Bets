import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";
import { ACCOUNT_DELETION_MARKER_PREFIX, ACCOUNT_STORAGE_KEYS, accountDeletionMarkerKey } from "../lib/account-state";
import { settleAccountDeletionClient } from "../lib/account-deletion-client";
import { legalEvidenceStateKey, type LegalEnvironment } from "../lib/legal-evidence-client";

const source = readFileSync("app/components/account-provider.tsx", "utf8");
const parsed = ts.createSourceFile("account-provider.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualHandler(name: string, bindings: Record<string, unknown>) {
  let handler = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) handler = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(handler, name);
  const js = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings));
}
function fixture(failOffline = false, failWorkspace = false, fallbackOwner = "a") {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null };
  const legalEnvironments: LegalEnvironment[] = ["production", "preview", "development", "test"];
  for (const environment of legalEnvironments) {
    storage.setItem(legalEvidenceStateKey("account:a", environment), "a-evidence");
    storage.setItem(legalEvidenceStateKey("account:b", environment), "b-evidence");
  }
  let legalState: { actorKey: string } | null = { actorKey: "account:a" };
  const cloudProfileFallbackRef = { current: fallbackOwner ? { userId: fallbackOwner, profile: {} } : null };
  let pending = "";
  let authClears = 0;
  const scan = actualHandler("nextPendingLocalDeletionOwner", { ACCOUNT_DELETION_MARKER_PREFIX });
  const noop = () => {};
  const bindings = {
    localStorage: storage, sessionStorage: storage, ACCOUNT_STORAGE_KEYS, accountDeletionMarkerKey,
    activeUserId: { current: "a" }, ownsLocalWorkspace: () => true,
    cloudProfileFallbackRef,
    setPendingLocalDeletionOwner: (id: string) => { pending = id; },
    setIdentity: noop, setEquipmentOnboardingRequired: noop, setBetaOnboardingRequired: noop, setAccessRequested: noop,
    setCloudLinked: noop, setCloudStatus: noop, setLastCloudSync: noop, setCloudIssuesByDomain: noop, setShowMigration: noop,
    getSupabaseBrowser: () => ({ auth: {} }), clearDeletedAuthSessionForUser: async () => { authClears++; },
    profileWriteCoordinators: { current: new Map() }, readAllOfflineAccountRecords: async () => [],
    scorecardPhotoIdsForOwner: async () => [], selectAccountScorecardPhotoIds: () => [], deleteScorecardPhotos: async () => {},
    deleteOfflineAccountData: async () => { if (failOffline) throw Error("temporary offline store error"); },
    discardAccountWorkspace: () => failWorkspace
      ? { complete: false, failedSteps: ["ai_memory"] }
      : { complete: true, failedSteps: [] },
    discardAccountSessionState: noop, clearAccountDeletionIntent: noop, parseLegalAcceptances: () => [],
    clearLegalAcceptancesForUser: () => [], setAcceptances: noop, nextPendingLocalDeletionOwner: scan,
    legalEvidenceStateKey, legalEvidenceState: legalState, setLegalEvidenceState: (state: { actorKey: string } | null) => { legalState = state; },
    console: { warn: noop },
  };
  const purge = actualHandler("purgeDeletedAccountLocal", bindings) as (id: string, options?: object) => Promise<boolean>;
  return { storage, purge, scan, bindings, legalEnvironments, legalState: () => legalState, cloudProfileFallback: () => cloudProfileFallbackRef.current, pending: () => pending, authClears: () => authClears };
}

function assertOwnerScopedLegalCleanup(f: ReturnType<typeof fixture>) {
  for (const environment of f.legalEnvironments) {
    assert.equal(f.storage.getItem(legalEvidenceStateKey("account:a", environment)), null);
    assert.equal(f.storage.getItem(legalEvidenceStateKey("account:b", environment)), "b-evidence");
  }
  assert.equal(f.legalState(), null);
}

test("real provider cleanup does not keep its completed user on the pending screen", async () => {
  const f = fixture(); const marker = accountDeletionMarkerKey("a");
  await settleAccountDeletionClient(f.storage, marker, 200, true, async () => {
    assert.equal(f.storage.getItem(marker), "completed_cleanup_pending");
    return f.purge("a");
  });
  assert.equal(f.pending(), "", "screen returns to access without reload or retry");
  assert.equal(f.storage.getItem(marker), "completed");
  assert.equal(f.authClears(), 1);
  assertOwnerScopedLegalCleanup(f);
});

test("successful cleanup retains other pending owners; failed cleanup keeps its own barrier", async () => {
  const f = fixture();
  f.storage.setItem(accountDeletionMarkerKey("a"), "completed_cleanup_pending");
  f.storage.setItem(accountDeletionMarkerKey("b"), "completed_cleanup_pending");
  assert.equal(await f.purge("a"), true);
  assert.equal(f.pending(), "b");
  assertOwnerScopedLegalCleanup(f);
  const failed = fixture(true);
  failed.storage.setItem(accountDeletionMarkerKey("a"), "completed_cleanup_pending");
  assert.equal(await failed.purge("a"), false);
  assert.equal(failed.pending(), "a");
});

test("AI cleanup failure keeps local purge pending instead of reporting completion", async () => {
  const f = fixture(false, true);
  f.storage.setItem(accountDeletionMarkerKey("a"), "completed_cleanup_pending");
  assert.equal(await f.purge("a"), false);
  assert.equal(f.pending(), "a");
});

test("confirmed cleanup forgets only the deleted account profile fallback", async () => {
  const deleted = fixture(false, false, "a");
  assert.equal(await deleted.purge("a"), true);
  assert.equal(deleted.cloudProfileFallback(), null);

  const other = fixture(false, false, "b");
  assert.equal(await other.purge("a"), true);
  assert.equal(other.cloudProfileFallback()?.userId, "b");
});

test("delete dialog exposes exact progress copy while preserving strong confirmation and busy guard", () => {
  const dialog = readFileSync("app/components/profile-data-dialogs.tsx", "utf8");
  assert.match(dialog, /Estamos eliminando tu cuenta…/);
  assert.match(dialog, /props\.confirmation !== "ELIMINAR" \|\| props\.busy \|\| props\.syncBusy/);
  assert.match(dialog, /disabled=\{props\.busy\}/);
});

test("retrying a stale completed cleanup screen never downgrades confirmed deletion", async () => {
  const f = fixture(); const marker = accountDeletionMarkerKey("a");
  f.storage.setItem(marker, "completed");
  const retry = actualHandler("retryPendingLocalDeletionCleanup", {
    ...f.bindings, pendingLocalDeletionOwner: "a", deletionRecoveryBusy: false,
    setDeletionRecoveryBusy: () => {}, setDeletionRecoveryError: () => {},
    purgeDeletedAccountLocal: f.purge, pendingDeletionSession: null, pendingDeletionOwner: "",
    setPendingDeletionSession: () => {}, setPendingDeletionOwner: () => {},
  }) as () => Promise<void>;
  await retry();
  assert.equal(f.storage.getItem(marker), "completed");
  assert.equal(f.pending(), "");
  assert.equal(f.authClears(), 1);
});
