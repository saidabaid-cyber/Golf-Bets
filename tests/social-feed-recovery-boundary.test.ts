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

test("recovery discovers only viewer-visible sources through user RLS and elevates only the repair", () => {
  const recoveryBlock = source.slice(
    source.indexOf("async function recoverVisibleSources(ctx"),
    source.indexOf("async function recoverVisibleSourcesBestEffort"),
  );

  assert.match(recoveryBlock, /ctx\.client\.from\("friendships"\)/);
  assert.match(recoveryBlock, /ctx\.client\.from\("social_activities_v3"\)/);
  assert.doesNotMatch(recoveryBlock, /ctx\.admin\.from\("friendships"\)/);
  assert.doesNotMatch(recoveryBlock, /ctx\.admin\.from\("social_activities_v3"\)/);
  assert.match(recoveryBlock, /reconcileSocialRoundActivities\(ctx\.admin, authorId\)/);
  assert.match(recoveryBlock, /reconcileSocialEquipmentActivity\(ctx\.admin, authorId\)/);
});

test("an explicit social preference write atomically consumes the offer with its projections", () => {
  const updateBlock = source.slice(
    source.indexOf("export async function updatePreferences"),
    source.indexOf("async function sourceRound"),
  );

  assert.match(updateBlock, /ctx\.client\.rpc\("set_my_social_activity_preferences_v1"/);
  assert.match(updateBlock, /requested_preferences: requestedPreferences/);
  assert.doesNotMatch(updateBlock, /consume_optional_authorization_onboarding_offer_v1/);
  assert.doesNotMatch(updateBlock, /\.from\("social_activity_preferences_v3"\)[\s\S]*?\.upsert\(/);
  assert.doesNotMatch(updateBlock, /\.from\("profiles"\)[\s\S]*?\.update\(/);
});
