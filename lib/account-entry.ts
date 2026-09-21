import type { BetaOnboardingProgress } from './beta-onboarding';
/** Account mapping is read only after Auth verification. No email lookup API. */
export type AccountEntry = {
  userId: string;
  profileExists: boolean;
  existingAccount: boolean;
  onboardingProgress?: BetaOnboardingProgress | null;
};

export function establishedBackyardAccount(profile: { onboarding_completed_at: string | null } | null, legalTypes: string[]) {
  // Auth creates a skeletal profile immediately, so row existence alone cannot
  // distinguish a new registration. Older accounts may predate the completion
  // column; their explicit server-side legal acceptances are durable evidence.
  return Boolean(profile && (profile.onboarding_completed_at || (legalTypes.includes("terms") && legalTypes.includes("privacy"))));
}

export async function readAccountEntry(accessToken: string, expectedUserId: string, signal?: AbortSignal): Promise<AccountEntry> {
  if (!accessToken) throw new Error("Inicia sesión para verificar tu cuenta.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 18_000);
  try {
  const response = await fetch("/api/account/entry", {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: controller.signal,
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || value.userId !== expectedUserId || typeof value.profileExists !== "boolean" || typeof value.existingAccount !== "boolean") {
    throw new Error(response.status === 403 ? "Esta cuenta está desactivada o tiene un cierre pendiente. Contacta soporte." : "No pudimos verificar tu cuenta. Reintenta antes de continuar.");
  }
  return value;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error("La verificación tardó demasiado. Reintenta antes de continuar.");
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
}

/** Shared race barrier: a delayed account A response cannot unlock account B
 * or a logged-out/new-device setup. Returning null performs no state change. */
export async function readCurrentAccountEntry(accessToken: string, expectedUserId: string, currentUserId: () => string | null, signal: AbortSignal) {
  const mapping = await readAccountEntry(accessToken, expectedUserId, signal);
  return signal.aborted || currentUserId() !== expectedUserId ? null : mapping;
}

const INTENT_KEY = "the-backyard:auth-entry-intent:v1";
export function rememberAccountEntryIntent(storage: Pick<Storage, "setItem">, intent: "create" | "login") {
  try { storage.setItem(INTENT_KEY, intent); } catch { /* UX hint only, never authorization. */ }
}
export function consumeAccountEntryIntent(storage: Pick<Storage, "getItem" | "removeItem">): "create" | "login" | null {
  try { const value = storage.getItem(INTENT_KEY); storage.removeItem(INTENT_KEY); return value === "create" || value === "login" ? value : null; }
  catch { return null; }
}
