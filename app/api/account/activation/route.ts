import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { BACKYARD_AI_PRIVATE_HEADERS, hasOnlyKeys, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
// Auth verifies the token first. A session ID is not trusted for ownership: the
// service-only RPC also binds it to that verified user's auth.sessions row.
function sessionId(token: string) {
  try { const id = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).session_id; return typeof id === "string" && UUID.test(id) ? id : null; } catch { return null; }
}
async function context(request: NextRequest) {
  const account = await authenticatedRequest(request, { allowLifecycleRecovery: true });
  if (!account.ok) return { response: json({ code: account.code, error: account.error }, account.status) };
  const admin = getSupabaseAdmin("cloud", 8_000); const session = sessionId(account.token);
  if (!admin || !session) return { response: json({ error: "No pudimos verificar la sesión de tu cuenta." }, 503) };
  return { account, admin, session };
}
export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  try {
    const ctx = await context(request); if (ctx.response) return ctx.response;
    const result = await ctx.admin!.rpc("account_activation_status_v1", { requested_user: ctx.account!.userId, requested_session: ctx.session });
    if (["PGRST202", "42883"].includes(result.error?.code || "")) {
      // Backward compatible before controlled DB apply. Never infer ACTIVE
      // from a failure: only the existing owner-bound status RPC can prove it.
      const old = await ctx.account!.client.rpc("account_access_status").abortSignal(AbortSignal.timeout(8_000));
      if (!old.error && old.data === "active") return json({ status: "active", available: false });
    }
    if (result.error) return json({ error: "No pudimos verificar el estado de tu cuenta." }, 503);
    if (result.data !== "active" && result.data !== "deactivated") return json({ error: "Esta sesión no puede abrir la cuenta. Cierra sesión e inicia nuevamente." }, 403);
    return json({ status: result.data, available: true });
  } catch { return json({ error: "No pudimos verificar el estado de tu cuenta. Reintenta." }, 503); }
}
export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  if (!isJsonRequest(request)) return json({ error: "Solicitud inválida." }, 415);
  try {
    const ctx = await context(request); if (ctx.response) return ctx.response;
    const read = await readJsonBodyWithLimit(request, 1_024);
    const body = read.ok && read.value && typeof read.value === "object" && !Array.isArray(read.value) ? read.value as Record<string, unknown> : null;
    if (!body || !hasOnlyKeys(body, ["action", "requestId"]) || !["deactivate", "reactivate"].includes(String(body.action)) || typeof body.requestId !== "string" || !UUID.test(body.requestId)) return json({ error: "Revisa la acción de cuenta e intenta nuevamente." }, 400);
    const result = await ctx.admin!.rpc("account_activation_change_v1", { requested_user: ctx.account!.userId, requested_session: ctx.session, requested_action: body.action, requested_id: body.requestId });
    if (["PGRST202", "42883"].includes(result.error?.code || "")) return json({ code: "PENDING_CONTROLLED_DB_APPLY", error: "La desactivación necesita habilitarse en este entorno. Tu cuenta sigue sin cambios." }, 503);
    if (result.error) return json({ error: "No se confirmó el cambio. Cierra sesión y vuelve a intentar con un acceso nuevo." }, result.error.code === "42501" ? 403 : 409);
    const expected = body.action === "deactivate" ? "deactivated" : "active";
    if (result.data !== expected) return json({ error: "Tu cuenta cambió desde esta solicitud. Vuelve a consultar su estado." }, 409);
    if (body.action === "deactivate") {
      // Existing Auth API revokes refresh sessions. The DB boundary also denies
      // old access JWTs both now and after legitimate reactivation.
      const signedOut = await ctx.admin!.auth.admin.signOut(ctx.account!.token, "global");
      if (signedOut.error) return json({ error: "Tu cuenta está desactivada. Cierra sesión en este dispositivo; no se confirmó el cierre de todas las sesiones." }, 503);
    }
    return json({ status: expected, available: true });
  } catch { return json({ error: "No se confirmó el cambio de cuenta. Reintenta la misma solicitud." }, 503); }
}
