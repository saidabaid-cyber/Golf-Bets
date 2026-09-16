import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";
import { ACCOUNT_DELETION_MARKER_PREFIX, ACCOUNT_STORAGE_KEYS, accountDeletionMarkerKey } from "../lib/account-state";
import { settleAccountDeletionClient } from "../lib/account-deletion-client";

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
function fixture(failOffline = false) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null };
  let pending = "";
  let authClears = 0;
  const scan = actualHandler("nextPendingLocalDeletionOwner", { ACCOUNT_DELETION_MARKER_PREFIX });
  const noop = () => {};
  const bindings = {
    localStorage: storage, ACCOUNT_STORAGE_KEYS, accountDeletionMarkerKey,
    activeUserId: { current: "a" }, ownsLocalWorkspace: () => true,
    setPendingLocalDeletionOwner: (id: string) => { pending = id; },
    setIdentity: noop, setEquipmentOnboardingRequired: noop, setBetaOnboardingRequired: noop, setAccessRequested: noop,
    setCloudLinked: noop, setCloudStatus: noop, setLastCloudSync: noop, setCloudIssuesByDomain: noop, setShowMigration: noop,
    getSupabaseBrowser: () => ({ auth: {} }), clearDeletedAuthSessionForUser: async () => { authClears++; },
    profileWriteCoordinators: { current: new Map() }, readAllOfflineAccountRecords: async () => [],
    scorecardPhotoIdsForOwner: async () => [], selectAccountScorecardPhotoIds: () => [], deleteScorecardPhotos: async () => {},
    deleteOfflineAccountData: async () => { if (failOffline) throw Error("temporary offline store error"); },
    discardAccountWorkspace: noop, clearAccountDeletionIntent: noop, parseLegalAcceptances: () => [],
    clearLegalAcceptancesForUser: () => [], setAcceptances: noop, nextPendingLocalDeletionOwner: scan,
    console: { warn: noop },
  };
  const purge = actualHandler("purgeDeletedAccountLocal", bindings) as (id: string, options?: object) => Promise<boolean>;
  return { storage, purge, scan, bindings, pending: () => pending, authClears: () => authClears };
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
});

test("successful cleanup retains other pending owners; failed cleanup keeps its own barrier", async () => {
  const f = fixture();
  f.storage.setItem(accountDeletionMarkerKey("a"), "completed_cleanup_pending");
  f.storage.setItem(accountDeletionMarkerKey("b"), "completed_cleanup_pending");
  assert.equal(await f.purge("a"), true);
  assert.equal(f.pending(), "b");
  const failed = fixture(true);
  failed.storage.setItem(accountDeletionMarkerKey("a"), "completed_cleanup_pending");
  assert.equal(await failed.purge("a"), false);
  assert.equal(failed.pending(), "a");
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
