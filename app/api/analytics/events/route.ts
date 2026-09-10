import { NextRequest, NextResponse } from "next/server";

import { isProductEventName, sanitizeProductEventMetadata } from "../../../../features/analytics/domain";
import { authenticatedRequest } from "../../../../lib/server-auth";

const PRIVATE = { "cache-control": "private, no-store" };

export async function POST(request: NextRequest) {
  const account = await authenticatedRequest(request);
  if (!account.ok) return NextResponse.json({ error: account.error, code: account.code }, { status: account.status, headers: PRIVATE });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Evento inválido.", code: "INVALID_EVENT" }, { status: 400, headers: PRIVATE }); }
  const source = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!source || !isProductEventName(source.eventName)) return NextResponse.json({ error: "Evento inválido.", code: "INVALID_EVENT" }, { status: 400, headers: PRIVATE });
  const eventId = typeof source.eventId === "string" && /^[a-zA-Z0-9_-]{12,100}$/.test(source.eventId) ? source.eventId : "";
  if (!eventId) return NextResponse.json({ error: "Falta un identificador idempotente.", code: "INVALID_EVENT_ID" }, { status: 400, headers: PRIVATE });
  const { error } = await account.client.from("product_usage_events_v2").insert({
    id: eventId,
    owner_id: account.userId,
    event_name: source.eventName,
    metadata: sanitizeProductEventMetadata(source.metadata),
    occurred_at: typeof source.occurredAt === "string" && !Number.isNaN(Date.parse(source.occurredAt)) ? source.occurredAt : new Date().toISOString(),
  });
  if (error && error.code !== "23505") {
    const schemaMissing = ["42P01", "PGRST204", "PGRST205"].includes(error.code || "");
    return NextResponse.json({ error: schemaMissing ? "Analytics se habilitará tras la migración controlada de Preview." : "No pudimos registrar el evento.", code: schemaMissing ? "ANALYTICS_SCHEMA_PENDING" : "ANALYTICS_WRITE_FAILED" }, { status: 503, headers: PRIVATE });
  }
  return NextResponse.json({ ok: true, duplicate: error?.code === "23505" }, { headers: PRIVATE });
}
