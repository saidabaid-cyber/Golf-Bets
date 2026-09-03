import { NextResponse } from "next/server";
import { officialRulesDocument } from "../../../../../../lib/rules-documents";
import { searchRulesDocumentPages } from "../../../../../../lib/rules-search";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const document = officialRulesDocument(id);
  if (!document) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 160).trim() || "";
  if (!query) return NextResponse.json({ matches: [] });
  return NextResponse.json({ matches: searchRulesDocumentPages(document.id, query), index: "static-page-index" });
}
