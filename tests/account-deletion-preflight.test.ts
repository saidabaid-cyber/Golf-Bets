import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAccountDeletionChoice } from "../lib/account-deletion";
import { accountLifecycleEnabled } from "../lib/account-lifecycle";

test("ciclo de cuentas exige feature flag y DB Preview aislada", () => {
  assert.equal(accountLifecycleEnabled({}), false);
  assert.equal(accountLifecycleEnabled({ ACCOUNT_LIFECYCLE_ENABLED: "true", PREVIEW_DB_REF: "zhqmlpljloumldaczcfp", NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co", VERCEL_ENV: "preview" }), false);
});

test("ambas elecciones usan saga real sólo después de confirmación y aislamiento", () => {
  const route = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(route, /authenticatedRequest\(request, \{ allowLifecycleRecovery: true \}\)/);
  assert.match(route, /readJsonBodyWithLimit\(request, 1_024\)/);
  assert.match(route, /legalReview: "LEGAL_REVIEW_REQUIRED"/);
  assert.match(route, /code: "CONTROLLED_DB_ACTION_REQUIRED"/);
  assert.match(route, /await executeAccountLifecycle\(/);
  assert.equal((route.match(/noDataDeleted: true/g) || []).length, 2);
  assert.doesNotMatch(route, /deleteAccountGraph\(|\.insert\(|\.delete\(|\.remove\(|deleteUser\(/);
});

test("elección de cuenta exige ELIMINAR, policy y clave idempotente sin owner payload", () => {
  const value = { confirmation: "ELIMINAR", dataPolicy: "retain_history", requestId: "11111111-1111-4111-8111-111111111111" };
  assert.deepEqual(parseAccountDeletionChoice(value), { dataPolicy: "retain_history", requestId: value.requestId });
  assert.deepEqual(parseAccountDeletionChoice({ ...value, dataPolicy: "delete_golf_data" }), { dataPolicy: "delete_golf_data", requestId: value.requestId });
  for (const invalid of [{ ...value, confirmation: "eliminar" }, { ...value, requestId: "bad" }, { ...value, userId: "different" }, { ...value, dataPolicy: "keep_forever" }]) {
    assert.equal(parseAccountDeletionChoice(invalid), null);
  }
});
