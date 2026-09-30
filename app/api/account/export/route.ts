import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { BACKYARD_AI_PRIVATE_HEADERS } from "../../../../lib/backyard-ai/server/http-security";
import { authenticatedRequest } from "../../../../lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Fail-closed compatibility boundary for the retired self-service export.
 * Authentication still distinguishes an absent/expired session (401), but no
 * authenticated caller can use this URL to read account tables. Privacy
 * exports now go through the audited administrative workflow.
 */
export async function GET(request: NextRequest) {
  const account = await authenticatedRequest(request);
  if (!account.ok) {
    return NextResponse.json(
      { error: account.error, code: account.code },
      { status: account.status, headers: BACKYARD_AI_PRIVATE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      error: "La exportación de datos se atiende mediante el proceso de privacidad.",
      code: "SELF_SERVICE_EXPORT_DISABLED",
    },
    { status: 403, headers: BACKYARD_AI_PRIVATE_HEADERS },
  );
}
