import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { isolatedPreviewDatabaseEnabled } from "../../../../lib/preview-database";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest } from "../../../../lib/backyard-ai/server/http-security";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;
const headers = BACKYARD_AI_PRIVATE_HEADERS;
async function bounded<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("GROUP_LOOKUP_TIMEOUT")), 8_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403, headers });
  try {
  const account = await bounded(authenticatedRequest(request));
  if (!account.ok) return NextResponse.json({ error: account.error }, { status: account.status, headers });
  if (!isolatedPreviewDatabaseEnabled()) return NextResponse.json({ error: "Búsqueda no disponible en este entorno." }, { status: 503, headers });
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 254) return NextResponse.json({ users: [] }, { headers });
  const { data, error } = await bounded(account.client.rpc("search_group_users_v1", { query_text: query }).abortSignal(AbortSignal.timeout(8_000)));
  if (error) return NextResponse.json({ error: "No pudimos buscar usuarios. Intenta nuevamente." }, { status: 503, headers });
  // Defense in depth: even an unexpected RPC payload must not expose email,
  // account settings or other private columns through the directory endpoint.
  const users = Array.isArray(data) ? data.map(row => ({ user_id: row.user_id, username: row.username,
    display_name: row.display_name, avatar_url: row.avatar_url, is_friend: row.is_friend === true })) : [];
  return NextResponse.json({ users }, { headers });
  } catch { return NextResponse.json({ error: "No pudimos buscar usuarios. Intenta nuevamente." }, { status: 503, headers }); }
}
