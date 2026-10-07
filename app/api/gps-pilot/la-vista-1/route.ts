import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { pilotHostEnabled } from "../../../../lib/gps-pilot-la-vista-1/pilot.mjs";
import target from "../../../../lib/gps-pilot-la-vista-1/target.json";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" } });

export async function GET(request: NextRequest) {
  if (!pilotHostEnabled({ enabled: process.env.GPS_LA_VISTA_1_PILOT_ENABLED,
    branch: process.env.VERCEL_GIT_COMMIT_REF, deploymentEnvironment: process.env.VERCEL_ENV,
    host: request.headers.get("host") })) return json({ error: "Prueba no disponible." }, 404);
  // Reuse existing authenticated lifecycle + server-checked field-admin permission.
  // Read only; no Course Master import, membership changes or location upload.
  const access = await requireAdminMode(request, "courses");
  if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  return json({ target });
}
