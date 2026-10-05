import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { readCareerAttest } from "../../../../lib/career-attest.server";
const headers={"cache-control":"private, no-store","vary":"Authorization"};
export async function GET(request:NextRequest) {
  const account=await authenticatedRequest(request);
  if(!account.ok)return NextResponse.json({code:account.code},{status:account.status,headers});
  const admin=getSupabaseAdmin("cloud",10000);
  if(!admin)return NextResponse.json({code:"CAREER_ATTEST_UNAVAILABLE"},{status:503,headers});
  try{return NextResponse.json(await readCareerAttest(admin,account.userId,account.client),{headers});}
  catch{return NextResponse.json({code:"CAREER_ATTEST_UNAVAILABLE",error:"Esta información no está disponible por el momento."},{status:503,headers});}
}
