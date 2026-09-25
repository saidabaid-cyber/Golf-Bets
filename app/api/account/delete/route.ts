import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { parseAccountDeletionChoice } from "../../../../lib/account-deletion";
import { authenticatedRequest, bearerToken } from "../../../../lib/server-auth";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import {
  AccountLifecycleStageError,
  accountLifecycleEnabled,
  accountLifecycleFailureResponse,
  accountLifecycleSafeError,
  executeAccountLifecycle,
  runAccountLifecycleStage,
} from "../../../../lib/account-lifecycle";
import { accountLifecycleGateway, lifecycleRequestReference, recoverAccountLifecycleActor } from "../../../../lib/account-lifecycle.server";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, isJsonRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });
}

/** No 2xx until the graph AND Auth operations are complete. */
export async function DELETE(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ code: "CROSS_SITE", error: "Solicitud no permitida." }, 403);
  if (!isJsonRequest(request)) return json({ code: "UNSUPPORTED_MEDIA_TYPE", error: "La solicitud debe usar JSON." }, 415);
  const read = await readJsonBodyWithLimit(request, 1_024);
  if (!read.ok) return json({ code: read.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST", error: "La solicitud no es válida." }, read.reason === "too_large" ? 413 : 400);
  const choice = parseAccountDeletionChoice(read.value);
  if (!choice) return json({ code: "INVALID_ACCOUNT_DELETE_CHOICE", error: "Confirma escribiendo ELIMINAR y selecciona qué hacer con tus datos de golf." }, 400);

  const token = bearerToken(request);
  if (!token && !choice.recoveryToken) return json({ code: "AUTH_REQUIRED", error: "Inicia sesión para continuar." }, 401);
  if (!accountLifecycleEnabled()) return json({ code: "CONTROLLED_DB_ACTION_REQUIRED", error: "Esta función no está disponible en este entorno. Contacta soporte.", noDataDeleted: true }, 503);
  const admin = getSupabaseAdmin();
  if (!admin) return json({ code: "CONTROLLED_DB_ACTION_REQUIRED", error: "No pudimos conectar el servicio de cuentas. Intenta más tarde.", noDataDeleted: true }, 503);
  const reportFailure = (error: unknown, context: { secondary?: boolean; operationCompleted?: boolean } = {}) => {
    console.error("account_lifecycle", {
      operation: choice.dataPolicy,
      requestIdRef: lifecycleRequestReference(choice.requestId),
      ...accountLifecycleSafeError(error),
      secondary: context.secondary === true,
      operationCompleted: context.operationCompleted === true,
    });
  };
  try {
    const account = token
      ? await runAccountLifecycleStage("authenticate", () => authenticatedRequest(request, { allowLifecycleRecovery: true }))
      : { ok: false as const, status: 401, code: "AUTH_REQUIRED" };
    let actor = account.ok ? account.userId : null;
    if (!actor) {
      actor = await runAccountLifecycleStage("recover", () => recoverAccountLifecycleActor(admin, choice.requestId, choice.dataPolicy, choice.recoveryToken || token));
      if (!actor) throw new AccountLifecycleStageError(token ? "authenticate" : "recover", {
        code: account.code,
        errorClass: "AuthenticationFailure",
        status: account.status,
      });
    }
    const gateway = accountLifecycleGateway(
      admin,
      actor,
      choice.requestId,
      choice.dataPolicy,
      token,
      choice.recoveryToken,
      (error, context) => reportFailure(error, context),
    );
    const job = await executeAccountLifecycle(gateway);
    const archived = job.data_policy === "retain_history";
    return json({ ok: true, deleted: !archived, archived, accountStatus: archived ? "archived" : "deleted",
      legalReview: "LEGAL_REVIEW_REQUIRED", message: archived ? "Tu cuenta quedó desactivada. Tu historial se conserva según la política aplicable." : "Tu cuenta fue eliminada." });
  } catch (error) {
    reportFailure(error);
    const failure = accountLifecycleFailureResponse(error);
    return json(failure.body, failure.status);
  }
}
