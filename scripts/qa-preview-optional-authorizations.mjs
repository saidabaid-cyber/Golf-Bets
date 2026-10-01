import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  CANONICAL_QA_ORIGIN,
  CANONICAL_QA_PROJECT,
  credentialBoundFetch,
  previewStatisticsConfig,
  verifyPreviewBundleBinding,
  verifyPreviewDeploymentIdentity,
} from "./qa-preview-statistics.mjs";

const BUNDLE_VERSION = "optional-features-2026-09-30-v1";
const FIXTURE_KIND = "optional-authorizations-v1";
const SCOPES = [
  "AI_PROVIDER_PROCESSING_CONSENT",
  "AI_IMAGE_PROCESSING_CONSENT",
  "AI_LAUNCH_MONITOR_PROCESSING_CONSENT",
  "PERSONAL_MEMORY",
  "GLOBAL_LEARNING",
  "LOCATION_INTERNAL",
  "NOTIFICATION_INTERNAL",
];
const AI_SCOPES = SCOPES.slice(0, 3);
const POLICY_VERSIONS = Object.freeze({
  AI_PROVIDER_PROCESSING_CONSENT: "2026-09-08-v2",
  AI_IMAGE_PROCESSING_CONSENT: "2026-09-08-v2",
  AI_LAUNCH_MONITOR_PROCESSING_CONSENT: "2026-09-08-v2",
  PERSONAL_MEMORY: "ai-first-phase1-v1",
  GLOBAL_LEARNING: "ai-first-phase1-v1",
  LOCATION_INTERNAL: BUNDLE_VERSION,
  NOTIFICATION_INTERNAL: BUNDLE_VERSION,
});

export function optionalAuthorizationQaConfig(env = process.env) {
  const config = previewStatisticsConfig(env);
  assert.equal(config.previewOrigin, CANONICAL_QA_ORIGIN,
    "Optional-authorization QA is hard-bound to the canonical DEV origin.");
  assert.equal(config.projectRef, CANONICAL_QA_PROJECT,
    "Optional-authorization QA is hard-bound to the isolated QA Supabase project.");
  assert.equal(config.supabaseOrigin, `https://${CANONICAL_QA_PROJECT}.supabase.co`,
    "Optional-authorization QA is hard-bound to the isolated QA Supabase origin.");
  return config;
}

function checked(result, label) {
  if (result.error) {
    const code = String(result.error.code || result.error.status || "unknown")
      .replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
    throw new Error(`${label} failed (${code}).`);
  }
  return result.data;
}

function everyBoolean(value, expected) {
  return value && typeof value === "object"
    && Object.values(value).length > 0
    && Object.values(value).every((item) => item === expected);
}

function assertInitialState(state) {
  assert.equal(state?.bundleVersion, BUNDLE_VERSION);
  assert.equal(state?.resolved, false);
  assert.equal(state?.eligible, true);
  assert.equal(state?.receipt, null);
  assert.deepEqual(Object.keys(state?.scopes || {}).sort(), [...SCOPES].sort());
  for (const scope of SCOPES) {
    assert.equal(state.scopes[scope]?.active, false);
    assert.equal(state.scopes[scope]?.status, "missing");
    assert.equal(state.scopes[scope]?.policyVersion, POLICY_VERSIONS[scope]);
    assert.equal(state.scopes[scope]?.source, null);
    assert.equal(state.scopes[scope]?.decidedAt, null);
  }
  assert.equal(state.profileVisibility, "private");
  assert.equal(state.socialPrivacy, "PRIVATE");
  assert.equal(state.socialProfilePrivacy, "PRIVATE");
  assert.ok(everyBoolean(state.sharing, false));
  assert.ok(everyBoolean(state.notifications, false));
}

function assertResolvedState(state, action, idempotencyKey) {
  const enabled = action === "authorize_all";
  assert.equal(state?.bundleVersion, BUNDLE_VERSION);
  assert.equal(state?.resolved, true);
  assert.equal(state?.eligible, false);
  assert.equal(state?.receipt?.action, action);
  assert.equal(state?.receipt?.idempotencyKey, idempotencyKey);
  assert.ok(Number.isFinite(Date.parse(state?.receipt?.decidedAt)), "receipt has a canonical timestamp");
  assert.deepEqual(Object.keys(state?.scopes || {}).sort(), [...SCOPES].sort());
  for (const scope of SCOPES) {
    assert.equal(state.scopes[scope]?.active, enabled);
    assert.equal(state.scopes[scope]?.status, enabled ? "accepted" : "declined");
    assert.equal(state.scopes[scope]?.policyVersion, POLICY_VERSIONS[scope]);
    assert.equal(state.scopes[scope]?.source,
      enabled ? "onboarding_authorize_all" : "onboarding_decline_all");
    assert.ok(Number.isFinite(Date.parse(state.scopes[scope]?.decidedAt)), `${scope} has a decision timestamp`);
  }
  assert.equal(state.profileVisibility, enabled ? "public" : "private");
  assert.equal(state.socialPrivacy, enabled ? "FRIENDS" : "PRIVATE");
  assert.equal(state.socialProfilePrivacy, enabled ? "PUBLIC" : "PRIVATE");
  assert.ok(everyBoolean(state.sharing, enabled));
  assert.ok(everyBoolean(state.notifications, enabled));
}

export function isExactRunOwnedQaUser(user, account, runId) {
  return Boolean(user
    && account
    && user.id === account.id
    && user.email === account.email
    && account.email.endsWith("@example.invalid")
    && user.app_metadata?.qa_run_id === runId
    && user.app_metadata?.qa_fixture === FIXTURE_KIND);
}

async function boundedJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 2_000_000) throw new Error("Optional-authorization API response exceeded the QA limit.");
  try { return JSON.parse(raw); }
  catch { throw new Error("Optional-authorization API did not return JSON."); }
}

/**
 * End-to-end QA against the canonical DEV alias and isolated Supabase branch.
 * It creates exactly two random example.invalid accounts and accepts no
 * existing user identity as input.
 */
export async function runPreviewOptionalAuthorizationsQA(
  env = process.env,
  { fetcher = fetch, clientFactory = createClient, log = console.log } = {},
) {
  const config = optionalAuthorizationQaConfig(env);
  const appFetch = credentialBoundFetch(config.previewOrigin, fetcher);
  const databaseFetch = credentialBoundFetch(config.supabaseOrigin, fetcher);
  await verifyPreviewBundleBinding(config, appFetch, databaseFetch);

  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: databaseFetch },
  };
  const admin = clientFactory(config.supabaseOrigin, config.secretKey, clientOptions);
  const runId = randomUUID();
  const accounts = [];
  const passed = [];
  const retainedQaUserIds = [];
  let stage = "CREATE_RUN_OWNED_ACCOUNTS";
  let diagnostic = null;
  let failure = null;

  async function app(account, method = "GET", body) {
    if (!account?.token) throw new Error("QA account has no authenticated session.");
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      await verifyPreviewDeploymentIdentity(config, appFetch);
    }
    const response = await appFetch(`${config.previewOrigin}/api/account/optional-authorizations`, {
      method,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${account.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(config.bypass ? { "x-vercel-protection-bypass": config.bypass } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await boundedJson(response);
    if (response.status !== 200) {
      diagnostic = {
        stage,
        method,
        status: response.status,
        code: typeof data?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(data.code)
          ? data.code : "UNEXPECTED_RESPONSE",
      };
      throw new Error(`Optional-authorization API failed (HTTP ${response.status}).`);
    }
    return data;
  }

  async function signInFresh(account) {
    const client = clientFactory(config.supabaseOrigin, config.publicKey, clientOptions);
    const signedIn = checked(await client.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    }), "Fresh QA password login");
    assert.equal(signedIn.user?.id, account.id);
    assert.ok(signedIn.session?.access_token, "fresh QA session has an access token");
    account.token = signedIn.session.access_token;
    account.client = client;
  }

  async function createAccount(label, action) {
    const account = {
      id: randomUUID(),
      email: `qa-opt-${label}-${runId}@example.invalid`,
      password: `Qa!${randomBytes(32).toString("base64url")}`,
      action,
      token: null,
      client: null,
    };
    accounts.push(account);
    await verifyPreviewDeploymentIdentity(config, appFetch);
    const created = checked(await admin.auth.admin.createUser({
      id: account.id,
      email: account.email,
      password: account.password,
      email_confirm: true,
      app_metadata: { qa_run_id: runId, qa_fixture: FIXTURE_KIND },
      user_metadata: { display_name: `Optional authorization QA ${label}` },
    }), "Create run-owned optional-authorization QA account");
    assert.equal(created.user?.id, account.id);
    await signInFresh(account);
    return account;
  }

  async function verifyCanonicalRows(account, idempotencyKey) {
    const enabled = account.action === "authorize_all";
    const receipts = checked(await admin.from("optional_authorization_bundle_receipts")
      .select("user_id,bundle_version,action,idempotency_key,decided_at")
      .eq("user_id", account.id), "Read isolated optional-authorization receipt");
    assert.equal(receipts.length, 1, "one bundle receipt per QA account");
    assert.equal(receipts[0].bundle_version, BUNDLE_VERSION);
    assert.equal(receipts[0].action, account.action);
    assert.equal(receipts[0].idempotency_key, idempotencyKey);

    const events = checked(await admin.from("optional_authorization_events")
      .select("scope,decision_status,policy_version,source,bundle_version,idempotency_key")
      .eq("user_id", account.id), "Read isolated optional-authorization events");
    assert.equal(events.length, SCOPES.length, "one event per bundle scope");
    assert.deepEqual([...new Set(events.map((row) => row.scope))].sort(), [...SCOPES].sort());
    for (const event of events) {
      assert.equal(event.decision_status, enabled ? "accepted" : "declined");
      assert.equal(event.policy_version, POLICY_VERSIONS[event.scope]);
      assert.equal(event.source, enabled ? "onboarding_authorize_all" : "onboarding_decline_all");
      assert.equal(event.bundle_version, BUNDLE_VERSION);
      assert.equal(event.idempotency_key, idempotencyKey);
    }

    const ai = checked(await admin.from("ai_processing_consents")
      .select("scope,decision_status,policy_version,source")
      .eq("user_id", account.id), "Read isolated AI consent projection");
    assert.equal(ai.length, AI_SCOPES.length, "one AI projection per AI scope");
    assert.deepEqual([...new Set(ai.map((row) => row.scope))].sort(), [...AI_SCOPES].sort());
    for (const decision of ai) {
      assert.equal(decision.decision_status, enabled ? "accepted" : "declined");
      assert.equal(decision.policy_version, POLICY_VERSIONS[decision.scope]);
      assert.equal(decision.source, "onboarding");
    }
  }

  async function proveAction(account) {
    stage = `${account.action.toUpperCase()}_INITIAL_GET`;
    assertInitialState(await app(account));

    const idempotencyKey = randomUUID();
    const request = { action: account.action, bundleVersion: BUNDLE_VERSION, idempotencyKey };
    stage = `${account.action.toUpperCase()}_POST`;
    const saved = await app(account, "POST", request);
    assertResolvedState(saved, account.action, idempotencyKey);

    stage = `${account.action.toUpperCase()}_EXACT_REPLAY`;
    const replayed = await app(account, "POST", request);
    assertResolvedState(replayed, account.action, idempotencyKey);
    assert.deepEqual(replayed, saved, "exact replay returns the original committed result");

    stage = `${account.action.toUpperCase()}_GET_AFTER_SAVE`;
    assert.deepEqual(await app(account), saved, "GET returns the committed bundle result");

    stage = `${account.action.toUpperCase()}_SERVICE_ROLE_DEDUPE`;
    await verifyCanonicalRows(account, idempotencyKey);

    stage = `${account.action.toUpperCase()}_FRESH_LOGIN_GET`;
    checked(await account.client.auth.signOut({ scope: "local" }), "Sign out disposable QA session");
    account.token = null;
    await signInFresh(account);
    assert.deepEqual(await app(account), saved, "fresh login returns the committed bundle result");

    stage = `${account.action.toUpperCase()}_FINAL_DEDUPE`;
    await verifyCanonicalRows(account, idempotencyKey);
    passed.push(account.action === "authorize_all"
      ? "AUTHORIZE_ALL_REPLAY_RELOAD_LOGIN"
      : "DECLINE_ALL_REPLAY_RELOAD_LOGIN");
  }

  try {
    const authorize = await createAccount("authorize", "authorize_all");
    const decline = await createAccount("decline", "decline_all");
    passed.push("TWO_FRESH_EXAMPLE_INVALID_ACCOUNTS");
    await proveAction(authorize);
    await proveAction(decline);
    passed.push("CANONICAL_ROWS_NO_DUPLICATES");
  } catch (error) {
    failure = error instanceof Error ? error : new Error("Optional-authorization QA failed.");
  } finally {
    for (const account of accounts) {
      try {
        assert.equal(optionalAuthorizationQaConfig(env).projectRef, CANONICAL_QA_PROJECT);
        const lookup = await admin.auth.admin.getUserById(account.id);
        if (lookup.error?.status === 404 || (!lookup.error && !lookup.data.user)) continue;
        const user = checked(lookup, "Read QA cleanup identity").user;
        assert.ok(isExactRunOwnedQaUser(user, account, runId), "QA cleanup identity ownership proof");
        checked(await admin.auth.admin.deleteUser(account.id), "Delete exact run-owned QA account");
        const absence = await admin.auth.admin.getUserById(account.id);
        assert.ok(absence.error?.status === 404 || (!absence.error && !absence.data.user),
          "run-owned QA account cleanup verified");
      } catch {
        retainedQaUserIds.push(account.id);
      }
    }
  }

  if (!failure) {
    try { await verifyPreviewDeploymentIdentity(config, appFetch); }
    catch { failure = new Error("Canonical DEV deployment identity changed during QA."); stage = "FINAL_DEPLOYMENT_IDENTITY"; }
  }

  const report = {
    preview: config.previewOrigin,
    projectRef: config.projectRef,
    passed,
    ...(failure ? { failedAt: stage, diagnostic } : {}),
    cleanup: retainedQaUserIds.length ? "QA_CLEANUP_PENDING" : "COMPLETE",
    ...(retainedQaUserIds.length ? { retainedQaUserIds } : {}),
  };
  log(JSON.stringify(report));
  if (failure) {
    throw new Error(`Optional-authorization remote QA failed at ${stage}. Credentials and response bodies were not logged.`);
  }
  if (retainedQaUserIds.length) {
    throw new Error("Optional-authorization checks passed, but exact run-owned QA account cleanup is pending.");
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (!args.length || (args.length === 1 && args[0] === "--help")) {
      console.log([
        "Canonical DEV optional-authorization QA (two disposable example.invalid accounts).",
        `Hard-bound application: ${CANONICAL_QA_ORIGIN}`,
        `Hard-bound Supabase project: ${CANONICAL_QA_PROJECT}`,
        "Set PREVIEW_QA_EXPECTED_SHA to the exact deployed commit and the same guarded variables used by qa-preview-statistics.mjs.",
        "Validate offline: node scripts/qa-preview-optional-authorizations.mjs --check-config",
        "Execute remotely: node scripts/qa-preview-optional-authorizations.mjs --run",
        "Never use Production credentials. Cleanup targets only identities carrying this run's exact marker.",
      ].join("\n"));
    } else if (args.length === 1 && args[0] === "--check-config") {
      const config = optionalAuthorizationQaConfig();
      console.log(JSON.stringify({ configuration: "VALID", network: "NOT_RUN", preview: config.previewOrigin,
        projectRef: config.projectRef }));
    } else if (args.length === 1 && args[0] === "--run") {
      await runPreviewOptionalAuthorizationsQA();
    } else {
      throw new Error("Use --help, --check-config or --run; no network request was made.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Optional-authorization Preview QA failed.");
    process.exitCode = 1;
  }
}
