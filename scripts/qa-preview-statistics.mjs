import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SHARED_PROJECT = "zhqmlpljloumldaczcfp";
const REF = /^[a-z0-9]{20}$/;
const DEPLOYMENT = /^golf-bets-[a-z0-9]{9}-[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app$/;
const require = createRequire(import.meta.url);

function exactOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an explicit HTTPS origin.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an explicit HTTPS origin without credentials, path or query.`);
  }
  return url;
}

function boundKey(key, projectRef, role, name) {
  if (!key || typeof key !== "string") throw new Error(`${name} is required.`);
  const modernPrefix = role === "anon" ? "sb_publishable_" : "sb_secret_";
  if (key.startsWith(modernPrefix) && key.length >= 24) return key;
  // Legacy JWT claims are checked only as an additional configuration guard;
  // Supabase still authenticates every actual request cryptographically.
  try {
    const parts = key.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (parts.length === 3 && claims.ref === projectRef && claims.role === role) return key;
  } catch { /* Refuse malformed or wrong-project credentials without echoing them. */ }
  throw new Error(`${name} is malformed or not bound to the expected Preview project/role.`);
}

/** Pure validation. --check-config calls this without making any network request. */
export function previewStatisticsConfig(env = process.env) {
  const projectRef = env.PREVIEW_DB_REF || "";
  if (!REF.test(projectRef) || projectRef === SHARED_PROJECT) throw new Error("Refusing QA: PREVIEW_DB_REF must identify a distinct isolated Preview project.");
  if (env.QA_CONFIRM_ISOLATED_PREVIEW !== projectRef) throw new Error("Set QA_CONFIRM_ISOLATED_PREVIEW to the exact isolated PREVIEW_DB_REF after verifying its identity.");
  if ((env.VERCEL_ENV && env.VERCEL_ENV !== "preview") || (env.VERCEL && env.VERCEL_ENV !== "preview")) {
    throw new Error("Refusing QA from a non-Preview Vercel environment.");
  }
  const supabase = exactOrigin(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  if (supabase.hostname !== `${projectRef}.supabase.co`) throw new Error("Refusing QA: Supabase URL and isolated Preview project ref differ.");
  const preview = exactOrigin(env.PREVIEW_QA_URL, "PREVIEW_QA_URL");
  if (!DEPLOYMENT.test(preview.hostname) || preview.hostname.includes("-git-")) {
    throw new Error("PREVIEW_QA_URL must be the exact immutable golf-bets-<9-character-deployment>-<scope>.vercel.app URL, not a branch, production or custom-domain alias.");
  }
  const publicKey = boundKey(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    projectRef, "anon", "Preview publishable/anon key");
  const secretKey = boundKey(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    projectRef, "service_role", "Preview secret/service-role key");
  return Object.freeze({ projectRef, previewOrigin: preview.origin, supabaseOrigin: supabase.origin, publicKey, secretKey,
    bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET || "" });
}

/** A client gets exactly one credential destination. No redirects, including
 * same-origin redirects, are followed with Auth, API keys or passwords. */
export function credentialBoundFetch(origin, fetcher = fetch) {
  return async (input, init = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    let target;
    try { target = new URL(raw); } catch { throw new Error("QA request target is invalid."); }
    if (target.origin !== origin || target.username || target.password) throw new Error("QA credential destination mismatch.");
    const signals = [AbortSignal.timeout(35_000), init.signal || (input instanceof Request ? input.signal : null)].filter(Boolean);
    let response;
    try { response = await fetcher(input, { ...init, redirect: "error", signal: AbortSignal.any(signals) }); }
    catch { throw new Error("QA request failed or timed out; redirect following is disabled."); }
    if (response.status >= 300 && response.status < 400) throw new Error("QA refused an HTTP redirect.");
    return response;
  };
}

function checked(result, label) {
  if (result.error) throw new Error(`${label} failed${result.error.status ? ` (HTTP ${result.error.status})` : ""}.`);
  return result.data;
}

function assertStep(condition, label) {
  if (!condition) throw new Error(`QA assertion failed: ${label}.`);
}

async function limitedText(response, maxBytes = 5_000_000, allowError = false) {
  if ((!response.ok && !allowError) || !response.body) throw new Error(`Preview content could not be read (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Preview content exceeds the bounded QA inspection limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function verifyPreviewBundleBinding(config, appFetch) {
  const headers = config.bypass ? { "x-vercel-protection-bypass": config.bypass } : {};
  const html = await limitedText(await appFetch(config.previewOrigin, { headers }));
  if (html.includes(`${SHARED_PROJECT}.supabase.co`)) throw new Error("Refusing QA: Preview HTML references the shared Supabase project.");
  let matched = html.includes(config.supabaseOrigin);
  const scripts = [...new Set([...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]))];
  if (scripts.length > 48) throw new Error("Preview bundle inspection limit exceeded; verify deployment binding before QA.");
  for (const src of scripts) {
    const url = new URL(src.replaceAll("&amp;", "&"), config.previewOrigin);
    if (url.origin !== config.previewOrigin || !url.pathname.startsWith("/_next/static/") || !url.pathname.endsWith(".js")) continue;
    const content = await limitedText(await appFetch(url, { headers }));
    if (content.includes(`${SHARED_PROJECT}.supabase.co`)) throw new Error("Refusing QA: a browser bundle references the shared Supabase project.");
    matched ||= content.includes(config.supabaseOrigin);
  }
  if (!matched) throw new Error("Preview browser bundle did not prove the isolated Supabase URL. No QA user was created.");
}

function capturedRound(userId, id, completedAt) {
  const playerId = `qa-player-${userId}`;
  const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
  return { id, lifecycleState: "completed", date: completedAt.slice(0, 10), completedAt,
    startedAt: completedAt, ownerId: playerId, ownerName: "Statistics QA", accountUserId: userId,
    courseName: "QA synthetic course — not a real course", teeName: "QA unverified tee", roundHoles: 18,
    courseSnapshot: { id: `qa-course-${id}`, name: "QA synthetic course — not a real course", teeName: "QA unverified tee", holes },
    players: [{ id: playerId, accountUserId: userId, name: "Statistics QA", handicap: 0 }], order: holes.map(hole => hole.number),
    scores: Object.fromEntries(holes.map(hole => [hole.number, { [playerId]: 4 }])),
    putts: Object.fromEntries(holes.map(hole => [hole.number, { [playerId]: 2 }])),
    advancedStats: { 1: { [playerId]: { greenSideBunkerCount: 1, penaltyHazardCount: 1, teeDirection: "left" } } },
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0, betResult: 100, netResult: 100, categoryResults: {} };
}

/** Never accepts an existing user ID. Every mutable entity belongs to fresh
 * random, email-confirmed example.invalid accounts created in this run. */
export async function runPreviewStatisticsQA(env = process.env, { fetcher = fetch, clientFactory = createClient, log = console.log } = {}) {
  const config = previewStatisticsConfig(env);
  let analytics;
  try {
    analytics = { ...require("../.test-dist/lib/statistics-reset.js"), ...require("../.test-dist/lib/golf-insights.js") };
  } catch { throw new Error("Compile current app logic first: node node_modules/typescript/bin/tsc -p tsconfig.test.json"); }
  const databaseFetch = credentialBoundFetch(config.supabaseOrigin, fetcher);
  const appFetch = credentialBoundFetch(config.previewOrigin, fetcher);
  await verifyPreviewBundleBinding(config, appFetch);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: databaseFetch } };
  const admin = clientFactory(config.supabaseOrigin, config.secretKey, options);
  const runId = randomUUID();
  const attempts = [];
  const passed = [];
  const retainedIds = [];
  let failure = null;
  let stage = "ZERO_ACCOUNT";
  let diagnostic = null;

  async function app(path, token, method = "GET", body) {
    const response = await appFetch(`${config.previewOrigin}${path}`, { method, cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
        ...(config.bypass ? { "x-vercel-protection-bypass": config.bypass } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await limitedText(response, 2_000_000, true);
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Preview API ${path} did not return JSON.`); }
    if (!response.ok) {
      diagnostic = { path, status: response.status,
        code: typeof data?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(data.code) ? data.code : "API_REQUEST_FAILED" };
      throw new Error(`Preview API ${path} failed (HTTP ${response.status}).`);
    }
    return { status: response.status, data };
  }

  async function newAccount(label) {
    const account = { id: randomUUID(), email: `backyard-qa-stats-${label}-${runId}@example.invalid`,
      password: `Qa!${randomBytes(32).toString("base64url")}`, token: null, runId };
    // Retain attempted ID even after an ambiguous create timeout. Cleanup only
    // proceeds if Admin read-back proves BOTH the run marker and exact email.
    attempts.push(account);
    const created = checked(await admin.auth.admin.createUser({ id: account.id, email: account.email, password: account.password,
      email_confirm: true, app_metadata: { qa_run_id: runId }, user_metadata: { display_name: "Statistics QA" } }), "Create disposable Auth user");
    assertStep(created.user?.id === account.id, "fresh Auth user ID");
    const client = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const login = checked(await client.auth.signInWithPassword({ email: account.email, password: account.password }), "QA sign-in");
    assertStep(login.user?.id === account.id && login.session?.access_token, "QA session identity");
    account.token = login.session.access_token;
    account.client = client;
    return account;
  }

  async function reset(account, requestId = randomUUID()) {
    const result = await app("/api/account/statistics", account.token, "DELETE", { confirmation: "ELIMINAR", requestId });
    const record = analytics.parseStatisticsReset(result.data);
    assertStep(result.status === 200 && record, "Preview reset response confirmed");
    // Read as the actual owner. The request ledger deliberately grants SELECT
    // to authenticated owners, not the service role used only for QA fixtures.
    const direct = checked(await account.client.from("user_statistics_resets").select("reset_at,strategy").eq("user_id", account.id).single(), "Read isolated canonical reset");
    const ledger = checked(await account.client.from("user_statistics_reset_requests").select("reset_at").eq("user_id", account.id).eq("request_id", requestId).single(), "Read isolated reset request");
    assertStep(Date.parse(direct.reset_at) === Date.parse(record.resetAt), "Preview and isolated DB share canonical reset");
    assertStep(Date.parse(ledger.reset_at) <= Date.parse(record.resetAt), "idempotent request committed");
    return { record, requestId };
  }

  async function history(account) {
    const result = await app("/api/cloud/rounds", account.token);
    assertStep(Array.isArray(result.data.rounds), "round API history shape");
    return result.data.rounds;
  }

  try {
    const empty = await newAccount("zero");
    assert.deepEqual(await history(empty), []);
    const first = await reset(empty);
    const duplicate = await reset(empty, first.requestId);
    assert.equal(duplicate.record.resetAt, first.record.resetAt);
    assert.deepEqual(await history(empty), []);
    checked(await admin.auth.admin.getUserById(empty.id), "Empty account still exists after reset");
    passed.push("STATS_RESET_ZERO_ACCOUNT", "STATS_RESET_IDEMPOTENT");

    stage = "POPULATED_ACCOUNT";
    const populated = await newAccount("populated");
    const oldRound = capturedRound(populated.id, `qa-old-${runId}`, new Date(Date.parse(first.record.resetAt) - 86_400_000).toISOString());
    assert.equal((await app("/api/cloud/rounds", populated.token, "POST", { round: oldRound })).status, 201);
    const before = await history(populated);
    assert.equal(analytics.buildGolfInsights(before).scoredRounds, 1);
    const snapshotBefore = JSON.stringify(before);
    const second = await reset(populated);
    const after = await history(populated);
    assert.equal(JSON.stringify(after), snapshotBefore);
    assert.equal(analytics.buildGolfInsights(analytics.roundsEligibleForStatistics(after, second.record.resetAt)).scoredRounds, 0);
    assert.equal(analytics.buildGolfInsights(after).betBalance, 100, "historic balance remains");
    checked(await admin.auth.admin.getUserById(populated.id), "Populated account still exists after reset");
    passed.push("STATS_RESET_REAL_DATA", "STATS_HISTORY_PRESERVED");

    stage = "FRESH_SESSION_RELOAD";
    // A new client/auth session models reload without any local reset cache.
    const reloadedClient = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const reloaded = checked(await reloadedClient.auth.signInWithPassword({ email: populated.email, password: populated.password }), "Fresh-session reload");
    assertStep(reloaded.user?.id === populated.id && reloaded.session?.access_token, "Reload identity");
    populated.token = reloaded.session.access_token;
    const status = await app("/api/account/statistics", populated.token);
    assert.equal(status.data.resetAt, second.record.resetAt);
    assert.equal(JSON.stringify(await history(populated)), snapshotBefore);
    assert.equal(analytics.roundsEligibleForStatistics(await history(populated), status.data.resetAt).length, 0);
    passed.push("STATS_RESET_RELOAD", "OLD_ROUND_EXCLUDED");

    stage = "POST_RESET_ROUND";
    const newRound = capturedRound(populated.id, `qa-new-${runId}`, new Date(Math.max(Date.now(), Date.parse(second.record.resetAt) + 1)).toISOString());
    assert.equal((await app("/api/cloud/rounds", populated.token, "POST", { round: newRound })).status, 201);
    const withNew = await history(populated);
    assert.equal(withNew.length, 2);
    const eligible = analytics.roundsEligibleForStatistics(withNew, status.data.resetAt);
    assert.deepEqual(eligible.map(round => round.id), [newRound.id]);
    assert.equal(analytics.buildGolfInsights(eligible).scoredRounds, 1);
    passed.push("NEW_ROUND_INCLUDED");
  } catch (error) {
    // Only internally controlled assertion/error messages are printed below.
    failure = error instanceof Error ? error : new Error("Remote statistics QA failed.");
  } finally {
    for (const account of attempts) {
      try {
        const lookup = await admin.auth.admin.getUserById(account.id);
        if (lookup.error?.status === 404) continue;
        const user = checked(lookup, "QA cleanup identity lookup").user;
        assertStep(user?.id === account.id && user.email === account.email && user.app_metadata?.qa_run_id === runId,
          "QA cleanup ownership proof");
        if (account.token) {
          const cleaned = await app("/api/account/delete", account.token, "DELETE", {
            confirmation: "ELIMINAR", dataPolicy: "delete_golf_data", requestId: randomUUID(),
          });
          assertStep(cleaned.data.ok === true && cleaned.data.deleted === true, "QA account cleanup completion");
        } else {
          // Auth creation succeeded but login never did. This run has not
          // written app data for this account; only that fresh Auth ID is removed.
          checked(await admin.auth.admin.deleteUser(account.id), "Remove unused fresh QA Auth user");
        }
        const absence = await admin.auth.admin.getUserById(account.id);
        assertStep(absence.error?.status === 404 || (!absence.error && !absence.data.user), "QA Auth cleanup verified");
      } catch { retainedIds.push(account.id); }
    }
  }
  log(JSON.stringify({ preview: config.previewOrigin, projectRef: config.projectRef, runId, passed,
    ...(failure ? { failedAt: stage, diagnostic } : {}),
    cleanup: retainedIds.length ? "QA_ACCOUNTS_RETAINED" : "COMPLETE", retainedQaUserIds: retainedIds }));
  if (failure) throw new Error(`Remote statistics QA failed. Completed checks: ${passed.join(", ") || "none"}. Run ID: ${runId}. No credentials or provider response bodies were logged.`);
  if (retainedIds.length) throw new Error("Statistics checks completed, but disposable account cleanup is pending. Use the reported exact QA IDs; never broad-delete users.");
  return { passed, retainedQaUserIds: retainedIds };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (!args.length || (args.length === 1 && args[0] === "--help")) {
      console.log([
        "Isolated Preview statistics QA (creates two disposable QA accounts).",
        "1. Compile: node node_modules/typescript/bin/tsc -p tsconfig.test.json",
        "2. Set PREVIEW_QA_URL to the exact immutable Vercel deployment URL.",
        "3. Set PREVIEW_DB_REF, NEXT_PUBLIC_SUPABASE_URL and matching Preview publishable/anon + secret/service-role keys.",
        "4. Set QA_CONFIRM_ISOLATED_PREVIEW to that exact project ref only after verifying isolation.",
        "5. Validate offline: node scripts/qa-preview-statistics.mjs --check-config",
        "6. Execute: node scripts/qa-preview-statistics.mjs --run",
        "Optional VERCEL_AUTOMATION_BYPASS_SECRET is sent only to the exact Preview origin.",
        "Never use Production credentials. Failed cleanup reports exact fresh QA IDs; do not broad-delete users.",
      ].join("\n"));
    } else if (args.length === 1 && args[0] === "--check-config") {
      const config = previewStatisticsConfig();
      console.log(JSON.stringify({ configuration: "VALID", network: "NOT_RUN", preview: config.previewOrigin, projectRef: config.projectRef }));
    } else if (args.length === 1 && args[0] === "--run") {
      await runPreviewStatisticsQA();
    } else {
      throw new Error("Use --help, --check-config or --run; no network request was made.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Statistics Preview QA failed.");
    process.exitCode = 1;
  }
}
