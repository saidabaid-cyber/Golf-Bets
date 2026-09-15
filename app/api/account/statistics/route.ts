import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { authenticatedRequest } from "../../../../lib/server-auth";
import { executeStatisticsReset, statisticsResetStatus, type StatisticsResetGateway } from "../../../../lib/statistics-reset-execution";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const READ_TIMEOUT_MS = 8_000;
const RPC_TIMEOUT_MS = 15_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

function gateway(account: Extract<Awaited<ReturnType<typeof authenticatedRequest>>, { ok: true }>): StatisticsResetGateway {
  return {
    canonical: async userId => {
      const result = await account.client.from("user_statistics_resets")
        .select("reset_at,strategy").eq("user_id", userId)
        .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS)).maybeSingle();
      return { data: result.data, error: result.error };
    },
    request: async (userId, requestId) => {
      const result = await account.client.from("user_statistics_reset_requests")
        .select("reset_at").eq("user_id", userId).eq("request_id", requestId)
        .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS)).maybeSingle();
      return { data: result.data, error: result.error };
    },
    execute: async (confirmation, requestId) => {
      // The SQL function derives ownership exclusively from auth.uid(). The
      // request key makes a retry after timeout safe across server instances.
      const result = await account.client.rpc("reset_my_statistics", {
        confirmation_text: confirmation,
        request_id: requestId,
      }).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
      return { data: result.data, error: result.error };
    },
  };
}

export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ code: "CROSS_SITE", error: "Solicitud no permitida." }, 403);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  const result = await statisticsResetStatus(gateway(account), account.userId);
  return json(result.body, result.status);
}

export async function DELETE(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ code: "CROSS_SITE", error: "Solicitud no permitida." }, 403);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  if (!isJsonRequest(request)) return json({ code: "UNSUPPORTED_MEDIA_TYPE", error: "La solicitud debe usar JSON." }, 415);
  const read = await readJsonBodyWithLimit(request, 1_024);
  if (!read.ok) return json({ code: read.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST", error: "La solicitud de reset no es válida." }, read.reason === "too_large" ? 413 : 400);
  const result = await executeStatisticsReset(read.value, gateway(account), account.userId);
  return json(result.body, result.status);
}
