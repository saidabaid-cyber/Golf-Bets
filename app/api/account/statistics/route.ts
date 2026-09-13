import { NextRequest, NextResponse } from "next/server";

import { authenticatedRequest } from "../../../../lib/server-auth";
import { STATISTICS_DELETE_CONFIRMATION, STATISTICS_RESET_STRATEGY } from "../../../../lib/statistics-reset";

const PRIVATE = { "cache-control": "private, no-store" };

function statisticsSchemaPending(error: { code?: string; message?: string } | null | undefined) {
  return ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error?.code || "")
    || /reset_my_statistics|user_statistics_resets|schema cache/i.test(error?.message || "");
}

export async function GET(request: NextRequest) {
  const account = await authenticatedRequest(request);
  if (!account.ok) return NextResponse.json({ error: account.error, code: account.code }, { status: account.status, headers: PRIVATE });
  const result = await account.client.from("user_statistics_resets").select("reset_at,strategy").eq("user_id", account.userId).maybeSingle();
  if (result.error) return NextResponse.json({ error: statisticsSchemaPending(result.error) ? "El reset seguro de estadísticas requiere la migración controlada de Preview." : "No pudimos consultar el estado de tus estadísticas." }, { status: 503, headers: PRIVATE });
  return NextResponse.json(result.data ? { resetAt: result.data.reset_at, strategy: result.data.strategy } : { resetAt: null, strategy: STATISTICS_RESET_STRATEGY }, { headers: PRIVATE });
}

export async function DELETE(request: NextRequest) {
  const account = await authenticatedRequest(request);
  if (!account.ok) return NextResponse.json({ error: account.error, code: account.code }, { status: account.status, headers: PRIVATE });
  const body = await request.json().catch(() => null) as { confirmation?: string } | null;
  if (body?.confirmation !== STATISTICS_DELETE_CONFIRMATION) return NextResponse.json({ error: "Escribe ELIMINAR para confirmar." }, { status: 400, headers: PRIVATE });

  // The RPC derives ownership exclusively from auth.uid(); no client-provided
  // user id can select or reset another golfer's data.
  const result = await account.client.rpc("reset_my_statistics", { confirmation_text: body.confirmation });
  if (result.error) return NextResponse.json({ error: statisticsSchemaPending(result.error) ? "El reset seguro de estadísticas requiere la migración controlada de Preview." : "No se eliminaron las estadísticas. Tu histórico permanece intacto." }, { status: 503, headers: PRIVATE });
  const resetAt = Array.isArray(result.data) ? result.data[0] : result.data;
  if (typeof resetAt !== "string" || !Number.isFinite(Date.parse(resetAt))) return NextResponse.json({ error: "El servidor no confirmó el reset de estadísticas." }, { status: 500, headers: PRIVATE });
  return NextResponse.json({ resetAt, strategy: STATISTICS_RESET_STRATEGY }, { headers: PRIVATE });
}
