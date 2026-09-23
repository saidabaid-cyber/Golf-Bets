import "server-only";

import {
  BACKYARD_AI_PROVIDER_CONSENT_VERSION,
  type BackyardAiProcessingConsentScope,
} from "../privacy";
import { AI_PROCESSING_CONSENT_TABLE } from "../consent-record";
import { getSupabaseForUser } from "../../supabase/server";
import { accountAccessFailure } from "../../account-access.server";
import { authUserFailure } from "../../auth-errors";
import { aiProcessingConsentLedgerAccess } from "./config";

export type StoredAiConsentVerification =
  | { ok: true; authenticated: boolean; userId: string | null }
  | { ok: false; status: number; code: string; error: string };

function bearer(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

/** Guest sessions keep an owner-scoped local consent. Supabase is the
 * authoritative consent state for every authenticated provider request. */
export async function verifyStoredAiProcessingConsent(
  request: Request,
  scope: BackyardAiProcessingConsentScope,
): Promise<StoredAiConsentVerification> {
  const token = bearer(request);
  if (!token) return { ok: true, authenticated: false, userId: null };
  const ledgerAccess = aiProcessingConsentLedgerAccess(process.env, true);
  if (!ledgerAccess.allowed) {
    return {
      ok: false,
      status: 503,
      code: "consent_environment_blocked",
      error: "El registro seguro de autorizaciones no está habilitado para cuentas en este Preview.",
    };
  }
  const userClient = getSupabaseForUser(token);
  if (!userClient) return { ok: false, status: 503, code: "missing_config", error: "Backyard AI no está configurado para verificar esta autorización." };
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  const failure = authUserFailure(authError, !authError && Boolean(authData.user));
  if (failure) return { ok: false, ...failure };
  if (!authData.user || authData.user.is_anonymous) return { ok: false, status: 401, code: "auth_required", error: "La sesión terminó. Vuelve a iniciar sesión." };
  const accessFailure = await accountAccessFailure(userClient);
  if (accessFailure) return { ok: false, ...accessFailure };
  const { data, error } = await userClient
    .from(AI_PROCESSING_CONSENT_TABLE)
    .select("decision_status,accepted_at,revoked_at")
    .eq("user_id", authData.user.id)
    .eq("scope", scope)
    .eq("policy_version", BACKYARD_AI_PROVIDER_CONSENT_VERSION)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, status: 503, code: "consent_store_unavailable", error: "No pude verificar tu autorización de IA. Inténtalo nuevamente." };
  if (!data || data.decision_status !== "accepted" || !data.accepted_at || data.revoked_at !== null) return { ok: false, status: 403, code: "consent_required", error: "Activa esta autorización en Cuenta y privacidad / IA para continuar." };
  return { ok: true, authenticated: true, userId: authData.user.id };
}
