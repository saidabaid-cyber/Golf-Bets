import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest } from "../backyard-ai/server/http-security";
import { authenticatedRequest } from "../server-auth";
import { resolveGhinPreviewCapabilities } from "./config";

export function privateGhinJson(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...BACKYARD_AI_PRIVATE_HEADERS, ...headers },
  });
}

/** Preview-only and server-authoritative gate for the temporary QA integration. */
export async function ghinQaContext(request: NextRequest) {
  const capabilities = resolveGhinPreviewCapabilities(process.env);
  if (!capabilities.previewOnly || !capabilities.readOnlyEnabled) {
    return { ok: false as const, response: privateGhinJson({ error: "Ruta no disponible.", code: "FEATURE_DISABLED" }, 404) };
  }
  if (isCrossSiteRequest(request)) {
    return { ok: false as const, response: privateGhinJson({ error: "Solicitud no permitida.", code: "CROSS_SITE_REJECTED" }, 403) };
  }
  const account = await authenticatedRequest(request);
  if (!account.ok) {
    return { ok: false as const, response: privateGhinJson({ error: account.error, code: account.code }, account.status) };
  }
  const memberships = await account.client
    .from("admin_memberships")
    .select("id")
    .eq("user_id", account.userId)
    .eq("active", true)
    .limit(1);
  if (memberships.error) {
    return { ok: false as const, response: privateGhinJson({ error: "No fue posible comprobar el acceso QA.", code: "ADMIN_CHECK_FAILED" }, 503) };
  }
  if (!memberships.data?.length) {
    return { ok: false as const, response: privateGhinJson({ error: "Ruta no disponible.", code: "QA_ACCESS_REQUIRED" }, 404) };
  }
  return account;
}
