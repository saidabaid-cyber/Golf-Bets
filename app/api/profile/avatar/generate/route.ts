import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generateAvatarCandidate } from "../../../../../lib/avatar-generation-service";
import { avatarGenerationDeps } from "../../../../../lib/avatar-generation-server";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ code: "CROSS_SITE", error: "Solicitud no permitida." }, 403);
  if (!isJsonRequest(request)) return json({ code: "UNSUPPORTED_MEDIA_TYPE", error: "La solicitud debe usar JSON." }, 415);
  const read = await readJsonBodyWithLimit(request, 190_000);
  if (!read.ok) return json({ code: read.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST", error: read.reason === "too_large" ? "La foto seleccionada es demasiado grande." : "Solicitud inválida." }, read.reason === "too_large" ? 413 : 400);
  const result = await generateAvatarCandidate(read.value, avatarGenerationDeps(request));
  return json(result.body, result.status);
}
