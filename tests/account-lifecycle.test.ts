import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountLifecycleStageError,
  accountLifecycleEnabled,
  accountLifecycleFailureResponse,
  accountLifecycleSafeError,
  asAccountLifecycleStageError,
  executeAccountLifecycle,
  validateAccountLifecycleJob,
  type AccountLifecycleGateway,
  type AccountLifecycleJob,
} from "../lib/account-lifecycle";
import { parseAccountDeletionChoice } from "../lib/account-deletion";

const scope = { actor: "actor", requestId: "request", dataPolicy: "delete_golf_data" as const, lease: "lease" };
const base: AccountLifecycleJob = { user_id: scope.actor, request_id: scope.requestId, data_policy: scope.dataPolicy, lease_token: scope.lease, stage: "requested", completed_at: null };
function gateway(initial: Partial<AccountLifecycleJob> = {}, failure?: string) {
  const calls: string[] = []; const observed: Array<{ error: AccountLifecycleStageError; context: { secondary: boolean; operationCompleted: boolean } }> = []; let photos = true;
  const job = { ...base, ...initial };
  const step = (name: string) => { calls.push(name); if (failure === name) throw new Error(name); };
  const gateway: AccountLifecycleGateway = {
    acquire: async () => { step("acquire"); return job; },
    storageBatch: async () => { step("manifest"); return photos ? [{ bucket_id: "photos", name: "actor/avatar.webp" }] : []; },
    removeStorage: async () => { step("storage"); photos = false; },
    prepare: async current => { step("prepare"); return { ...current, stage: "data_prepared" }; },
    revokeAndBan: async () => { step("revoke"); },
    signOut: async () => { step("signout"); },
    deleteAuth: async () => { step("auth"); },
    complete: async current => { step("complete"); return { ...current, stage: "completed", lease_token: null, completed_at: "2026-09-15T12:00:00Z" }; },
    release: async () => { step("release"); },
    observeError: (error, context) => { observed.push({ error, context }); },
  };
  return { gateway, calls, observed };
}
test("archivar conserva media y no ejecuta delete Auth", async () => {
  const run = gateway({ data_policy: "retain_history" });
  const result = await executeAccountLifecycle(run.gateway);
  assert.equal(result.stage, "completed");
  assert.deepEqual(run.calls, ["acquire", "prepare", "revoke", "signout", "complete", "release"]);
});
test("delete ejecuta manifest/storage, SQL atómico, revoca, Auth y confirma", async () => {
  const run = gateway(); await executeAccountLifecycle(run.gateway);
  assert.deepEqual(run.calls, ["acquire", "manifest", "storage", "manifest", "prepare", "revoke", "signout", "auth", "complete", "release"]);
});
for (const [failure, stage] of [["manifest", "storageBatch"], ["storage", "removeStorage"], ["prepare", "prepare"], ["revoke", "revokeAndBan"], ["signout", "signOut"], ["auth", "deleteAuth"], ["complete", "complete"]] as const) test(`${failure} falla: identifica etapa, no confirma y libera lease`, async () => {
  const run = gateway({}, failure);
  let caught: unknown;
  try { await executeAccountLifecycle(run.gateway); } catch (error) { caught = error; }
  assert.ok(caught instanceof AccountLifecycleStageError);
  assert.equal(caught.stage, stage);
  assert.equal(run.calls.includes("complete"), failure === "complete"); assert.equal(run.calls.at(-1), "release");
});
test("reintento data_prepared reconcilia Storage y prepare idempotente", async () => {
  const run = gateway({ stage: "data_prepared" }); await executeAccountLifecycle(run.gateway);
  assert.deepEqual(run.calls, ["acquire", "manifest", "storage", "manifest", "prepare", "revoke", "signout", "auth", "complete", "release"]);
});
test("completed idempotente no hace otra operación", async () => {
  const run = gateway({ stage: "completed", lease_token: null }); await executeAccountLifecycle(run.gateway);
  assert.deepEqual(run.calls, ["acquire"]);
});
test("lease ocupado nunca ejecuta una segunda saga", async () => {
  const run = gateway({ lease_token: null });
  await assert.rejects(executeAccountLifecycle(run.gateway), (error: unknown) => error instanceof AccountLifecycleStageError && error.stage === "acquire" && error.code === "ACCOUNT_OPERATION_BUSY");
  assert.deepEqual(run.calls, ["acquire"]);
});
test("fallo de acquire queda tipado y nunca intenta release sin lease", async () => {
  const run = gateway({}, "acquire");
  await assert.rejects(executeAccountLifecycle(run.gateway), (error: unknown) => error instanceof AccountLifecycleStageError && error.stage === "acquire");
  assert.deepEqual(run.calls, ["acquire"]);
});
test("fallo de release tras completar es observable sin convertir el éxito confirmado en fallo", async () => {
  const run = gateway({}, "release");
  const result = await executeAccountLifecycle(run.gateway);
  assert.equal(result.stage, "completed");
  assert.equal(run.observed.length, 1);
  assert.equal(run.observed[0].error.stage, "release");
  assert.deepEqual(run.observed[0].context, { secondary: false, operationCompleted: true });
});
test("fallo de release no oculta la etapa primaria", async () => {
  const run = gateway({}, "prepare");
  const originalRelease = run.gateway.release;
  run.gateway.release = async job => { await originalRelease(job); throw new Error("release transport details"); };
  let caught: unknown;
  try { await executeAccountLifecycle(run.gateway); } catch (error) { caught = error; }
  assert.ok(caught instanceof AccountLifecycleStageError);
  assert.equal(caught.stage, "prepare");
  assert.equal(run.observed[0].error.stage, "release");
  assert.deepEqual(run.observed[0].context, { secondary: true, operationCompleted: false });
});
test("complete sólo acepta una confirmación final explícita", async () => {
  const run = gateway();
  run.gateway.complete = async current => ({ ...current, stage: "data_prepared" });
  await assert.rejects(executeAccountLifecycle(run.gateway), (error: unknown) => error instanceof AccountLifecycleStageError && error.stage === "complete" && error.code === "INVALID_LIFECYCLE_COMPLETION");
});
test("diagnóstico sanitiza código/clase/status sin retener mensajes ni PII", () => {
  const raw = Object.assign(new Error("owner@example.com bearer-secret"), { code: "", name: "AuthApiError", status: 503 });
  const failure = asAccountLifecycleStageError("deleteAuth", raw);
  assert.deepEqual(accountLifecycleSafeError(failure), { stage: "deleteAuth", code: "ACCOUNT_LIFECYCLE_FAILED", errorClass: "AuthApiError", status: 503 });
  const serialized = JSON.stringify(failure);
  assert.doesNotMatch(serialized, /owner@example|bearer-secret/);
});
test("contrato HTTP diferencia conflicto, lease, storage, datos, Auth y finalización", () => {
  const cases = [
    [new AccountLifecycleStageError("acquire", { code: "23505", errorClass: "PostgrestError" }), 409, "ACCOUNT_REQUEST_CONFLICT"],
    [new AccountLifecycleStageError("acquire", { code: "ACCOUNT_OPERATION_BUSY", errorClass: "LeaseError" }), 409, "ACCOUNT_OPERATION_BUSY"],
    [new AccountLifecycleStageError("storageBatch", { code: "57014", errorClass: "PostgrestError" }), 503, "ACCOUNT_STORAGE_PENDING"],
    [new AccountLifecycleStageError("removeStorage", { code: "StorageUnknownError", errorClass: "StorageError" }), 503, "ACCOUNT_STORAGE_PENDING"],
    [new AccountLifecycleStageError("prepare", { code: "23503", errorClass: "PostgrestError" }), 503, "ACCOUNT_DATA_CLEANUP_PENDING"],
    [new AccountLifecycleStageError("revokeAndBan", { code: "unexpected_failure", errorClass: "AuthApiError" }), 503, "ACCOUNT_AUTH_PENDING"],
    [new AccountLifecycleStageError("signOut", { code: "unexpected_failure", errorClass: "AuthApiError" }), 503, "ACCOUNT_AUTH_PENDING"],
    [new AccountLifecycleStageError("deleteAuth", { code: "unexpected_failure", errorClass: "AuthApiError" }), 503, "ACCOUNT_AUTH_PENDING"],
    [new AccountLifecycleStageError("complete", { code: "42501", errorClass: "PostgrestError" }), 503, "ACCOUNT_FINALIZATION_PENDING"],
    [new AccountLifecycleStageError("release", { code: "57014", errorClass: "PostgrestError" }), 503, "ACCOUNT_FINALIZATION_PENDING"],
    [new AccountLifecycleStageError("authenticate", { code: "AUTH_REQUIRED", errorClass: "AuthenticationFailure", status: 401 }), 401, "AUTH_REQUIRED"],
    [new AccountLifecycleStageError("recover", { code: "57014", errorClass: "PostgrestError", status: 504 }), 503, "ACCOUNT_RECOVERY_PENDING"],
  ] as const;
  for (const [error, status, code] of cases) {
    const response = accountLifecycleFailureResponse(error);
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
  }
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
