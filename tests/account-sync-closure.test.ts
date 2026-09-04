import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ACCOUNT_OWNED_ROWS, ACCOUNT_REFERENCE_COLUMNS, deleteAccountGraph, type AccountDeletionGateway } from "../lib/account-deletion";
import { discardAccountWorkspace, switchAccountWorkspace, WORKSPACE_OWNER_KEY } from "../lib/account-workspace";
import { CloudSyncGate, cloudSyncErrorMessage, syncStatusAfterSkip } from "../lib/cloud-sync-gate";
import { STORAGE_KEYS } from "../lib/round-utils";
import { legalReturnDestination, preserveLegalReturn } from "../lib/legal-navigation";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

test("coordinador cloud evita loops propios, agrupa cambios y permite retry manual", () => {
  const gate = new CloudSyncGate();
  assert.equal(gate.begin("v1", "mount"), "run");
  assert.equal(gate.begin("v2", "local"), "busy");
  assert.equal(gate.begin("v2", "manual"), "busy");
  assert.equal(gate.success("v2"), "manual");
  assert.equal(gate.begin("v2", "local"), "unchanged");
  assert.equal(syncStatusAfterSkip("unchanged"), "synced");

  assert.equal(gate.begin("v3", "local"), "run");
  gate.failure("v3");
  assert.equal(gate.begin("v3", "local"), "failed");
  assert.equal(syncStatusAfterSkip("failed"), "error");
  assert.equal(gate.begin("v3", "manual"), "run");
  gate.success("v3");
});

test("logout/cambio de cuenta cancela el coordinador sin ejecutar cola obsoleta", () => {
  const gate = new CloudSyncGate();
  assert.equal(gate.begin("a1", "mount"), "run");
  assert.equal(gate.begin("a2", "local"), "busy");
  gate.cancel();
  assert.equal(gate.begin("a2", "manual"), "cancelled");
  assert.equal(gate.pending(), null);
});

test("errores cloud son humanos, recuperables y no exponen detalles internos", () => {
  assert.match(cloudSyncErrorMessage(new Error("Failed to fetch")), /copia local/);
  assert.match(cloudSyncErrorMessage(new Error("JWT expired")), /sesión cambió/);
  assert.match(cloudSyncErrorMessage(new Error("photo upload failed")), /foto sigue guardada/);
  assert.equal(cloudSyncErrorMessage(new Error("Sync cancelled")), "");
});

test("eliminar cuenta local descarta solo A y conserva invitado y B", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.history, "guest-history");
  switchAccountWorkspace(storage, "user-a");
  storage.setItem(STORAGE_KEYS.history, "a-history");
  storage.setItem("backyard-profile-cache-v1:user-a", "a-profile");
  switchAccountWorkspace(storage, "user-b");
  storage.setItem(STORAGE_KEYS.history, "b-history");
  switchAccountWorkspace(storage, "user-a");

  discardAccountWorkspace(storage, "user-a");
  assert.equal(storage.getItem(WORKSPACE_OWNER_KEY), "guest");
  assert.equal(storage.getItem(STORAGE_KEYS.history), "guest-history");
  assert.equal(storage.getItem("backyard-profile-cache-v1:user-a"), null);
  switchAccountWorkspace(storage, "user-b");
  assert.equal(storage.getItem(STORAGE_KEYS.history), "b-history");
  switchAccountWorkspace(storage, "user-a");
  assert.equal(storage.getItem(STORAGE_KEYS.history), null);
});

function deletionGateway(options: { failStorage?: boolean } = {}) {
  const calls: string[] = [];
  const folders: Record<string, Array<{ name: string; isFolder: boolean }>> = {
    "user-a": [{ name: "round-1", isFolder: true }, { name: "root.webp", isFolder: false }],
    "user-a/round-1": [{ name: "card.jpg", isFolder: false }],
  };
  const gateway: AccountDeletionGateway = {
    listStorage: async (prefix, offset) => { calls.push(`list:${prefix}:${offset}`); return offset ? [] : folders[prefix] || []; },
    removeStorage: async paths => { calls.push(`storage:${paths.sort().join(",")}`); if (options.failStorage) throw new Error("storage unavailable"); },
    ownedTournaments: async userId => { calls.push(`tournaments:${userId}`); return [{ id: "t-1", publicId: "public-1" }, { id: "t-2", publicId: "public-2" }]; },
    deleteWhere: async (table, column, value) => { calls.push(`delete:${table}:${column}:${value}`); },
    deleteWhereIn: async (table, column, values) => { calls.push(`delete-in:${table}:${column}:${values.join(",")}`); },
    clearReference: async (table, column, userId) => { calls.push(`clear:${table}:${column}:${userId}`); },
    deleteAuthUser: async userId => { calls.push(`auth:${userId}`); },
  };
  return { gateway, calls };
}

test("eliminación server-side limpia media/datos/referencias y Auth al final", async () => {
  const { gateway, calls } = deletionGateway();
  const result = await deleteAccountGraph(gateway, "user-a");
  assert.deepEqual(result, { deletedPhotoCount: 2, deletedTournamentCount: 2 });
  assert.ok(calls.indexOf("storage:user-a/round-1/card.jpg,user-a/root.webp") < calls.indexOf("auth:user-a"));
  assert.equal(calls.at(-1), "auth:user-a");
  for (const [table, column] of ACCOUNT_OWNED_ROWS) assert.ok(calls.includes(`delete:${table}:${column}:user-a`), `${table} no se eliminó`);
  for (const [table, column] of ACCOUNT_REFERENCE_COLUMNS) assert.ok(calls.includes(`clear:${table}:${column}:user-a`), `${table}.${column} no se limpió`);
  assert.ok(calls.includes("delete-in:score_audit_log:tournament_id:t-1,t-2"));
  assert.ok(calls.includes("delete-in:polla_join_attempts:public_id:public-1,public-2"));
});

test("un fallo de Storage impide afirmar eliminación o borrar Auth", async () => {
  const { gateway, calls } = deletionGateway({ failStorage: true });
  await assert.rejects(deleteAccountGraph(gateway, "user-a"), /storage unavailable/);
  assert.equal(calls.some(call => call.startsWith("auth:")), false);
});

test("endpoint deriva user id del token y nunca acepta userId del body", () => {
  const source = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /data\.user\.id/);
  assert.doesNotMatch(source, /body\.userId|userId\s*:\s*body/);
  assert.match(source, /confirmation !== "ELIMINAR"/);
});

test("documentos legales regresan al origen y conservan contexto entre documentos", () => {
  assert.deepEqual(legalReturnDestination("account"), { href: "/?screen=account", label: "← Regresar a Mi Cuenta" });
  assert.match(legalReturnDestination("onboarding").label, /consentimiento/);
  assert.match(legalReturnDestination("access").label, /acceso/);
  assert.equal(preserveLegalReturn("/legal/privacy#contact", "account"), "/legal/privacy?returnTo=account#contact");
});

test("Cuenta y acceso no presentan Apple y usan el origin real para Google", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const account = readFileSync("app/components/account-panel.tsx", "utf8");
  assert.doesNotMatch(provider, /Continuar con Apple|Apple · pendiente/);
  assert.doesNotMatch(account, />Apple</);
  assert.match(provider, /`\$\{window\.location\.origin\}\/auth\/callback`/);
});
