import { NextResponse } from "next/server";
import { adminModeDatabaseIsolated } from "../../../../lib/admin-mode";
import { getSupabasePublic } from "../../../../lib/supabase/server";
export const dynamic="force-dynamic";
export async function GET(){
 const db=adminModeDatabaseIsolated()?getSupabasePublic("cloud"):null;
 const result=db?await db.rpc("player_bet_variants_v3"):null;
 return NextResponse.json({items:result?.error?[]:result?.data||[]},{headers:{"cache-control":"private, no-store"}});
}
