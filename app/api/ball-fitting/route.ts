import { NextRequest, NextResponse } from "next/server";

import {
  BALL_FIT_CATALOG_MAX_CANDIDATES,
  BALL_FIT_CATALOG_SCOPE_ERROR,
  normalizeBallFitTransportInput,
} from "../../../lib/ball-fitting-api";
import { runBackyardBallFit } from "../../../lib/ball-fitting";
import { internalEquipmentCatalogProvider } from "../../../lib/equipment-catalog-provider.server";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64_000;

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });
  }
  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const source = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const input = normalizeBallFitTransportInput(source?.input);
  if (!input) return NextResponse.json({ error: "Datos de Ball Fit inválidos." }, { status: 400 });

  const scope = await internalEquipmentCatalogProvider.loadBallFitCatalog({
    currentBallId: input.currentBallId,
    maximumCandidates: BALL_FIT_CATALOG_MAX_CANDIDATES,
  });
  if (!scope.complete) {
    return NextResponse.json({
      error: "El catálogo completo no cabe en el alcance seguro de esta versión; no se calculó un ranking parcial.",
      code: BALL_FIT_CATALOG_SCOPE_ERROR,
      scope,
    }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }

  const result = runBackyardBallFit(scope.items, input);
  const selectedIds = new Set([
    ...(input.currentBallId ? [input.currentBallId] : []),
    ...result.recommendations.map((recommendation) => recommendation.catalogBallId),
  ]);
  const catalog = scope.items.filter((ball) => selectedIds.has(ball.id));
  return NextResponse.json({
    provider: internalEquipmentCatalogProvider.id,
    scope: {
      complete: true,
      activeCandidateCount: scope.activeCandidateCount,
      evaluatedCandidateCount: scope.evaluatedCandidateCount,
      maximumCandidates: scope.maximumCandidates,
    },
    result,
    catalog,
  }, { headers: { "cache-control": "private, no-store" } });
}
