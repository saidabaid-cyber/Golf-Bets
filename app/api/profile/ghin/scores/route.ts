import { NextRequest } from "next/server";

import { GhinClientError } from "../../../../../lib/ghin/client";
import { SlidingWindowRateLimiter } from "../../../../../lib/ghin/core";
import { GHIN_QA_NUMBER } from "../../../../../lib/ghin/profile";
import { ghinQaContext, privateGhinJson } from "../../../../../lib/ghin/qa-access.server";
import { resolveGhinRuntime } from "../../../../../lib/ghin/runtime.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = new SlidingWindowRateLimiter<string>({ limit: 4, windowMs: 10 * 60_000 });

export async function GET(request: NextRequest) {
  const context = await ghinQaContext(request);
  if (!context.ok) return context.response;
  if (request.nextUrl.search) return privateGhinJson({ error: "Solicitud inválida.", code: "SELECTORS_REJECTED" }, 400);
  const decision = limiter.consume(context.userId);
  if (!decision.allowed) {
    return privateGhinJson({ error: "Espera antes de consultar scores nuevamente.", code: "RATE_LIMITED" }, 429);
  }
  const linked = await context.client
    .from("player_handicap_provider_profiles")
    .select("external_player_id")
    .eq("owner_id", context.userId)
    .eq("provider", "GHIN")
    .eq("external_player_id", GHIN_QA_NUMBER)
    .maybeSingle();
  if (linked.error) return privateGhinJson({ error: "No fue posible comprobar el vínculo GHIN.", code: "PROFILE_READ_FAILED" }, 503);
  if (!linked.data) return privateGhinJson({ error: "Primero vincula la cuenta GHIN QA.", code: "GHIN_NOT_LINKED" }, 409);

  const runtimeState = resolveGhinRuntime();
  if (!runtimeState.ok || !runtimeState.capabilities.golferLookup) {
    return privateGhinJson({ error: "GHIN no está disponible en este Preview.", code: "GHIN_DISABLED" }, 503);
  }
  try {
    runtimeState.client.invalidateScores(GHIN_QA_NUMBER);
    const result = await runtimeState.client.getScores(GHIN_QA_NUMBER, 1_000);
    return privateGhinJson({
      available: true,
      count: result.data.length,
      fetchedAt: result.fetchedAt,
      httpStatus: result.httpStatus,
      items: result.data.slice(0, 20),
      truncated: result.data.length > 20,
      safety: { readOnly: true, scorePostingCalls: 0 },
    });
  } catch (error) {
    const code = error instanceof GhinClientError ? error.code.toUpperCase() : "UNKNOWN";
    return privateGhinJson({ error: "No se pudo consultar el scoring record.", code }, 502);
  }
}
