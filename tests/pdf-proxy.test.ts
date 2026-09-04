import test from "node:test";
import assert from "node:assert/strict";
import { officialPdfResponse } from "../lib/pdf-proxy";
import { OFFICIAL_RULES_DOCUMENTS } from "../lib/rules-documents";
import { fetchWithTimeout } from "../lib/network-timeout";

for (const document of OFFICIAL_RULES_DOCUMENTS) test("proxy valida y transmite PDF sin Data Cache: " + document.id, async () => {
  const pdf = "%PDF-1.7\n" + "x".repeat(2_100_000);
  let options: RequestInit | undefined;
  const result = await officialPdfResponse(document, async (url, init) => {
    assert.equal(url, document.officialUrl); options = init;
    return new Response(pdf, { headers: { "content-type": "application/octet-stream", "content-length": "40", "content-encoding": "gzip" } });
  });
  assert.equal(result.status, 200); assert.equal(options?.cache, "no-store");
  assert.equal(result.headers.get("content-length"), null); assert.equal(result.headers.get("content-type"), "application/pdf");
  assert.equal(await result.text(), pdf);
});
test("proxy informa rechazo upstream sin servir HTML como PDF ni exponer body", async () => {
  const response = await officialPdfResponse(OFFICIAL_RULES_DOCUMENTS[0], async () => new Response("upstream private details", { status: 403 }));
  assert.equal(response.status, 502); assert.equal(response.headers.get("x-rules-source-status"), "upstream-403");
  assert.doesNotMatch(await response.text(), /private details/);
});
test("proxy rechaza HTML 200, conserva fallback y diagnóstico recuperable", async () => {
  const response = await officialPdfResponse(OFFICIAL_RULES_DOCUMENTS[0], async () => new Response("<html>not a PDF</html>"));
  assert.equal(response.status, 502); assert.equal(response.headers.get("x-rules-source-status"), "invalid-pdf");
});
test("proxy transmite rangos reales para que PDF.js no descargue 17 MB en una sola Function", async () => {
  const bytes = new TextEncoder().encode("chunk-at-offset");
  let range = "";
  const response = await officialPdfResponse(OFFICIAL_RULES_DOCUMENTS[0], async (_url, init) => {
    range = new Headers(init?.headers).get("range") || "";
    return new Response(bytes, { status: 206, headers: {
      "content-type": "application/pdf",
      "content-range": "bytes 1048576-1048590/17679342",
      "content-length": String(bytes.length),
      "accept-ranges": "bytes",
    } });
  }, "bytes=1048576-1048590");
  assert.equal(range, "bytes=1048576-1048590");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 1048576-1048590/17679342");
  assert.equal(response.headers.get("content-length"), String(bytes.length));
  assert.equal(await response.text(), "chunk-at-offset");
});
test("timeout aborta petición y permite reintentar, sin depender de AbortSignal.any", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    await assert.rejects(fetchWithTimeout("https://example.invalid", {}, 5), /aborted/);
  } finally { globalThis.fetch = original; }
});
