import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";
import { accountDeletionMarkerKey } from "../lib/account-state";
import {
  accountDeletionIntentKey, accountDeletionPrewriteRejected, accountDeletionRequestBody,
  accountDeletionResponseConfirmed, clearAccountDeletionIntent, prepareAccountDeletionIntent,
  readAccountDeletionIntent, settleAccountDeletionClient,
} from "../lib/account-deletion-client";

const source = readFileSync("app/components/account-panel.tsx", "utf8");
const parsed = ts.createSourceFile("account-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handlerSource = "";
function findHandler(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "deleteAccount") handlerSource = node.getText(parsed);
  ts.forEachChild(node, findHandler);
}
findHandler(parsed);
const handlerJs = ts.transpileModule(handlerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const USER = "11111111-1111-4111-8111-111111111111";

function fixture(options: { confirmation?: string; policy?: "delete_golf_data" | "retain_history" | null; mode?: string; respond?: () => Promise<Response> } = {}) {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const calls: RequestInit[] = [];
  const messages: string[] = [];
  const liveOwner = { current: USER };
  const inFlight = { current: false };
  let purges = 0;
  let open = true;
  let busy = false;
  const bindings = {
    identity: { userId: USER, mode: options.mode || "authenticated", accessToken: "qa-token" }, cloudStatus: "synced",
    deleteText: options.confirmation ?? "ELIMINAR", deletePolicy: options.policy === undefined ? "delete_golf_data" : options.policy,
    accountInFlight: inFlight, accountRequestId: { current: undefined }, mounted: { current: true }, liveOwner,
    setDeletingAccount: (value: boolean) => { busy = value; }, setMessageKind: () => {},
    setMessage: (value: string) => { messages.push(value); }, setDeleteError: (value: string) => { messages.push(value); },
    setDeleteOpen: (value: boolean) => { open = value; },
    localStorage: storage, accountDeletionMarkerKey, prepareAccountDeletionIntent, accountDeletionRequestBody,
    accountDeletionResponseConfirmed, accountDeletionPrewriteRejected, clearAccountDeletionIntent, settleAccountDeletionClient,
    finishAccountDeletion: async () => { purges++; return true; },
    fetch: async (_url: string, init: RequestInit) => {
      calls.push(init);
      return options.respond ? options.respond() : Response.json({ ok: true, deleted: true, archived: false, accountStatus: "deleted" });
    },
  };
  // Execute the actual TSX event-handler body with isolated browser/provider
  // bindings. No network, React rendering or server mocks hide handler errors.
  const run = new Function(...Object.keys(bindings), `${handlerJs}; return deleteAccount;`)(...Object.values(bindings)) as () => Promise<void>;
  return { run, calls, storage, liveOwner, inFlight, messages, purges: () => purges, open: () => open, busy: () => busy };
}

test("legacy AccountPanel reuses canonical policy dialog without confirmation-only endpoint", () => {
  assert.ok(handlerSource);
  assert.match(source, /<AccountDataDialog confirmation=\{deleteText\}[^\n]*policy=\{deletePolicy\}/);
  assert.match(source, /onConfirm=\{\(\) => void deleteAccount\(\)\}/);
  assert.doesNotMatch(source, /deleteAllConfirmed|¿Deseas borrar toda tu información\?|JSON\.stringify\(\{ confirmation: "ELIMINAR" \}\)/);
  assert.ok(handlerSource.indexOf("prepareAccountDeletionIntent(") < handlerSource.indexOf("localStorage.setItem(deletionMarker"));
});

test("legacy delete handler rejects guest, missing policy and anything except ELIMINAR before writes", async () => {
  for (const options of [{ mode: "guest" }, { policy: null }, { confirmation: "eliminar" }, { confirmation: " ELIMINAR " }]) {
    const f = fixture(options);
    await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(f.storage.getItem(accountDeletionMarkerKey(USER)), null);
    assert.equal(f.purges(), 0);
  }
});

test("legacy delete handler persists policy/recovery key before request and blocks double submit", async () => {
  let complete: ((value: Response) => void) | undefined;
  const f = fixture({ respond: () => new Promise<Response>(resolve => { complete = resolve; }) });
  const first = f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.busy(), true);
  assert.ok(readAccountDeletionIntent(f.storage, USER)?.recoveryToken);
  assert.equal(f.calls[0].redirect, "error");
  assert.ok(f.calls[0].signal);
  const body = JSON.parse(String(f.calls[0].body));
  assert.equal(body.confirmation, "ELIMINAR");
  assert.equal(body.dataPolicy, "delete_golf_data");
  assert.equal(body.requestId, readAccountDeletionIntent(f.storage, USER)?.requestId);
  await f.run();
  assert.equal(f.calls.length, 1);
  complete!(Response.json({ ok: true, deleted: true, archived: false, accountStatus: "deleted" }));
  await first;
  assert.equal(f.purges(), 1);
  assert.equal(f.storage.getItem(accountDeletionMarkerKey(USER)), "completed");
  assert.equal(f.busy(), false);
});

test("legacy archive handler validates archived semantics independently from deletion", async () => {
  const archived = fixture({ policy: "retain_history", respond: async () => Response.json({ ok: true, deleted: false, archived: true, accountStatus: "archived" }) });
  await archived.run();
  assert.equal(JSON.parse(String(archived.calls[0].body)).dataPolicy, "retain_history");
  assert.equal(archived.purges(), 1);
  const wrongPolicyResult = fixture({ policy: "retain_history" });
  await wrongPolicyResult.run();
  assert.equal(wrongPolicyResult.purges(), 0);
  assert.equal(wrongPolicyResult.storage.getItem(accountDeletionMarkerKey(USER)), "pending_confirmation");
});

test("legacy handler never purges on malformed 200, but releases barrier after proven prewrite rejection", async () => {
  const ambiguous = fixture({ respond: async () => Response.json({ ok: true }) });
  await ambiguous.run();
  assert.equal(ambiguous.purges(), 0);
  assert.equal(ambiguous.storage.getItem(accountDeletionMarkerKey(USER)), "pending_confirmation");
  assert.ok(ambiguous.storage.getItem(accountDeletionIntentKey(USER)));
  const rejected = fixture({ respond: async () => Response.json({ code: "CONTROLLED_DB_ACTION_REQUIRED", noDataDeleted: true, error: "No disponible." }, { status: 503 }) });
  await rejected.run();
  assert.equal(rejected.purges(), 0);
  assert.equal(rejected.storage.getItem(accountDeletionMarkerKey(USER)), null);
  assert.equal(rejected.storage.getItem(accountDeletionIntentKey(USER)), null);
  assert.equal(rejected.open(), true, "safe rejection keeps choice dialog available");
});

test("legacy pending response cannot purge another account after identity changes", async () => {
  const f = fixture({ respond: async () => {
    f.liveOwner.current = "another-account";
    return Response.json({ ok: true, deleted: true, archived: false, accountStatus: "deleted" });
  } });
  await f.run();
  assert.equal(f.purges(), 0);
  assert.equal(f.storage.getItem(accountDeletionMarkerKey(USER)), "completed_cleanup_pending");
});
