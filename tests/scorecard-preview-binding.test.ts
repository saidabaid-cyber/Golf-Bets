import assert from "node:assert/strict";
import test from "node:test";
import { scorecardPreviewBinding } from "../lib/scorecard-preview-binding";

const env = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "ux/scorecard-premium-v1",
  VERCEL_BRANCH_URL: "golf-bets-git-ux-scorecard-premium-v1-saha8.vercel.app", CLOUD_ENABLED: "true", AUTH_SOCIAL_ENABLED: "true",
  PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb", NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co", ADMIN_MODE_V2_ENABLED: "false" };
test("scorecard Preview binding requires the exact authorized build, branch, origin and DEV project", () => {
  assert.deepEqual(scorecardPreviewBinding(env), { ref: env.PREVIEW_DB_REF, target: "dev", branchOrigin: `https://${env.VERCEL_BRANCH_URL}` });
  for (const key of Object.keys(env).filter(key => key !== "ADMIN_MODE_V2_ENABLED")) {
    assert.equal(scorecardPreviewBinding({ ...env, [key]: "" }), null, key);
  }
  for (const branch of ["main", "beta", "integration/backyard-current", "ux/scorecard-premium-v1-other"]) {
    assert.equal(scorecardPreviewBinding({ ...env, VERCEL_GIT_COMMIT_REF: branch }), null);
  }
  for (const patch of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" },
    { VERCEL_BRANCH_URL: `${env.VERCEL_BRANCH_URL}.example.com` }, { VERCEL_BRANCH_URL: "dev.thebackyard.com.mx" },
    { PREVIEW_DB_REF: "zhqmlpljloumldaczcfp" }, { NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: `${env.NEXT_PUBLIC_SUPABASE_URL}/` }]) assert.equal(scorecardPreviewBinding({ ...env, ...patch }), null);
  assert.equal(scorecardPreviewBinding({}), null);
});
