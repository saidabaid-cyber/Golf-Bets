import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { isolatedPreviewDatabaseEnabled } from "../../../../lib/preview-database";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest } from "../../../../lib/backyard-ai/server/http-security";
import { normalizeSocialDirectoryQuery } from "../../../../features/social/domain";
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
  const query = normalizeSocialDirectoryQuery(request.nextUrl.searchParams.get("q"));
  if (query.length < 2 || query.length > 254) return NextResponse.json({ users: [] }, { headers });
  const { data, error } = await bounded(account.client.rpc("search_group_users_v1", { query_text: query }).abortSignal(AbortSignal.timeout(8_000)));
  if (error) return NextResponse.json({ error: "No pudimos buscar usuarios. Intenta nuevamente." }, { status: 503, headers });
  // Defense in depth: even an unexpected RPC payload must not expose email,
  // account settings or other private columns through the directory endpoint.
  const users = Array.isArray(data) ? data.map(row => ({ user_id: row.user_id, username: row.username,
    display_name: row.display_name, avatar_url: row.avatar_url, is_friend: row.is_friend === true })) : [];
  // The existing RPC matches name prefixes. Public names such as "QA Diego
  // Green" must also be discoverable by "Diego", without changing email or
  // friends-only discovery. Reuse the existing identity-card privacy gate.
  if (!query.includes("@")) {
    const literal = query.replace(/[\\%_]/g, value => `\\${value}`);
    const candidates = await bounded(account.client.from("social_profiles").select("user_id")
      .eq("privacy", "PUBLIC").neq("user_id", account.userId).ilike("display_name", `%${literal}%`)
      .order("display_name").limit(20).abortSignal(AbortSignal.timeout(8_000)));
    if (candidates.error) return NextResponse.json({ error: "No pudimos buscar usuarios. Intenta nuevamente." }, { status: 503, headers });
    const missing = (candidates.data || []).filter(row => !users.some(user => user.user_id === row.user_id));
    if (missing.length) {
      const [cards, friendships] = await Promise.all([
        Promise.all(missing.map(async row => {
          const card = await bounded(account.client.rpc("social_profile_card_v1", { target: row.user_id }).abortSignal(AbortSignal.timeout(8_000)));
          if (card.error) throw new Error("GROUP_LOOKUP_FAILED");
          return card.data?.[0] || null;
        })),
        bounded(account.client.from("friendships").select("user_a_id,user_b_id")
          .or(`user_a_id.eq.${account.userId},user_b_id.eq.${account.userId}`).limit(500).abortSignal(AbortSignal.timeout(8_000))),
      ]);
      if (friendships.error) throw new Error("GROUP_LOOKUP_FAILED");
      for (const card of cards.filter(Boolean)) users.push({ user_id: card.user_id, username: card.username, display_name: card.display_name, avatar_url: card.avatar_url,
        is_friend: (friendships.data || []).some(friend => friend.user_a_id === card.user_id || friend.user_b_id === card.user_id) });
    }
  }
  return NextResponse.json({ users: users.slice(0, 20) }, { headers });
  } catch { return NextResponse.json({ error: "No pudimos buscar usuarios. Intenta nuevamente." }, { status: 503, headers }); }
}
