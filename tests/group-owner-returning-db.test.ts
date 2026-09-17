import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("groups INSERT RETURNING repairs owner visibility without broadening RLS or grants (PostgreSQL)", { timeout: 60_000 }, () => {
  const result = spawnSync(process.execPath, ["scripts/test-group-owner-returning-db.mjs"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 55_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS: reproduced pre-fix RETURNING failure/);
});
