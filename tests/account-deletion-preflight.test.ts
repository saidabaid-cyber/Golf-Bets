import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACCOUNT_DELETION_CONTROLLED_DB_APPLY_PENDING, parseAccountDeletionChoice } from "../lib/account-deletion";

test("el grafo destructivo antiguo permanece cerrado hasta QA de DB aislada", () => {
  assert.equal(ACCOUNT_DELETION_CONTROLLED_DB_APPLY_PENDING, true);
});

test("ambas elecciones tienen barrera explícita pre-write y no borran nada", () => {
  const route = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(route, /authenticatedRequest\(request\)/);
  assert.match(route, /readJsonBodyWithLimit\(request, 1_024\)/);
  assert.match(route, /code: "LEGAL_REVIEW_REQUIRED"/);
  assert.match(route, /code: "PENDING_CONTROLLED_DB_APPLY"/);
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
