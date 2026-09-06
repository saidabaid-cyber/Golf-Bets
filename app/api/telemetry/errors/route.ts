import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { authenticatedUser, requestBearer, runtimeIdentity } from "../../../../lib/server-runtime";
import { sanitizeOperationalMessage, sanitizeTelemetryMetadata } from "../../../../lib/telemetry";

const windows = new Map<string, { start: number; count: number }>();
function allowed(key: string) {
  const now = Date.now(); const current = windows.get(key);
  if (!current || now - current.start > 60_000) { windows.set(key, { start: now, count: 1 }); return true; }
  current.count += 1; return current.count <= 30;
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 16_384) return NextResponse.json({ error: "Reporte demasiado grande." }, { status: 413 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.errorType !== "string" || !body.errorType.trim()) return NextResponse.json({ error: "Error inválido." }, { status: 400 });
  if (!allowed(String(body.sessionId || "anonymous"))) return NextResponse.json({ error: "Demasiados reportes." }, { status: 429 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Monitoreo no configurado." }, { status: 503 });
  const identity = await authenticatedUser(request); const runtime = runtimeIdentity();
  if (requestBearer(request) && !identity) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const { error } = await admin.from("app_errors").insert({
    user_id: identity?.user.id || null, session_id: typeof body.sessionId === "string" ? body.sessionId : null,
    error_type: body.errorType.slice(0, 80), error_code: typeof body.errorCode === "string" ? body.errorCode.slice(0, 80) : null,
    message_sanitized: sanitizeOperationalMessage(body.message), route: String(body.route || "/").slice(0, 160),
    metadata: sanitizeTelemetryMetadata(body.metadata), app_version: runtime.appVersion, build_sha: runtime.buildSha, environment: runtime.environment,
  });
  if (error) return NextResponse.json({ error: "No fue posible registrar el error." }, { status: 503 });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
