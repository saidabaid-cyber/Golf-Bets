import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { officialRulesDocument } from "../../../../../lib/rules-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function officialPdfResponse(document: NonNullable<ReturnType<typeof officialRulesDocument>>) {
  try {
    const upstream = await fetch(document.officialUrl, {
      cache: "force-cache",
      redirect: "follow",
      headers: {
        Accept: "application/pdf",
        "User-Agent": "Mozilla/5.0",
      },
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.toLowerCase().includes("application/pdf") || !upstream.body) {
      throw new Error(`Official PDF returned ${upstream.status}`);
    }
    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${document.sourceFileName.replace(/["\\]/g, "")}"`,
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    });
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return new Response("No fue posible cargar el PDF dentro de la app. Usa “Abrir en navegador” para consultar la fuente oficial.", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

export async function GET(request: Request, context: RouteContext<"/api/rules/documents/[id]">) {
  const { id } = await context.params;
  const document = officialRulesDocument(id);
  if (!document) return new Response("Documento no encontrado.", { status: 404 });

  if (process.env.NODE_ENV === "production" || !localRequest(request)) {
    return officialPdfResponse(document);
  }

  for (const folder of ["rules-source", "rules-sources"]) {
    const filePath = path.join(process.cwd(), folder, document.sourceFileName);
    try {
      const file = await readFile(filePath);
      return new Response(new Uint8Array(file), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${document.sourceFileName.replace(/[\"\\]/g, "")}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN",
        },
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") return new Response("No fue posible abrir el documento.", { status: 500 });
    }
  }

  return officialPdfResponse(document);
}
