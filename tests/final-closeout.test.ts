import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();

test("Preview SQL runner rejects a shared Production target and covers every closeout RLS contract", () => {
  const runner = readFileSync(`${root}/scripts/run-preview-rls-tests.mjs`, "utf8");
  const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8")) as { scripts: Record<string, string> };
  for (const file of [
    "equipment_ball_fitting_rls.sql",
    "golf_profile_course_architecture_rls.sql",
    "ai_processing_consents_rls.sql",
    "phase2_social_groups_rls.sql",
    "phase2_course_handicap_rls.sql",
    "phase2_live_rounds_rls.sql",
    "phase2_shots_analytics_rls.sql",
    "phase2_multiuser_authorization_rls.sql",
  ]) assert.match(runner, new RegExp(file.replaceAll(".", "\\.")));
  assert.match(runner, /Preview and Production project refs are identical/);
  assert.match(runner, /connection target does not identify SUPABASE_PREVIEW_PROJECT_REF/);
  assert.doesNotMatch(runner, /console\.log\([^\n]*(?:PASSWORD|DB_URL)/);
  assert.equal(packageJson.scripts["test:rls:preview"], "node scripts/run-preview-rls-tests.mjs");
});

test("membership lookup fails closed unless BETA_PRO is explicitly assigned", async () => {
  const membership = await import("../features/memberships/registry");
  assert.equal(membership.normalizeMembershipPlanId(undefined), "FREE");
  assert.equal(membership.normalizeMembershipPlanId("forged"), "FREE");
  assert.equal(membership.normalizeMembershipPlanId("BETA_PRO"), "BETA_PRO");
  assert.equal(membership.canUseFeature(undefined, "SHOT_TRACKING"), false);
  assert.equal(membership.canUseFeature("BETA_PRO", "SHOT_TRACKING"), true);
});
