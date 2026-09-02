import { NextResponse } from "next/server";
import { searchRulesCorpus } from "../../../../lib/rules-search";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 160) || "";
  return NextResponse.json({ results: searchRulesCorpus(query) });
}
