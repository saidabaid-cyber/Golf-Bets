import { NextResponse } from "next/server";
import { browseRulesSource, searchRulesCorpus } from "../../../../lib/rules-search";
import { officialRulesDocument } from "../../../../lib/rules-documents";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.slice(0, 160) || "";
  const source = params.get("source")?.slice(0, 80) || "";
  if (source && officialRulesDocument(source)) {
    return NextResponse.json({ results: browseRulesSource(source as Parameters<typeof browseRulesSource>[0], Number(params.get("limit")) || 24) });
  }
  return NextResponse.json({ results: searchRulesCorpus(query) });
}
