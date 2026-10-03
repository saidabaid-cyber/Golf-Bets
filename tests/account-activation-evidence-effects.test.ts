import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync("app/components/account-provider.tsx", "utf8");
const file = ts.createSourceFile("provider.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the actual production effects, not a second implementation of their
// guards. Transport is synthetic here; remote lifecycle QA is recorded separately.
function productionEffect(marker: string) {
  const found: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect"
      && node.arguments[0]?.getText(file).includes(marker)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(found.length, 1, marker);
  assert.match(found[0].arguments[1].getText(file), /activeAccountConfirmed/,
    "successful reactivation must restart this effect without another login");
  return ts.transpileModule(`exports.run = ${found[0].arguments[0].getText(file)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function harness(marker: string, active: boolean, guest = false) {
  const calls: string[] = [];
  const listeners = new Map<string, () => void>();
  const exports: { run?: () => void | (() => void) } = {};
  const eventTarget = {
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  runInNewContext(productionEffect(marker), {
    exports, queueMicrotask,
    identity: { mode: guest ? "guest" : "authenticated", userId: "qa-owner", accessToken: guest ? null : "qa-token" },
    activeAccountConfirmed: active,
    currentConsent: true,
    acceptances: [{ userId: "qa-owner" }],
    activeUserId: { current: "qa-owner" },
    legalEnvironment: "test",
    OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT: "optional-change",
    localStorage: { getItem: () => null },
    navigator: { onLine: true },
    window: eventTarget, document: { ...eventTarget, visibilityState: "visible" },
    accountDeletionMarkerKey: () => "qa-marker",
    accountMutationStillActive: () => true,
    legalActorForIdentity: () => ({ actorKey: guest ? "guest-local:qa" : "account:qa-owner" }),
    readLegalEvidence: () => [],
    legalEvidenceStateKey: () => "qa-evidence",
    setLegalEvidenceState: () => undefined,
    setCloudIssue: () => undefined,
    setAcceptances: () => undefined,
    prepareLegalSyncBatch: () => ({ acceptances: [{ userId: "qa-owner" }] }),
    clearPendingLegalSync: () => undefined,
    flushLegalAcceptances: async () => { calls.push("legacy-write"); },
    synchronizeLegalEvidence: async () => { calls.push("evidence-read"); return []; },
    setLegalRetryRevision: () => calls.push("refresh"),
  });
  const cleanup = exports.run!();
  return { calls, listeners, cleanup };
}

for (const active of [false, true]) {
  test(`evidence hydration waits for authoritative activation: active=${active}`, () => {
    const h = harness("void synchronizeLegalEvidence({", active);
    assert.deepEqual(h.calls, active ? ["evidence-read"] : []);
    if (typeof h.cleanup === "function") h.cleanup();
  });
  test(`pending acceptance writes wait for authoritative activation: active=${active}`, async () => {
    const h = harness("prepareLegalSyncBatch(localStorage, syncingUserId", active);
    assert.deepEqual(h.calls, active ? ["legacy-write"] : []);
    if (typeof h.cleanup === "function") h.cleanup();
    await Promise.resolve();
  });
  test(`focus/network refresh cannot query a deactivated account: active=${active}`, async () => {
    const h = harness("const requestRemoteResolution", active);
    h.listeners.get("focus")?.();
    await Promise.resolve();
    assert.deepEqual(h.calls, active ? ["refresh"] : []);
    if (typeof h.cleanup === "function") h.cleanup();
  });
}

test("guest evidence remains local without requiring account activation", () => {
  const h = harness("void synchronizeLegalEvidence({", false, true);
  assert.deepEqual(h.calls, []);
});
