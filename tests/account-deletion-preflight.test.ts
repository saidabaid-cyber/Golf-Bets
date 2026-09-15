import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ACCOUNT_DELETION_CONTROLLED_DB_APPLY_PENDING } from "../lib/account-deletion";

test("el grafo destructivo antiguo permanece cerrado hasta QA de DB aislada", () => {
  assert.equal(ACCOUNT_DELETION_CONTROLLED_DB_APPLY_PENDING, true);
});

test("endpoint verifica grafo compartido antes de audit insert y borrado físico", () => {
  const route = readFileSync("app/api/account/delete/route.ts", "utf8");
  const guard = route.indexOf("ACCOUNT_DELETION_CONTROLLED_DB_APPLY_PENDING)");
  const audit = route.indexOf('from("product_usage_events_v2").insert');
  const deletion = route.indexOf("deleteAccountGraph(");
  assert.ok(guard >= 0 && guard < audit && audit < deletion);
});
