import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_QA_APP_ORIGIN, PRODUCTION_APP_ORIGIN, resolveBrowserAppOrigin } from "../lib/app-origin";

const CANONICAL_QA_BRANCH_ALIAS = "https://golf-bets-git-integration-backyard-current-saha8.vercel.app";

test("configured canonical origin must equal the remote browser origin", () => {
  assert.equal(resolveBrowserAppOrigin(CANONICAL_QA_APP_ORIGIN, `${CANONICAL_QA_APP_ORIGIN}/`), CANONICAL_QA_APP_ORIGIN);
  assert.equal(resolveBrowserAppOrigin(CANONICAL_QA_BRANCH_ALIAS, CANONICAL_QA_APP_ORIGIN), CANONICAL_QA_BRANCH_ALIAS);
  assert.equal(resolveBrowserAppOrigin(PRODUCTION_APP_ORIGIN, PRODUCTION_APP_ORIGIN), PRODUCTION_APP_ORIGIN);
  assert.throws(() => resolveBrowserAppOrigin(PRODUCTION_APP_ORIGIN, CANONICAL_QA_APP_ORIGIN), /app_origin_environment_mismatch/);
  assert.throws(() => resolveBrowserAppOrigin(CANONICAL_QA_APP_ORIGIN, PRODUCTION_APP_ORIGIN), /app_origin_environment_mismatch/);
  assert.throws(() => resolveBrowserAppOrigin(CANONICAL_QA_BRANCH_ALIAS, PRODUCTION_APP_ORIGIN), /app_origin_environment_mismatch/);
  assert.throws(() => resolveBrowserAppOrigin("http://golf-bets-git-integration-backyard-current-saha8.vercel.app", CANONICAL_QA_APP_ORIGIN), /invalid_browser_app_origin/);
  assert.throws(() => resolveBrowserAppOrigin("https://synthetic-preview-test-only.vercel.app", CANONICAL_QA_APP_ORIGIN), /app_origin_environment_mismatch/);
  assert.throws(() => resolveBrowserAppOrigin("https://synthetic-preview-test-only.vercel.app", PRODUCTION_APP_ORIGIN), /app_origin_environment_mismatch/);
  assert.throws(() => resolveBrowserAppOrigin("https://evil.example", "https://evil.example"), /unsupported_configured_app_origin/);
});

test("localhost stays local even when a deployed origin is present", () => {
  assert.equal(resolveBrowserAppOrigin("http://localhost:3000", CANONICAL_QA_APP_ORIGIN), "http://localhost:3000");
  assert.equal(resolveBrowserAppOrigin("http://127.0.0.1:3100", PRODUCTION_APP_ORIGIN), "http://127.0.0.1:3100");
});

test("known stable environments work without override and every ambiguous remote origin fails closed", () => {
  assert.equal(resolveBrowserAppOrigin(CANONICAL_QA_APP_ORIGIN), CANONICAL_QA_APP_ORIGIN);
  assert.equal(resolveBrowserAppOrigin(PRODUCTION_APP_ORIGIN), PRODUCTION_APP_ORIGIN);
  for (const origin of ["https://synthetic-preview-test-only.vercel.app", "https://beta.thebackyard.com.mx", "https://example.test"]) {
    assert.throws(() => resolveBrowserAppOrigin(origin), /stable_app_origin_required/);
  }
});

test("configured origins reject paths, query strings, credentials and insecure remote HTTP", () => {
  for (const origin of ["https://dev.thebackyard.com.mx/path", "https://dev.thebackyard.com.mx?x=1", "https://user:pass@dev.thebackyard.com.mx", "http://dev.thebackyard.com.mx"]) {
    assert.throws(() => resolveBrowserAppOrigin(PRODUCTION_APP_ORIGIN, origin), /invalid_configured_app_origin/);
  }
});
