import assert from "node:assert/strict";
import test from "node:test";

import { runCanonicalPublicQa } from "./qa-preview-public.mjs";

const APP = "https://dev.thebackyard.com.mx";
const DB = "https://bymeopxkxapfizeeqeyb.supabase.co";
const SHA = "a".repeat(40);
const PUBLIC_KEY = `sb_publishable_${"p".repeat(32)}`;

function minimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return source;
}

const VALID_PDF = minimalPdf();

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}.synthetic_signature`;
}

function qaFetcher({ htmlExtra = "", chunkExtra = "", pageType = "text/html", status = {} } = {}) {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === APP) {
      if (url.pathname === "/api/health") return json({ status: "ok", environment: "preview", buildSha: SHA });
      if (url.pathname === "/") return new Response(`<html>${htmlExtra}<script src="/_next/static/app.js"></script></html>`, { status: 200, headers: { "content-type": pageType } });
      if (url.pathname === "/_next/static/app.js") {
        return new Response(`${DB};${PUBLIC_KEY};${chunkExtra}`, { status: status.chunk ?? 200, headers: { "content-type": "application/javascript" } });
      }
      if (url.pathname.startsWith("/api/rules/documents/")) {
        return new Response(status.pdf === 404 ? "missing" : status.pdfInvalid ? "%PDF-1.7\ntruncated" : VALID_PDF, { status: status.pdf ?? 200, headers: { "content-type": status.pdfType ?? "application/pdf" } });
      }
      if (url.pathname === "/api/features") {
        return json({ authProviders: { status: "ready", email: true, google: true, apple: false }, authSocialEnabled: true,
          cloudEnabled: true, equipmentCloudEnabled: true, pollaLiveEnabled: false, phase2: { ghin_integration: false } }, status.features ?? 200);
      }
      if (url.pathname === "/api/cloud/sync" || url.pathname === "/api/cloud/rounds") return json({ code: "AUTH_REQUIRED" }, 401);
    }
    if (url.origin === DB) {
      if (url.pathname === "/auth/v1/settings") {
        const code = status.settings ?? 200;
        return json(code === 200 ? { external: { email: true, google: true, apple: false } } : { code: "UNAVAILABLE" }, code,
          code >= 300 && code < 400 ? { location: `${DB}/redirected` } : {});
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) return json({ code: "42501" }, status.rpc ?? 403);
      if (url.pathname.startsWith("/rest/v1/")) return json([], status.rest ?? 200);
    }
    return json({ code: "NOT_FOUND" }, 404);
  };
}

test("canonical public QA proves the full read-only Preview surface", async () => {
  const records = [];
  const result = await runCanonicalPublicQa({ target: APP, expectedSha: SHA, fetcher: qaFetcher(), log: (line) => records.push(line) });
  assert.equal(result.buildSha, SHA);
  assert.equal(result.chunks, 1);
  assert.ok(records.length > 10);
});

for (const [label, options, pattern] of [
  ["Auth settings 401", { status: { settings: 401 } }, /public key\/project binding/],
  ["Auth settings outage", { status: { settings: 500 } }, /public key\/project binding/],
  ["Auth settings redirect", { status: { settings: 302 } }, /redirect/],
  ["missing PDF", { status: { pdf: 404 } }, /PDF is unavailable/],
  ["truncated PDF", { status: { pdfInvalid: true } }, /structurally invalid/],
  ["failed feature endpoint", { status: { features: 500 } }, /feature status is unavailable/],
  ["missing referenced chunk", { status: { chunk: 404 } }, /client chunk is unavailable/],
  ["non-HTML root", { pageType: "application/json" }, /did not return HTML/],
  ["inline Production project", { htmlExtra: "https://zhqmlpljloumldaczcfp.supabase.co" }, /unexpected Supabase project/],
  ["uppercase Production project", { htmlExtra: "https://ZHQMLPLJLOUMLDACZCFP.supabase.co" }, /unexpected Supabase project/],
  ["secondary project after QA", { chunkExtra: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" }, /unexpected Supabase project/],
  ["inline Supabase secret", { htmlExtra: `sb_secret_${"s".repeat(32)}` }, /server secret/],
  ["inline service-role JWT", { htmlExtra: jwt({ ref: "bymeopxkxapfizeeqeyb", role: "service_role" }) }, /server secret/],
  ["inline authenticated session JWT", { htmlExtra: jwt({ ref: "bymeopxkxapfizeeqeyb", role: "authenticated", sub: "synthetic-user" }) }, /server secret/],
  ["inline Supabase admin JWT", { htmlExtra: jwt({ ref: "bymeopxkxapfizeeqeyb", role: "supabase_admin" }) }, /server secret/],
  ["inline wrong-project anon JWT", { htmlExtra: jwt({ ref: "zhqmlpljloumldaczcfp", role: "anon" }) }, /another Supabase project/],
]) {
  test(`canonical public QA rejects ${label}`, async () => {
    await assert.rejects(() => runCanonicalPublicQa({ target: APP, expectedSha: SHA, fetcher: qaFetcher(options), log: () => {} }), pattern);
  });
}

test("canonical public QA rejects HTML with no Next.js chunks", async () => {
  const fetcher = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/health") return json({ status: "ok", environment: "preview", buildSha: SHA });
    return new Response(`${DB}${PUBLIC_KEY}`, { status: 200, headers: { "content-type": "text/html" } });
  };
  await assert.rejects(() => runCanonicalPublicQa({ target: APP, expectedSha: SHA, fetcher, log: () => {} }), /no inspectable Next\.js client chunk/);
});
