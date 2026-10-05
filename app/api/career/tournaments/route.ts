import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { readCareerTournaments } from "../../../../lib/career-tournaments.server";
const PRIVATE={"cache-control":"private, no-store","vary":"Authorization"};
export async function GET(request:NextRequest) {
  const account=await authenticatedRequest(request);
  if(!account.ok) return NextResponse.json({error:account.error,code:account.code},{status:account.status,headers:PRIVATE});
  const offset=Number(request.nextUrl.searchParams.get("offset")??0);
  if(!Number.isInteger(offset)||offset<0||offset>10000) return NextResponse.json({code:"INVALID_PAGE"},{status:400,headers:PRIVATE});
  // Carrera reads existing account-linked history; it does not enable Polla's unreleased editor.
  const admin=getSupabaseAdmin("cloud",10000);
  if(!admin) return NextResponse.json({code:"TOURNAMENTS_UNAVAILABLE"},{status:503,headers:PRIVATE});
  try {return NextResponse.json(await readCareerTournaments(admin,account.userId,offset),{headers:PRIVATE});}
  catch {return NextResponse.json({error:"Esta información no está disponible por el momento.",code:"TOURNAMENTS_UNAVAILABLE"},{status:503,headers:PRIVATE});}
}
