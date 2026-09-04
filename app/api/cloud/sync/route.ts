import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "../../../../lib/supabase/server";
import { cloudServerEnabled } from "../../../../lib/feature-flags";
import type { CloudDataBundle } from "../../../../lib/cloud-sync";
import { readCloudBundle, supportsExtendedCloudSchema, writeCloudBundle } from "../../../../lib/cloud-sync-service";

const MAX_BODY_BYTES = 5_000_000;

function bearer(request: NextRequest) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

async function accountClient(request: NextRequest) {
  if (!cloudServerEnabled) return { error: "La sincronización de nube está desactivada.", status: 503 } as const;
  const token = bearer(request);
  if (!token) return { error: "Inicia sesión para sincronizar con Supabase.", status: 401 } as const;
  const client = token ? getSupabaseForUser(token) : null;
  if (!client) return { error: "Nube no configurada.", status: 503 } as const;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { error: "Sesión inválida.", status: 401 } as const;
  return { client, userId: data.user.id } as const;
}

function safeFailure(error: unknown) {
  const candidate = (error && typeof error === "object" ? error : {}) as { code?: string; message?: string };
  const code = String(candidate.code || "");
  const message = String(candidate.message || (error instanceof Error ? error.message : ""));
  if (code === "CLOUD_FIELD_CONFLICT") return "Otro dispositivo cambió el mismo dato. Actualiza para elegir cuál conservar.";
  if (code === "42501" || /permission denied|row-level security/i.test(message)) return "La nube rechazó esta operación. Vuelve a iniciar sesión y reintenta; tu copia local se conserva.";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /schema cache|does not exist/i.test(message)) return "La nube no pudo completar esta sincronización. Tu copia local se conserva; reintenta más tarde.";
  return "La sincronización no terminó. Puede haber datos pendientes; tu copia local se conserva. Reintenta.";
}

function logFailure(operation: "read" | "write", error: unknown) {
  const candidate = (error && typeof error === "object" ? error : {}) as { code?: string; status?: number };
  console.error("backyard_cloud_sync_failed", { operation, code: String(candidate.code || "unknown").slice(0, 32), status: candidate.status || null });
}


export async function GET(request: NextRequest) {
  try {
    const account = await accountClient(request);
    if ("error" in account) return NextResponse.json({ error: account.error }, { status: account.status });
    const extendedSchema = await supportsExtendedCloudSchema(account.client);
    const data = await readCloudBundle(account.client, account.userId, extendedSchema);
    return NextResponse.json({ data }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { logFailure("read", error); return NextResponse.json({ error: safeFailure(error) }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  try {
    const account = await accountClient(request);
    if ("error" in account) return NextResponse.json({ error: account.error }, { status: account.status });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Los datos exceden el tamaño permitido." }, { status: 413 });
  const body = await request.json().catch(() => null) as { data?: Partial<CloudDataBundle>; fingerprint?: string } | null;
  if (!body?.data || body.data.version !== 1 || typeof body.fingerprint !== "string") return NextResponse.json({ error: "Paquete de sincronización inválido." }, { status: 400 });
  const serializedLength = JSON.stringify(body).length;
  if (serializedLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Los datos exceden el tamaño permitido." }, { status: 413 });


    const result = await writeCloudBundle(account.client, account.userId, body as { data: CloudDataBundle; fingerprint: string });
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { logFailure("write", error); const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""; return NextResponse.json({ error: safeFailure(error) }, { status: code === "CLOUD_FIELD_CONFLICT" ? 409 : 503 }); }
}
