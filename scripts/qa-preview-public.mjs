// Read-only canonical Preview/Supabase checks. Never logs keys, cookies or response rows.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { canonicalPreviewRequestHeaders } from "./lib/canonical-preview-request.mjs";
import { createQaClientBundleEvidence, scanQaClientSource } from "./lib/qa-client-bundle-security.mjs";
import {
  CANONICAL_QA_ORIGIN,
  CANONICAL_QA_PROJECT_REF,
  exactQaBrowserTarget,
  qaCredentialBoundFetch,
} from "./lib/qa-public-preview.mjs";

const EXPECTED_SUPABASE_ORIGIN = `https://${CANONICAL_QA_PROJECT_REF}.supabase.co`;
const FULL_SHA = /^[0-9a-f]{40}$/;
const PRIVATE_TABLES = [
  "profiles", "rounds_cloud", "round_scores_cloud", "players", "frequent_groups_cloud",
  "personal_rivals_cloud", "user_cloud_state", "user_preferences", "cloud_deletions",
  "legal_acceptances", "tournament_access", "polla_join_attempts",
];
const SCHEMA_PROBES = [
  ["profiles", "id,onboarding_completed_at,version,updated_by_device"],
  ["round_scores_cloud", "round_player_id,hole,version,updated_by_device"],
  ["account_data_migrations", "user_id,last_attempt_at,last_error_code"],
  ["user_devices", "user_id,device_id,last_sync_at"],
  ["cloud_record_versions", "owner_id,entity_type,local_id,version"],
];

async function boundedBytes(response, maxBytes, { requireOk = true } = {}) {
  if (requireOk && !response.ok) throw new Error(`QA resource returned HTTP ${response.status}.`);
  if (!response.body) throw new Error("QA resource returned no response body.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("QA response exceeded its bounded inspection limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

async function boundedText(response, maxBytes, options) {
  return (await boundedBytes(response, maxBytes, options)).toString("utf8");
}

async function boundedJson(response, maxBytes, options) {
  const source = await boundedText(response, maxBytes, options);
  try { return JSON.parse(source); }
  catch { throw new Error("QA endpoint did not return valid JSON."); }
}

async function assertReadablePdf(bytes, id) {
  let task;
  let document;
  try {
    task = getDocument({ data: new Uint8Array(bytes), disableWorker: true, stopAtErrors: true });
    document = await task.promise;
    assert.ok(Number.isSafeInteger(document.numPages) && document.numPages > 0, `Internal Rules PDF has no pages: ${id}`);
    await document.getPage(1);
  } catch {
    throw new assert.AssertionError({ message: `Internal Rules PDF is structurally invalid: ${id}` });
  } finally {
    await task?.destroy().catch(() => {});
  }
}

function setCookies(response, cookies) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function assertFeatures(features) {
  assert.equal(features?.authProviders?.status, "ready", "Auth provider settings are not available from canonical Preview.");
  assert.equal(features?.authProviders?.email, true, "Email authentication is not enabled on canonical Preview.");
  assert.equal(features?.authProviders?.google, true, "Google authentication is not enabled on canonical Preview.");
  assert.equal(features?.authSocialEnabled, true, "Social authentication is not enabled on canonical Preview.");
  assert.equal(features?.cloudEnabled, true, "Cloud sync is not enabled on canonical Preview.");
  assert.equal(features?.equipmentCloudEnabled, true, "Equipment cloud sync is not enabled on canonical Preview.");
  assert.equal(features?.pollaLiveEnabled, false, "Polla Live must remain disabled on canonical Preview.");
  assert.ok(features?.phase2 && typeof features.phase2 === "object" && !Array.isArray(features.phase2), "Phase 2 flags are missing.");
  assert.equal(features.phase2.ghin_integration, false, "GHIN live must remain disabled pending external QA.");
}

/** Strict, read-only proof that the fixed canonical domain serves the expected
 * commit and isolated QA project. Dependencies are injectable for negative tests. */
export async function runCanonicalPublicQa({
  target = CANONICAL_QA_ORIGIN,
  expectedSha,
  bypass = "",
  fetcher = fetch,
  log = console.log,
} = {}) {
  const origin = exactQaBrowserTarget(target).origin;
  const sha = String(expectedSha || "").trim().toLowerCase();
  assert.match(sha, FULL_SHA, "PREVIEW_QA_EXPECTED_SHA must be the exact deployed commit.");

  const cookies = new Map();
  const appFetch = qaCredentialBoundFetch(origin, fetcher);
  const databaseFetch = qaCredentialBoundFetch(EXPECTED_SUPABASE_ORIGIN, fetcher);
  async function previewFetch(path, { includeBypass = true } = {}) {
    const url = new URL(path, origin);
    assert.equal(url.origin, origin, "QA request left the canonical origin.");
    const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await appFetch(url.href, {
      cache: "no-store",
      headers: canonicalPreviewRequestHeaders(url.href, CANONICAL_QA_ORIGIN, includeBypass ? bypass : "", cookie ? { cookie } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    setCookies(response, cookies);
    return response;
  }

  async function supabaseRead(path, publicKey, options = {}) {
    const response = await databaseFetch(`${EXPECTED_SUPABASE_ORIGIN}${path}`, {
      ...options,
      cache: "no-store",
      headers: { apikey: publicKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    return { response, data: await boundedJson(response, 500_000, { requireOk: false }) };
  }

  // Verify the mutable branch alias before disclosing an optional protection
  // bypass to the deployment currently behind it.
  const healthResponse = await previewFetch("/api/health", { includeBypass: false });
  assert.equal(healthResponse.status, 200, "Canonical QA health is unavailable.");
  const health = await boundedJson(healthResponse, 100_000);
  assert.equal(health.status, "ok", "Canonical QA health status is not OK.");
  assert.equal(health.environment, "preview", "Canonical QA is not a Preview deployment.");
  assert.equal(health.buildSha, sha, "Canonical QA commit does not match PREVIEW_QA_EXPECTED_SHA.");

  const page = await previewFetch("/");
  assert.equal(page.status, 200, "Canonical Preview is unavailable.");
  assert.match(page.headers.get("content-type") || "", /^text\/html\b/i, "Canonical Preview root did not return HTML.");
  const html = await boundedText(page, 5_000_000);
  const scriptSources = [...new Set([...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]))];
  assert.ok(scriptSources.length <= 64, "Preview bundle inspection limit exceeded.");
  const evidence = createQaClientBundleEvidence();
  scanQaClientSource(html, evidence, CANONICAL_QA_PROJECT_REF);
  let scannedChunks = 0;
  for (const source of scriptSources) {
    const url = new URL(source.replaceAll("&amp;", "&"), origin);
    if (url.origin !== origin || !url.pathname.startsWith("/_next/static/") || !url.pathname.endsWith(".js")) continue;
    const response = await previewFetch(url.pathname + url.search);
    assert.equal(response.status, 200, `Referenced Next.js client chunk is unavailable: ${url.pathname}`);
    scanQaClientSource(await boundedText(response, 8_000_000), evidence, CANONICAL_QA_PROJECT_REF);
    scannedChunks++;
  }
  assert.ok(scannedChunks > 0, "Canonical Preview HTML referenced no inspectable Next.js client chunk.");
  assert.equal(evidence.secretCount, 0, "A server secret was found in canonical Preview client content.");
  assert.deepEqual([...evidence.supabaseOrigins].sort(), [EXPECTED_SUPABASE_ORIGIN], "Client content references an unexpected Supabase project.");
  assert.ok(evidence.publicKeys.size > 0 && evidence.publicKeys.size <= 8, "Canonical Preview must expose only a bounded set of public Supabase keys.");
  log(JSON.stringify({ check: "browser-bundle", chunks: scannedChunks, configuredProject: EXPECTED_SUPABASE_ORIGIN, publicKeys: evidence.publicKeys.size, secretCount: 0 }));

  for (const id of ["official-guide-part-1", "committee-procedures-part-2", "clarifications-july-2026"]) {
    const response = await previewFetch(`/api/rules/documents/${id}`);
    assert.equal(response.status, 200, `Internal Rules PDF is unavailable: ${id}`);
    assert.match(response.headers.get("content-type") || "", /^application\/pdf\b/i, `Internal Rules document is not a PDF: ${id}`);
    assert.equal(response.headers.get("x-rules-source-status"), null, `Internal Rules PDF used a fallback source: ${id}`);
    const bytes = await boundedBytes(response, 20_000_000);
    assert.ok(bytes.length > 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-", `Internal Rules PDF is invalid: ${id}`);
    await assertReadablePdf(bytes, id);
    log(JSON.stringify({ check: "internal-pdf", id, status: 200, bytes: bytes.length, pages: "PARSED" }));
  }

  const featuresResponse = await previewFetch("/api/features");
  assert.equal(featuresResponse.status, 200, "Canonical Preview feature status is unavailable.");
  const features = await boundedJson(featuresResponse, 200_000);
  assertFeatures(features);
  log(JSON.stringify({ check: "preview-features", status: 200, auth: "ready", ghinLive: false }));

  for (const path of ["/api/cloud/sync", "/api/cloud/rounds"]) {
    const response = await previewFetch(path);
    assert.equal(response.status, 401, `Unauthenticated request did not fail closed: ${path}`);
    await boundedBytes(response, 200_000, { requireOk: false });
    log(JSON.stringify({ check: "unauthenticated-api", path, status: 401 }));
  }

  for (const publicKey of evidence.publicKeys) {
    const { response, data } = await supabaseRead("/auth/v1/settings", publicKey);
    assert.equal(response.status, 200, "QA Supabase public key/project binding failed.");
    assert.ok(data && typeof data === "object" && data.external && typeof data.external === "object", "QA Auth settings schema is invalid.");
    assert.equal(data.external.email, true, "QA Supabase email Auth is disabled.");
    assert.equal(data.external.google, true, "QA Supabase Google Auth is disabled.");
  }
  const publicKey = evidence.publicKeys.values().next().value;
  log(JSON.stringify({ check: "auth-settings", status: 200, email: true, google: true }));

  for (const table of [...PRIVATE_TABLES, "tournament_leaderboard_events"]) {
    const { response, data } = await supabaseRead(`/rest/v1/${table}?select=*&limit=1`, publicKey);
    assert.equal(response.status, 200, `Anonymous REST read failed closed incorrectly or schema is unavailable: ${table}`);
    assert.ok(Array.isArray(data), `Anonymous REST response is not an array: ${table}`);
    if (table !== "tournament_leaderboard_events") assert.equal(data.length, 0, `Anonymous rows are exposed in ${table}.`);
    log(JSON.stringify({ check: "anon-read", table, status: 200, rows: data.length }));
  }

  for (const [table, columns] of SCHEMA_PROBES) {
    const { response, data } = await supabaseRead(`/rest/v1/${table}?select=${columns}&limit=1`, publicKey);
    assert.equal(response.status, 200, `Canonical QA schema probe failed: ${table}`);
    assert.ok(Array.isArray(data), `Canonical QA schema probe is not an array: ${table}`);
    assert.equal(data.length, 0, `Anonymous schema probe exposed rows in ${table}.`);
    log(JSON.stringify({ check: "schema-shape", table, status: 200 }));
  }

  for (const [fn, body] of [
    ["resolve_polla_access", { p_token: "qa-not-a-real-token" }],
    ["is_polla_admin", { p_tournament_id: "00000000-0000-0000-0000-000000000000" }],
  ]) {
    const { response, data } = await supabaseRead(`/rest/v1/rpc/${fn}`, publicKey, { method: "POST", body: JSON.stringify(body) });
    assert.ok(response.status === 401 || response.status === 403, `${fn} did not return an authorization denial.`);
    assert.equal(data?.code, "42501", `${fn} returned an unexpected denial/error code.`);
    log(JSON.stringify({ check: "anon-rpc", fn, status: response.status, errorCode: "42501" }));
  }

  return { buildSha: sha, chunks: scannedChunks, supabaseOrigin: EXPECTED_SUPABASE_ORIGIN };
}

async function main() {
  try {
    if (!process.argv[2]) throw new Error(`Pass the canonical QA URL ${CANONICAL_QA_ORIGIN}.`);
    await runCanonicalPublicQa({
      target: process.argv[2],
      expectedSha: process.env.PREVIEW_QA_EXPECTED_SHA,
      bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
    });
  } catch (error) {
    // Do not print underlying network/provider errors that might include secrets.
    console.error(error instanceof assert.AssertionError ? error.message : "QA request failed; inspect canonical Preview access/configuration without logging credentials.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
