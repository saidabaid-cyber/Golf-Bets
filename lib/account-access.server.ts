import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isolatedPreviewDatabaseEnabled } from "./preview-database";

const unavailable = () => ({ status: 503, code: "ACCOUNT_STATUS_UNAVAILABLE", error: "No pudimos verificar el estado de tu cuenta. Intenta de nuevo." });

export async function accountAccessFailure(client: SupabaseClient) {
  // Disabling new close-account requests must never reactivate an archived
  // account. Access checks depend on the DB binding, not the mutation flag.
  if (!isolatedPreviewDatabaseEnabled()) return null;
  try {
    const result = await client.rpc("account_access_status").abortSignal(AbortSignal.timeout(8_000));
    if (result.error) return unavailable();
    if (["closing", "archived", "deleted"].includes(result.data)) return {
      status: 403, code: "ACCOUNT_ACCESS_RESTRICTED",
      error: "Esta cuenta está desactivada o tiene una operación de cierre pendiente. Contacta soporte para recuperarla.",
    };
    return result.data === "active" ? null : unavailable();
  } catch {
    return unavailable();
  }
}
