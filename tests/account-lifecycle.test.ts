import assert from "node:assert/strict";
import test from "node:test";
import { accountLifecycleEnabled, executeAccountLifecycle, validateAccountLifecycleJob, type AccountLifecycleGateway, type AccountLifecycleJob } from "../lib/account-lifecycle";
import { parseAccountDeletionChoice } from "../lib/account-deletion";

const scope = { actor: "actor", requestId: "request", dataPolicy: "delete_golf_data" as const, lease: "lease" };
const base: AccountLifecycleJob = { user_id: scope.actor, request_id: scope.requestId, data_policy: scope.dataPolicy, lease_token: scope.lease, stage: "requested", completed_at: null };
function gateway(initial: Partial<AccountLifecycleJob> = {}, failure?: string) {
  const calls: string[] = []; let photos = true;
  const job = { ...base, ...initial };
  const step = (name: string) => { calls.push(name); if (failure === name) throw new Error(name); };
  const gateway: AccountLifecycleGateway = {
    acquire: async () => { step("acquire"); return job; },
    storageBatch: async () => { step("manifest"); return photos ? [{ bucket_id: "photos", name: "actor/avatar.webp" }] : []; },
    removeStorage: async () => { step("storage"); photos = false; },
    prepare: async current => { step("prepare"); return { ...current, stage: "data_prepared" }; },
    revokeAndBan: async () => { step("revoke"); },
    deleteAuth: async () => { step("auth"); },
    complete: async current => { step("complete"); return { ...current, stage: "completed", lease_token: null, completed_at: "2026-09-15T12:00:00Z" }; },
    release: async () => { step("release"); },
  };
  return { gateway, calls };
}
test("archivar conserva media y no ejecuta delete Auth", async () => {
  const run = gateway({ data_policy: "retain_history" });
  const result = await executeAccountLifecycle(run.gateway);
  assert.equal(result.stage, "completed");
  assert.deepEqual(run.calls, ["acquire", "prepare", "revoke", "complete", "release"]);
});
test("delete ejecuta manifest/storage, SQL atómico, revoca, Auth y confirma", async () => {
  const run = gateway(); await executeAccountLifecycle(run.gateway);
  assert.deepEqual(run.calls, ["acquire", "manifest", "storage", "manifest", "prepare", "revoke", "auth", "complete", "release"]);
});
for (const failure of ["storage", "prepare", "revoke", "auth"]) test(`${failure} falla: no confirma y libera lease para reintento`, async () => {
  const run = gateway({}, failure); await assert.rejects(executeAccountLifecycle(run.gateway), new RegExp(failure));
  assert.equal(run.calls.includes("complete"), false); assert.equal(run.calls.at(-1), "release");
});
test("reintento data_prepared no repite borrado media/grafo", async () => {
  const run = gateway({ stage: "data_prepared" }); await executeAccountLifecycle(run.gateway);
  assert.deepEqual(run.calls, ["acquire", "revoke", "auth", "complete", "release"]);
});
test("completed idempotente no hace otra operación", async () => {
  const run = gateway({ stage: "completed", lease_token: null }); await executeAccountLifecycle(run.gateway);
  assert.deepEqual(run.calls, ["acquire"]);
});
test("lease ocupado nunca ejecuta una segunda saga", async () => {
  const run = gateway({ lease_token: null }); await assert.rejects(executeAccountLifecycle(run.gateway), /BUSY/);
  assert.deepEqual(run.calls, ["acquire"]);
});
test("la respuesta RPC debe pertenecer a actor/policy/request/lease exactos", () => {
  assert.deepEqual(validateAccountLifecycleJob(base, scope), base);
  for (const invalid of [null, {}, { ...base, user_id: "other" }, { ...base, request_id: "other" }, { ...base, data_policy: "retain_history" }, { ...base, lease_token: "other" }, { ...base, stage: "unknown" }, { ...base, stage: "completed", lease_token: null, completed_at: null }]) {
    assert.throws(() => validateAccountLifecycleJob(invalid, scope), /INVALID_LIFECYCLE_RESPONSE/);
  }
});
test("recovery secret permite mismo request sin aceptar owner arbitrario", () => {
  const input = { confirmation: "ELIMINAR", dataPolicy: "delete_golf_data", requestId: "11111111-1111-4111-8111-111111111111", recoveryToken: "a".repeat(64) };
  assert.equal(parseAccountDeletionChoice(input)?.recoveryToken, input.recoveryToken);
  for (const invalid of [{ ...input, recoveryToken: "short" }, { ...input, userId: "other" }, { ...input, confirmation: "eliminar" }]) assert.equal(parseAccountDeletionChoice(invalid), null);
});
test("lifecycle nunca se activa en Production ni en proyecto compartido", () => {
  const env = { ACCOUNT_LIFECYCLE_ENABLED: "true", PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb", NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co", VERCEL_ENV: "preview" };
  assert.equal(accountLifecycleEnabled(env), true);
  assert.equal(accountLifecycleEnabled({ ...env, PREVIEW_DB_REF: "abcdefghijklmnopqrst", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }), false);
  assert.equal(accountLifecycleEnabled({ ...env, VERCEL_ENV: "production" }), false);
  assert.equal(accountLifecycleEnabled({ ...env, ACCOUNT_LIFECYCLE_ENABLED: "false" }), false);
});
