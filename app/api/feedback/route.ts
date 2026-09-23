import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../lib/server-auth";
import { teeFeedbackPayload, validateTeeFeedback } from "../../../lib/feedback";

const headers = { "cache-control": "private, no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const auth = await authenticatedRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  const body = await request.json().catch(() => null) as { id?: unknown; input?: unknown; screen?: unknown } | null;
  if (!body || typeof body.id !== "string" || !UUID.test(body.id)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers });
  const checked = validateTeeFeedback(body.input);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400, headers });
  const payload = teeFeedbackPayload(checked.data);
  const result = await auth.client.rpc("submit_feedback_owner_v1", {
    request_id: body.id,
    request_payload: payload,
    source_screen: typeof body.screen === "string" ? body.screen.slice(0, 160) : "round_setup",
  }).abortSignal(AbortSignal.timeout(10_000));
  if (result.error) {
    const status = /RATE_LIMIT/.test(result.error.message) ? 429 : /REQUEST_CONFLICT/.test(result.error.message) ? 409 : 503;
    return NextResponse.json({ error: status === 429 ? "Alcanzaste el límite de solicitudes. Intenta mañana." : status === 409 ? "La solicitud ya existe con otros datos." : "No pudimos guardar la solicitud. Reintenta." }, { status, headers });
  }
  return NextResponse.json({ received: true, request: result.data }, { headers });
}
