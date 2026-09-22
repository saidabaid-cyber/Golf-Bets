import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "../../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return new NextResponse(null, { status: 404 });
  const database = getSupabaseAdmin("cloud");
  if (!database) return new NextResponse(null, { status: 404 });
  const document = await database.from("admin_documents").select("storage_path,mime_type").eq("id", documentId).eq("rights_status", "APPROVED").eq("visibility", "PLAYER").maybeSingle();
  if (document.error || !document.data || !document.data.mime_type.startsWith("image/")) return new NextResponse(null, { status: 404 });
  const signed = await database.storage.from("admin-documents-private").createSignedUrl(document.data.storage_path, 60);
  if (signed.error || !signed.data?.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl, { status: 307, headers: { "cache-control": "private, no-store" } });
}
