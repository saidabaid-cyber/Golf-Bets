import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "../../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ courseId: string; documentId: string }> }) {
  const { courseId: encodedCourseId, documentId } = await context.params; const courseId = decodeURIComponent(encodedCourseId).slice(0, 240);
  if (!courseId || !/^[0-9a-f-]{36}$/i.test(documentId)) return new NextResponse(null, { status: 404 });
  const database = getSupabaseAdmin("cloud"); if (!database) return new NextResponse(null, { status: 404 });
  const document = await database.from("admin_documents").select("storage_path").eq("id", documentId).eq("scope_type", "COURSE").eq("scope_id", courseId).eq("rights_status", "APPROVED").eq("visibility", "PLAYER").in("owner_entity_type", ["COURSE", "LOCAL_RULE_SET"]).maybeSingle();
  if (document.error || !document.data) return new NextResponse(null, { status: 404 });
  const signed = await database.storage.from("admin-documents-private").createSignedUrl(document.data.storage_path, 60);
  if (signed.error || !signed.data?.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl, { status: 307, headers: { "cache-control": "private, no-store" } });
}
