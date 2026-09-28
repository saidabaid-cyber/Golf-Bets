import { NextRequest } from "next/server";

import { privateGhinJson } from "../../../../../lib/ghin/qa-access.server";
import { ghinUserContext } from "../../../../../lib/ghin/user-access.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Kept as a compatibility tombstone so an older client cannot accidentally
 * fall back to the global QA diagnostic session. User-owned scoring-record
 * reads are POST { operation: "scores" } on /api/profile/ghin. */
export async function GET(request: NextRequest) {
  const context = await ghinUserContext(request);
  if (!context.ok) return context.response;
  return privateGhinJson({ error: "Actualiza la aplicación para consultar tu scoring record.", code: "ROUTE_MOVED" }, 410);
}
