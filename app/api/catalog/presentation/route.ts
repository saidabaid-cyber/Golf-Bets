import { NextResponse } from "next/server";
import { getSupabasePublic } from "../../../../lib/supabase/server";
export const dynamic="force-dynamic";
export async function GET(){const db=getSupabasePublic("cloud");const result=db?await db.rpc("player_visual_content_v2"):null;return NextResponse.json({items:result?.error?[]:result?.data||[]},{headers:{"cache-control":"public, max-age=5"}});}
