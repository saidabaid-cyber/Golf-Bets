import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { parseAccountDeletionChoice } from "../../../../lib/account-deletion";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

/** Both choices are validated before any audit, storage, database or Auth
 * mutation. Neither can be represented as completed until its independent
 * safety boundary is actually certified on an isolated Preview database. */
export async function DELETE(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ code: "CROSS_SITE", error: "Solicitud no permitida." }, 403);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  if (!isJsonRequest(request)) return json({ code: "UNSUPPORTED_MEDIA_TYPE", error: "La solicitud debe usar JSON." }, 415);
  const read = await readJsonBodyWithLimit(request, 1_024);
  if (!read.ok) return json({ code: read.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST", error: "La solicitud no es válida." }, read.reason === "too_large" ? 413 : 400);
  const choice = parseAccountDeletionChoice(read.value);
  if (!choice) return json({ code: "INVALID_ACCOUNT_DELETE_CHOICE", error: "Confirma escribiendo ELIMINAR y selecciona qué hacer con tus datos de golf." }, 400);

  if (choice.dataPolicy === "retain_history") {
    return json({
      code: "LEGAL_REVIEW_REQUIRED",
      error: "Conservar el histórico requiere una política legal de retención y recuperación, más aislamiento de sesiones y datos. No se archivó la cuenta ni se borró ningún dato.",
      noDataDeleted: true,
    }, 503);
  }

  return json({
    code: "PENDING_CONTROLLED_DB_APPLY",
    error: "La eliminación irreversible requiere un grafo transaccional y QA en una base Preview aislada. No se borró ningún dato.",
    noDataDeleted: true,
  }, 503);
}
