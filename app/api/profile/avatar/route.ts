import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { avatarCapabilities } from "../../../../lib/avatar-generation-service";
import { avatarGenerationDeps } from "../../../../lib/avatar-generation-server";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json({ code: "CROSS_SITE", error: "Solicitud no permitida." }, { status: 403, headers: BACKYARD_AI_PRIVATE_HEADERS });
  }
  const result = await avatarCapabilities(avatarGenerationDeps(request));
  return NextResponse.json(result.body, { status: result.status, headers: BACKYARD_AI_PRIVATE_HEADERS });
}
