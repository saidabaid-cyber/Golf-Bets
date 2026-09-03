import type { OfficialRulesDocument } from "./rules-documents";

/** Stream large official PDFs without Next Data Cache or buffering the book.
 * Diagnostics contain only document id/status, never request credentials. */
export async function officialPdfResponse(document: OfficialRulesDocument, fetcher: typeof fetch = fetch) {
  let reason = "network";
  try {
    const upstream = await fetcher(document.officialUrl, {
      cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/pdf", "User-Agent": "Mozilla/5.0" },
    });
    reason = `upstream-${upstream.status}`;
    if (!upstream.ok || !upstream.body) throw new Error(reason);
    const reader = upstream.body.getReader();
    // MIME types from official CDNs vary. Verify PDF magic instead of rejecting
    // a genuine application/octet-stream PDF, and never stream an HTML error.
    let prefix = new Uint8Array(0);
    while (prefix.length < 5) {
      const part = await reader.read();
      if (part.done) break;
      const next = new Uint8Array(prefix.length + part.value.length);
      next.set(prefix); next.set(part.value, prefix.length); prefix = next;
    }
    if (new TextDecoder().decode(prefix.slice(0, 5)) !== "%PDF-") {
      reason = "invalid-pdf"; await reader.cancel(); throw new Error(reason);
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(prefix); },
      async pull(controller) {
        try { const next = await reader.read(); if (next.done) controller.close(); else controller.enqueue(next.value); }
        catch (error) { controller.error(error); }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${document.sourceFileName.replace(/["\\]/g, "")}"`,
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN",
      // Do not forward Content-Length: fetch can decompress the upstream body.
    } });
  } catch (error) {
    if (error instanceof Error && /timeout|abort/i.test(error.name)) reason = "timeout";
    console.warn("rules_pdf_proxy", { document: document.id, reason });
    return new Response("La fuente oficial no respondió. Puedes reintentar desde el visor de The Backyard.", {
      status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Rules-Source-Status": reason },
    });
  }
}
