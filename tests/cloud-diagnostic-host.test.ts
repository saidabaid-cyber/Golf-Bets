import test from "node:test";
import assert from "node:assert/strict";
import { cloudDiagnosticHostAllowed, cloudDiagnosticPreviewHost } from "../lib/cloud-diagnostic-host";
test("console diagnostics permit only canonical DEV and the exact integration preview baked by the build", () => {
  const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "integration/backyard-current", VERCEL_URL: "golf-bets-fixture-saha8.vercel.app" };
  const host = cloudDiagnosticPreviewHost(env);
  assert.equal(host, env.VERCEL_URL);
  assert.equal(cloudDiagnosticHostAllowed(host, host), true);
  assert.equal(cloudDiagnosticHostAllowed("dev.thebackyard.com.mx"), true);
  for (const candidate of ["app.thebackyard.com.mx", "beta.thebackyard.com.mx", "unrelated.vercel.app", `${host}.attacker.test`])
    assert.equal(cloudDiagnosticHostAllowed(candidate, host), false);
  for (const patch of [{ VERCEL_ENV: "production" }, { VERCEL_GIT_COMMIT_REF: "main" }, { VERCEL_GIT_COMMIT_REF: "beta" }, { VERCEL_GIT_COMMIT_REF: "feature/course-master" }, { VERCEL_URL: "https://golf-bets-fixture-saha8.vercel.app" }])
    assert.equal(cloudDiagnosticPreviewHost({ ...env, ...patch }), "");
});
