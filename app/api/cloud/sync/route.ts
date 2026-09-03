import { NextRequest, NextResponse } from "next/server";
import { getSupabaseForUser } from "../../../../lib/supabase/server";
import { cloudServerEnabled } from "../../../../lib/feature-flags";
import type { CloudDataBundle } from "../../../../lib/cloud-sync";
import { readCloudBundle, writeCloudBundle } from "../../../../lib/cloud-sync-service";

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


export async function GET(request: NextRequest) {
  try {
    const account = await accountClient(request);
    if ("error" in account) return NextResponse.json({ error: account.error }, { status: account.status });
    const data = await readCloudBundle(account.client, account.userId);
    return NextResponse.json({ data }, { headers: { "cache-control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "No pudimos leer Supabase. Tus datos locales se conservan; reintenta la sincronización." }, { status: 503 }); }
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
  } catch { return NextResponse.json({ error: "La sincronización no terminó. Puede haber datos pendientes; tu copia local se conserva. Reintenta." }, { status: 503 }); }
}
