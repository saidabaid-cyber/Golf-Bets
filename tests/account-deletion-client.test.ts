import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { accountDeletionRecoveryAction, settleAccountDeletionClient } from "../lib/account-deletion-client";

class MemoryStorage {
  values = new Map<string, string>();
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  getItem(key: string) { return this.values.get(key) ?? null; }
}

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
    assert.match(panel, /catch \(error\) \{\s*if \(serverDeletionConfirmed\) \{[\s\S]*return;\s*\}\s*try \{\s*const outcome = await settleAccountDeletionClient/);
  }
});

test("respuesta perdida mantiene datos y un 4xx libera el barrier sin purga", async () => {
  const storage = new MemoryStorage();
  storage.setItem("deletion:user-a", "requested-at");
  storage.setItem("round:user-a", "ronda-viva");
  let finishCalls = 0;
  const finish = async () => { finishCalls += 1; return true; };
  assert.equal(await settleAccountDeletionClient(storage, "deletion:user-a", null, false, finish), "pending_confirmation");
  assert.equal(storage.getItem("round:user-a"), "ronda-viva");
  assert.equal(await settleAccountDeletionClient(storage, "deletion:user-a", 401, false, finish), "rejected");
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
  assert.match(route, /ACCOUNT_DELETION_CONTROLLED_DB_APPLY_PENDING\) return Response\.json\(\{[\s\S]*noDataDeleted: true \}, \{ status: 503 \}\)/);
  assert.ok(route.indexOf("noDataDeleted: true") < route.indexOf('from("product_usage_events_v2").insert'));
  assert.match(provider, /if \(!response\.ok\) \{[\s\S]*if \(result\?\.noDataDeleted === true\) \{[\s\S]*auth\.getUser\(session\.access_token\)[\s\S]*verified\.data\.user\?\.id === session\.user\.id\) setPendingDeletionAccountActive\(true\)/);
  assert.match(provider, /if \(!session \|\| !pendingDeletionAccountActive \|\| deletionRecoveryBusy\) return/);
  assert.match(provider, /const verified = await supabase\.auth\.getUser\(session\.access_token\);[\s\S]*verified\.data\.user\?\.id !== session\.user\.id\)[\s\S]*localStorage\.removeItem\(accountDeletionMarkerKey\(session\.user\.id\)\)/);
  assert.match(provider, /\{pendingDeletionAccountActive && <button[\s\S]*Conservar mi cuenta<\/button>\}/);
});
