import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("group email invitations enforce verified identity, privacy, delivery leases and idempotent membership (PostgreSQL)", { timeout: 60_000 }, () => {
  const result=spawnSync(process.execPath,["scripts/test-group-email-invitations-db.mjs"],{cwd:process.cwd(),encoding:"utf8",timeout:55_000});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/GROUP_INVITATIONS_DB PASS: group invitations PostgreSQL checks 14\/14/);
});
