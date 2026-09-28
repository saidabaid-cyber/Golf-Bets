import "server-only";

import { NextRequest } from "next/server";

import { isCrossSiteRequest } from "../backyard-ai/server/http-security";
import { authenticatedRequest } from "../server-auth";
import { resolveGhinPreviewCapabilities } from "./config";
import { privateGhinJson } from "./qa-access.server";

/** Preview-only gate for a signed-in golfer. Unlike the diagnostic QA gate,
 * this deliberately has no admin membership check and grants no access to the
 * environment-owned QA credentials. */
export async function ghinUserContext(request: NextRequest) {
  const capabilities = resolveGhinPreviewCapabilities(process.env);
  if (!capabilities.previewOnly || !capabilities.readOnlyEnabled || !capabilities.golferLookup) {
    return { ok: false as const, response: privateGhinJson({ error: "Ruta no disponible.", code: "FEATURE_DISABLED" }, 404) };
  }
  if (capabilities.scorePostingEnabled) {
    return { ok: false as const, response: privateGhinJson({ error: "Configuración de Preview no segura.", code: "SCORE_POSTING_MUST_BE_OFF" }, 503) };
  }
  if (isCrossSiteRequest(request)) {
    return { ok: false as const, response: privateGhinJson({ error: "Solicitud no permitida.", code: "CROSS_SITE_REJECTED" }, 403) };
  }
  const account = await authenticatedRequest(request);
  if (!account.ok) {
    return { ok: false as const, response: privateGhinJson({ error: account.error, code: account.code }, account.status) };
  }
  return account;
}
