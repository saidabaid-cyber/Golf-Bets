import assert from "node:assert/strict";
import test from "node:test";

import {
  isExactRunOwnedQaUser,
  optionalAuthorizationQaConfig,
} from "./qa-preview-optional-authorizations.mjs";

const QA_REF = "bymeopxkxapfizeeqeyb";
const QA_ORIGIN = "https://dev.thebackyard.com.mx";
const QA_DB = `https://${QA_REF}.supabase.co`;
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function validEnv(overrides = {}) {
  return {
    PREVIEW_DB_REF: QA_REF,
    QA_CONFIRM_ISOLATED_PREVIEW: QA_REF,
    NEXT_PUBLIC_SUPABASE_URL: QA_DB,
    PREVIEW_QA_URL: QA_ORIGIN,
    PREVIEW_QA_EXPECTED_SHA: "a".repeat(40),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(32)}`,
    SUPABASE_SECRET_KEY: `sb_secret_${"s".repeat(32)}`,
    VERCEL_ENV: "preview",
    ...overrides,
  };
}

test("optional-authorization QA config is hard-bound to canonical DEV and the isolated QA project", () => {
  const config = optionalAuthorizationQaConfig(validEnv());
  assert.equal(config.previewOrigin, QA_ORIGIN);
  assert.equal(config.projectRef, QA_REF);
  assert.equal(config.supabaseOrigin, QA_DB);
});

for (const [label, overrides] of [
  ["Production application", { PREVIEW_QA_URL: "https://app.thebackyard.com.mx" }],
  ["non-canonical Preview alias", { PREVIEW_QA_URL: "https://golf-bets-preview.example.vercel.app" }],
  ["Production Supabase project", {
    PREVIEW_DB_REF: "zhqmlpljloumldaczcfp",
    QA_CONFIRM_ISOLATED_PREVIEW: "zhqmlpljloumldaczcfp",
    NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co",
  }],
  ["mismatched isolation confirmation", { QA_CONFIRM_ISOLATED_PREVIEW: "wrong-project-refxxxx" }],
  ["Production Vercel environment", { VERCEL_ENV: "production" }],
  ["non-exact deployment identity", { PREVIEW_QA_EXPECTED_SHA: "a".repeat(39) }],
]) {
  test(`optional-authorization QA refuses ${label}`, () => {
    assert.throws(() => optionalAuthorizationQaConfig(validEnv(overrides)));
  });
}

test("cleanup guard accepts only the exact run-owned example.invalid identity", () => {
  const account = { id: USER_ID, email: `qa-opt-authorize-${RUN_ID}@example.invalid` };
  const user = {
    id: USER_ID,
    email: account.email,
    app_metadata: { qa_run_id: RUN_ID, qa_fixture: "optional-authorizations-v1" },
  };
  assert.equal(isExactRunOwnedQaUser(user, account, RUN_ID), true);
  assert.equal(isExactRunOwnedQaUser({ ...user, id: "33333333-3333-4333-8333-333333333333" }, account, RUN_ID), false);
  assert.equal(isExactRunOwnedQaUser({ ...user, email: "someone@example.com" }, account, RUN_ID), false);
  assert.equal(isExactRunOwnedQaUser({ ...user, app_metadata: { ...user.app_metadata, qa_run_id: "other" } }, account, RUN_ID), false);
  assert.equal(isExactRunOwnedQaUser({ ...user, app_metadata: { ...user.app_metadata, qa_fixture: "other" } }, account, RUN_ID), false);
  assert.equal(isExactRunOwnedQaUser(user, { ...account, email: "real-user@example.com" }, RUN_ID), false);
});
