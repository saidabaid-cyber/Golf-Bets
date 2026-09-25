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
    "user_statistics_reset_rls.sql",
    "phase2_multiuser_authorization_rls.sql",
    "owner_user_search_rls.sql",
    "group_round_presets_rls.sql",
    "admin_control_center_rls.sql",
    "account_entry_rls.sql",
    "ghin_provider_foundation_rls.sql",
    "legal_evidence_events_rls.sql",
    "feedback_requests_rls.sql",
  ]) assert.match(runner, new RegExp(file.replaceAll(".", "\\.")));
  assert.match(runner, /Preview and Production project refs are identical/);
  assert.match(runner, /connection host\/user do not exactly identify the Preview project/);
  assert.match(runner, /sslmode=verify-full/);
  assert.match(runner, /SUPABASE_PREVIEW_DB_SSLROOTCERT/);
  assert.match(runner, /SAFE_PROCESS_ENVIRONMENT/);
  assert.doesNotMatch(runner, /console\.log\([^\n]*(?:PASSWORD|DB_URL)/);
  assert.equal(packageJson.scripts["test:rls:preview"], "node scripts/run-preview-rls-tests.mjs");
});

test("static asset/origin audit covers operational docs, env examples, workflows and relative assets", () => {
  const audit = readFileSync(`${root}/scripts/audit-static-assets.mjs`, "utf8");
  assert.match(audit, /"\.github", "app", "data", "docs", "lib", "scripts", "public"/);
  for (const extension of [".example", ".md", ".yaml", ".yml"]) assert.match(audit, new RegExp(extension.replace(".", "\\.")));
  assert.match(audit, /unquotedCssAssetPattern/);
  assert.match(audit, /markdownAssetPattern/);
  assert.match(audit, /recordReference/);
  assert.match(audit, /hardcodedVercelUrlPattern/);
});

test("membership lookup fails closed unless BETA_PRO is explicitly assigned", async () => {
  const membership = await import("../features/memberships/registry");
  assert.equal(membership.normalizeMembershipPlanId(undefined), "FREE");
  assert.equal(membership.normalizeMembershipPlanId("forged"), "FREE");
  assert.equal(membership.normalizeMembershipPlanId("BETA_PRO"), "BETA_PRO");
  assert.equal(membership.canUseFeature(undefined, "SHOT_TRACKING"), false);
  assert.equal(membership.canUseFeature("BETA_PRO", "SHOT_TRACKING"), true);
});

test("brand lockup relies on real image/text semantics instead of invalid ARIA on a div", () => {
  const lockup = readFileSync(`${root}/app/components/brand-lockup.tsx`, "utf8");
  assert.match(lockup, /alt="THE BACKYARD"/);
  assert.doesNotMatch(lockup, /className=\{`backyardBrand[^\n]+aria-label/);
});
