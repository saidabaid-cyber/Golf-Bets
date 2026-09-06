import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { authenticatedUser, requestBearer, runtimeIdentity } from "../../../../lib/server-runtime";
import { eventCategory, isAnalyticsEventName, sanitizeTelemetryMetadata } from "../../../../lib/telemetry";

const windows = new Map<string, { start: number; count: number }>();
function allowed(key: string) {
  const now = Date.now(); const current = windows.get(key);
  if (!current || now - current.start > 60_000) { windows.set(key, { start: now, count: 1 }); return true; }
  current.count += 1; return current.count <= 120;
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 16_384) return NextResponse.json({ error: "Evento demasiado grande." }, { status: 413 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isAnalyticsEventName(body.eventName) || typeof body.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) {
    return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  }
  if (!allowed(body.sessionId)) return NextResponse.json({ error: "Demasiados eventos." }, { status: 429 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Telemetría no configurada." }, { status: 503 });
  const identity = await authenticatedUser(request);
  if (requestBearer(request) && !identity) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const runtime = runtimeIdentity();
  const row = {
    user_id: identity?.user.id || null, session_id: body.sessionId, event_name: body.eventName,
    event_category: eventCategory(body.eventName), round_id: typeof body.roundId === "string" ? body.roundId.slice(0, 120) : null,
    metadata: sanitizeTelemetryMetadata(body.metadata), app_version: runtime.appVersion, build_sha: runtime.buildSha,
    environment: runtime.environment, device_type: String(body.deviceType || "unknown").slice(0, 24), platform: String(body.platform || "unknown").slice(0, 24),
  };
  const { error } = await admin.from("analytics_events").insert(row);
  if (error) return NextResponse.json({ error: "No fue posible registrar el evento." }, { status: 503 });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
