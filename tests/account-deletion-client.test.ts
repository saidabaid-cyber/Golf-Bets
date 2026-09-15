import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { accountDeletionRecoveryAction, accountDeletionIntentKey, accountDeletionPrewriteRejected, accountDeletionRequestBody, accountDeletionResponseConfirmed, clearAccountDeletionIntent, persistAccountDeletionIntent, prepareAccountDeletionIntent, readAccountDeletionIntent, settleAccountDeletionClient } from "../lib/account-deletion-client";

class MemoryStorage {
  values = new Map<string, string>();
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  getItem(key: string) { return this.values.get(key) ?? null; }
}

test("recovery secret is durable and reload retries the original owner/policy/request", () => {
  const storage = new MemoryStorage();
  const original = prepareAccountDeletionIntent(storage, "user-a", "retain_history", "11111111-1111-4111-8111-111111111111");
  assert.match(original.recoveryToken!, /^[a-f0-9]{64}$/);
  const reloaded = prepareAccountDeletionIntent(storage, "user-a", "retain_history", "22222222-2222-4222-8222-222222222222");
  assert.deepEqual(reloaded, original);
  assert.deepEqual(readAccountDeletionIntent(storage, "user-a"), original);
  assert.equal(readAccountDeletionIntent(storage, "user-b"), null);
  assert.throws(() => prepareAccountDeletionIntent(storage, "user-a", "delete_golf_data", "22222222-2222-4222-8222-222222222222"), /solicitud/);
  assert.deepEqual(accountDeletionRequestBody(original), { confirmation: "ELIMINAR", ...original });
  assert.equal("userId" in accountDeletionRequestBody(original), false);
  storage.setItem(accountDeletionIntentKey("user-a"), JSON.stringify({ version: "2", userId: "user-a", ...original }));
  assert.equal(readAccountDeletionIntent(storage, "user-a"), null);
});

test("success requires exact selected data policy; unrelated or malformed 2xx cannot purge", () => {
  const deleted = { ok: true, deleted: true, archived: false, accountStatus: "deleted" };
  const archived = { ok: true, deleted: false, archived: true, accountStatus: "archived" };
  assert.equal(accountDeletionResponseConfirmed(deleted, "delete_golf_data"), true);
  assert.equal(accountDeletionResponseConfirmed(archived, "retain_history"), true);
  assert.equal(accountDeletionResponseConfirmed(deleted, "retain_history"), false);
  assert.equal(accountDeletionResponseConfirmed(archived, "delete_golf_data"), false);
  for (const value of [null, {}, { ok: true }, { ...deleted, deleted: false }, { ...archived, accountStatus: "deleted" }]) {
    assert.equal(accountDeletionResponseConfirmed(value, "delete_golf_data"), false);
    assert.equal(accountDeletionResponseConfirmed(value, "retain_history"), false);
  }
});

test("prewrite refusal releases sync only when server explicitly confirms no mutation", () => {
  assert.equal(accountDeletionPrewriteRejected(503, { code: "CONTROLLED_DB_ACTION_REQUIRED", noDataDeleted: true }), true);
  assert.equal(accountDeletionPrewriteRejected(503, { code: "ACCOUNT_OPERATION_PENDING", noDataDeleted: true }), false);
  assert.equal(accountDeletionPrewriteRejected(503, { code: "CONTROLLED_DB_ACTION_REQUIRED" }), false);
  assert.equal(accountDeletionPrewriteRejected(200, { code: "CONTROLLED_DB_ACTION_REQUIRED", noDataDeleted: true }), false);
});

test("recovery UI remains available after Auth session is revoked without exposing another owner", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /session\?\.user\.id \|\| pendingDeletionOwner/);
  assert.match(provider, /pendingDeletionSession \|\| pendingDeletionOwner/);
  assert.match(provider, /readAccountDeletionIntent\(localStorage, marker\.userId\)\?\.recoveryToken/);
  assert.match(provider, /accountDeletionResponseConfirmed\(result, intent\.dataPolicy\)/);
  assert.match(provider, /clearDeletedAuthSessionForUser\(supabase\.auth, userId\)/);
  assert.match(provider, /if \(pendingDeletionOwner === userId\) setPendingDeletionOwner\(""\)/);
});

test("elección de borrado se guarda por owner antes de marker y retry usa misma key", () => {
  const storage = new MemoryStorage();
  const intent = { dataPolicy: "retain_history" as const, requestId: "11111111-1111-4111-8111-111111111111" };
  assert.deepEqual(persistAccountDeletionIntent(storage, "user-a", intent), intent);
  assert.deepEqual(readAccountDeletionIntent(storage, "user-a"), intent);
  assert.equal(readAccountDeletionIntent(storage, "user-b"), null);
  assert.match(storage.getItem(accountDeletionIntentKey("user-a"))!, /"userId":"user-a"/);
  clearAccountDeletionIntent(storage, "user-a");
  assert.equal(readAccountDeletionIntent(storage, "user-a"), null);
});

test("storage no durable, formato corrupto o policy inválida nunca permiten retry supuesto", () => {
  const storage = new MemoryStorage();
  const intent = { dataPolicy: "delete_golf_data" as const, requestId: "11111111-1111-4111-8111-111111111111" };
  assert.throws(() => persistAccountDeletionIntent({ setItem: () => {}, getItem: () => null }, "user-a", intent), /No pudimos guardar/);
  assert.throws(() => persistAccountDeletionIntent(storage, "user-a", { ...intent, requestId: "bad" }), /no es válida/);
  storage.setItem(accountDeletionIntentKey("user-a"), JSON.stringify({ version: 1, userId: "user-b", ...intent }));
  assert.equal(readAccountDeletionIntent(storage, "user-a"), null);
  storage.setItem(accountDeletionIntentKey("user-a"), "{not-json");
  assert.equal(readAccountDeletionIntent(storage, "user-a"), null);
});

test("HTTP 500 con Auth todavía activo no purga datos locales", async () => {
  const storage = new MemoryStorage();
  storage.setItem("deletion:user-a", "requested-at");
  storage.setItem("round:user-a", "ronda-viva");
  let finishCalls = 0;
  const outcome = await settleAccountDeletionClient(storage, "deletion:user-a", 500, false, async () => {
    finishCalls += 1;
    storage.removeItem("round:user-a");
    return true;
  });

  assert.equal(outcome, "pending_confirmation");
  assert.equal(finishCalls, 0);
  assert.equal(storage.getItem("round:user-a"), "ronda-viva");
  assert.equal(storage.getItem("deletion:user-a"), "pending_confirmation");
  assert.equal(await settleAccountDeletionClient(storage, "deletion:user-a", 503, true, async () => {
    finishCalls += 1;
    return true;
  }), "pending_confirmation", "un flag erróneo no convierte HTTP 503 en éxito");
  assert.equal(finishCalls, 0);
});

test("HTTP 2xx confirmado sí limpia y marca la cuenta completada", async () => {
  const storage = new MemoryStorage();
  storage.setItem("deletion:user-a", "requested-at");
  storage.setItem("round:user-a", "ronda-a-borrar");
  let finishCalls = 0;
  const outcome = await settleAccountDeletionClient(storage, "deletion:user-a", 200, true, async () => {
    finishCalls += 1;
    assert.equal(storage.getItem("deletion:user-a"), "completed_cleanup_pending");
    storage.removeItem("round:user-a");
    return true;
  });

  assert.equal(outcome, "confirmed");
  assert.equal(finishCalls, 1);
  assert.equal(storage.getItem("round:user-a"), null);
  assert.equal(storage.getItem("deletion:user-a"), "completed");
});

test("interrupción después del 2xx deja prueba durable antes de purgar", async () => {
  const storage = new MemoryStorage();
  storage.setItem("deletion:user-a", "requested-at");
  storage.setItem("round:user-a", "ronda-pendiente");
  await assert.rejects(settleAccountDeletionClient(storage, "deletion:user-a", 204, true, async () => {
    assert.equal(storage.getItem("deletion:user-a"), "completed_cleanup_pending");
    throw new Error("tab_closed_during_cleanup");
  }), /tab_closed_during_cleanup/);
  assert.equal(storage.getItem("round:user-a"), "ronda-pendiente");
  assert.equal(storage.getItem("deletion:user-a"), "completed_cleanup_pending");
  assert.equal(accountDeletionRecoveryAction(storage.getItem("deletion:user-a")!), "purge");
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /serverDeletionConfirmed = true;\s*localStorage\.setItem\(markerKey, "completed_cleanup_pending"\);\s*\}\s*const locallyComplete = await purgeDeletedAccountLocal/);
});

test("fallo de cleanup tras 2xx no repite purge en catch del panel", async () => {
  const storage = new MemoryStorage();
  let finishCalls = 0;
  await assert.rejects(settleAccountDeletionClient(storage, "deletion:user-a", 200, true, async () => {
    finishCalls += 1;
    throw new Error("cleanup_failed");
  }), /cleanup_failed/);
  assert.equal(finishCalls, 1);
  assert.equal(storage.getItem("deletion:user-a"), "completed_cleanup_pending");
  for (const path of ["app/components/account-panel.tsx", "app/components/profile-account-panel.tsx"]) {
    const panel = readFileSync(path, "utf8");
    assert.match(panel, /catch \(error\) \{[\s\S]*if \(serverDeletionConfirmed\) \{[\s\S]*return;\s*\}\s*try \{\s*const outcome = await settleAccountDeletionClient/);
  }
});

test("respuesta perdida/Auth expirado/conflicto conservan barrier; rechazo prewrite lo libera", async () => {
  const storage = new MemoryStorage();
  storage.setItem("deletion:user-a", "requested-at");
  storage.setItem("round:user-a", "ronda-viva");
  let finishCalls = 0;
  const finish = async () => { finishCalls += 1; return true; };
  assert.equal(await settleAccountDeletionClient(storage, "deletion:user-a", null, false, finish), "pending_confirmation");
  assert.equal(storage.getItem("round:user-a"), "ronda-viva");
  assert.equal(await settleAccountDeletionClient(storage, "deletion:user-a", 401, false, finish), "pending_confirmation");
  assert.equal(await settleAccountDeletionClient(storage, "deletion:user-a", 409, false, finish), "pending_confirmation");
  assert.equal(await settleAccountDeletionClient(storage, "deletion:user-a", 400, false, finish), "rejected");
  assert.equal(storage.getItem("deletion:user-a"), null);
  assert.equal(finishCalls, 0);
});

test("reload con marker timestamp nunca autoriza purge", () => {
  assert.equal(accountDeletionRecoveryAction("2026-09-15T12:00:00.000Z"), "normalize_pending");
  assert.equal(accountDeletionRecoveryAction("cleanup_pending"), "normalize_pending");
  assert.equal(accountDeletionRecoveryAction("pending_confirmation"), "wait");
  assert.equal(accountDeletionRecoveryAction("completed_cleanup_pending"), "purge");
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /const action = accountDeletionRecoveryAction\(marker\.state\)/);
  assert.match(provider, /if \(action === "normalize_pending"\) \{[\s\S]*setItem\(accountDeletionMarkerKey\(marker\.userId\), "pending_confirmation"\)[\s\S]*continue/);
});

test("ambos paneles usan la misma política fail-closed", () => {
  for (const path of ["app/components/account-panel.tsx", "app/components/profile-account-panel.tsx"]) {
    const panel = readFileSync(path, "utf8");
    assert.match(panel, /settleAccountDeletionClient\(localStorage, [\s\S]*serverDeletionConfirmed, finishAccountDeletion\)/);
    assert.doesNotMatch(panel, /responseStatus === null \|\| serverDeletionConfirmed \|\| responseStatus >= 500/);
  }
});

test("Conservar mi cuenta sólo aparece tras Auth activo y revalida al pulsar", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const route = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(route, /code: "CONTROLLED_DB_ACTION_REQUIRED"[\s\S]*noDataDeleted: true/);
  assert.doesNotMatch(route, /from\("product_usage_events_v2"\)\.insert|deleteAccountGraph\(/);
  assert.match(provider, /const intent = readAccountDeletionIntent\(localStorage, userId\);[\s\S]*body: JSON\.stringify\(accountDeletionRequestBody\(intent\)\)/);
  assert.match(provider, /if \(!intent \|\| \(!session && !intent\.recoveryToken\)\) throw new Error/);
  assert.match(provider, /Contactar soporte/);
  assert.match(provider, /session && accountDeletionPrewriteRejected\(response\.status, result\)[\s\S]*auth\.getUser\(session\.access_token\)[\s\S]*verified\.data\.user\?\.id === session\.user\.id\) setPendingDeletionAccountActive\(true\)/);
  assert.match(provider, /if \(!session \|\| !pendingDeletionAccountActive \|\| deletionRecoveryBusy\) return/);
  assert.match(provider, /const verified = await supabase\.auth\.getUser\(session\.access_token\);[\s\S]*verified\.data\.user\?\.id !== session\.user\.id\)[\s\S]*localStorage\.removeItem\(accountDeletionMarkerKey\(session\.user\.id\)\)/);
  assert.match(provider, /\{pendingDeletionAccountActive && <button[\s\S]*Conservar mi cuenta<\/button>\}/);
});
