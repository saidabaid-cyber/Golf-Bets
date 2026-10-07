import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { isCrossSiteRequest } from "../../../../lib/backyard-ai/server/http-security";
import { isGpsPilotTester } from "../../../../lib/gps-pilot-la-vista-1/access";
import { pilotHostEnabled } from "../../../../lib/gps-pilot-la-vista-1/pilot.mjs";
import target from "../../../../lib/gps-pilot-la-vista-1/target.json";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" } });

export async function GET(request: NextRequest) {
  if (!pilotHostEnabled({ enabled: process.env.GPS_LA_VISTA_1_PILOT_ENABLED,
    branch: process.env.VERCEL_GIT_COMMIT_REF, deploymentEnvironment: process.env.VERCEL_ENV,
    host: request.headers.get("host") })) return json({ error: "Prueba no disponible." }, 404);
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida.", code: "CROSS_SITE_DENIED" }, 403);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  // Private branch-scoped entitlement gives access to this read-only pilot only.
  // No role assignment, Course Master permission, DB mutation or location upload.
  if (!isGpsPilotTester(account.userId, process.env.GPS_LA_VISTA_1_PILOT_USER_IDS)) {
    const access = await requireAdminMode(request, "courses");
    if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  }
  return json({ target });
}
