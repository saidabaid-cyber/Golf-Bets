import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("lib/social-activity.server.ts", "utf8");

test("feed recovery is best-effort and cannot convert an authorized feed read into a 503", () => {
  const listActivityBlock = source.slice(
    source.indexOf("export async function listActivity"),
    source.indexOf("export async function getActivity"),
  );

  assert.match(source, /async function recoverVisibleSourcesBestEffort/);
  assert.match(source, /try\s*{\s*await recoverVisibleSources\(ctx\);/);
  assert.match(source, /catch \(error\)[\s\S]*backyard_social_recovery_deferred/);
  assert.match(listActivityBlock, /await recoverVisibleSourcesBestEffort\(ctx\);/);
  assert.doesNotMatch(listActivityBlock, /await recoverVisibleSources\(ctx\);/);
});
