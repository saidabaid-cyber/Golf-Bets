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

export async function GET(request: Request, context: RouteContext<"/api/rules/documents/[id]">) {
  if (process.env.NODE_ENV === "production" || !localRequest(request)) {
    return new Response("Documento disponible únicamente en localhost.", { status: 404 });
  }

  const { id } = await context.params;
  const document = officialRulesDocument(id);
  if (!document) return new Response("Documento no encontrado.", { status: 404 });

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

  return new Response("Documento indexado para IA; la copia local no está disponible.", { status: 404 });
}
