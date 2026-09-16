import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { isProfileAudienceChoice, parseProfileAudienceResponse } from "../../../../lib/profile-visibility";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });

async function bounded<T>(operation: PromiseLike<T>, timeoutMs = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("privacy_timeout")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function GET(request: NextRequest) {
  try {
    const account = await bounded(authenticatedRequest(request));
    if (!account.ok) return json({ error: account.error }, account.status);
    const { data, error } = await bounded(account.client.from("profiles").select("profile_visibility").eq("id", account.userId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle());
    const visibility = parseProfileAudienceResponse({ visibility: data?.profile_visibility });
    if (error || visibility === null) return json({ error: "No pudimos consultar tu privacidad. Reintenta." }, 503);
    return json({ visibility });
  } catch { return json({ error: "No pudimos consultar tu privacidad. Reintenta." }, 503); }
}

export async function PATCH(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  if (!isJsonRequest(request)) return json({ error: "Solicitud no válida." }, 415);
  try {
    const account = await bounded(authenticatedRequest(request));
    if (!account.ok) return json({ error: account.error }, account.status);
    const body = await bounded(readJsonBodyWithLimit(request, 1024), 2_000);
    if (!body.ok || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) return json({ error: "Elige Público o Amigos." }, 400);
    const input = body.value as Record<string, unknown>;
    if (Object.keys(input).length !== 1 || !isProfileAudienceChoice(input.visibility)) return json({ error: "Elige Público o Amigos." }, 400);
    // RPC derives ownership from auth.uid(); no client-supplied account ID.
    const { data, error } = await bounded(account.client.rpc("set_my_profile_visibility", { requested_visibility: input.visibility }).abortSignal(AbortSignal.timeout(8_000)));
    if (error || data !== input.visibility) return json({ error: "No pudimos guardar tu privacidad. Reintenta." }, 503);
    return json({ visibility: data });
  } catch { return json({ error: "No pudimos guardar tu privacidad. Reintenta." }, 503); }
}
