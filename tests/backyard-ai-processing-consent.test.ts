import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  beginAiProcessingConsentMutation,
  resolveAuthoritativeAiProcessingConsent,
} from "../lib/backyard-ai/consent-client";
import { AI_PROCESSING_CONSENT_TABLE, parseAiProcessingConsentScope } from "../lib/backyard-ai/consent-record";
import {
  acceptAiProcessingConsent,
  deleteAiProcessingConsents,
  hasActiveAiProcessingConsent,
  readAiProcessingConsent,
  reconcileAuthoritativeAiProcessingConsent,
  revokeAiProcessingConsent,
} from "../lib/backyard-ai/processing-consent";
import {
  AI_IMAGE_PROCESSING_CONSENT,
  AI_PROVIDER_PROCESSING_CONSENT,
  BACKYARD_AI_PROVIDER_CONSENT_VERSION,
} from "../lib/backyard-ai/privacy";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const FIRST_ACCEPTANCE = "2026-09-08T18:00:00.000Z";
const LATER = "2026-09-08T19:00:00.000Z";

test("consentimientos de instrucciones y fotos son owner-scoped, separados y persistentes", () => {
  const storage = new MemoryStorage();
  const accepted = acceptAiProcessingConsent(storage as unknown as Storage, "user-a", AI_PROVIDER_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  assert.equal(accepted.ok && accepted.persisted, true);
  assert.equal(hasActiveAiProcessingConsent(storage, "user-a", AI_PROVIDER_PROCESSING_CONSENT), true);
  assert.equal(hasActiveAiProcessingConsent(storage, "user-a", AI_IMAGE_PROCESSING_CONSENT), false);
  assert.equal(hasActiveAiProcessingConsent(storage, "user-b", AI_PROVIDER_PROCESSING_CONSENT), false);
  assert.equal(readAiProcessingConsent(storage, "user-a", AI_PROVIDER_PROCESSING_CONSENT)?.acceptedAt, FIRST_ACCEPTANCE);

  const reaccepted = acceptAiProcessingConsent(storage as unknown as Storage, "user-a", AI_PROVIDER_PROCESSING_CONSENT, LATER);
  assert.equal(reaccepted.ok && reaccepted.consent.acceptedAt, FIRST_ACCEPTANCE, "aceptar de nuevo no fabrica una fecha nueva");
});

test("cada scope se revoca sin alterar los demás y una policy nueva exige aceptación", () => {
  const storage = new MemoryStorage();
  acceptAiProcessingConsent(storage as unknown as Storage, "user-scope", AI_PROVIDER_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  acceptAiProcessingConsent(storage as unknown as Storage, "user-scope", AI_IMAGE_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  const revoked = revokeAiProcessingConsent(storage as unknown as Storage, "user-scope", AI_PROVIDER_PROCESSING_CONSENT, LATER);
  assert.equal(revoked.ok && revoked.consent.revokedAt, LATER);
  assert.equal(hasActiveAiProcessingConsent(storage, "user-scope", AI_PROVIDER_PROCESSING_CONSENT), false);
  assert.equal(hasActiveAiProcessingConsent(storage, "user-scope", AI_IMAGE_PROCESSING_CONSENT), true);
  assert.equal(hasActiveAiProcessingConsent(storage, "user-scope", AI_IMAGE_PROCESSING_CONSENT, `${BACKYARD_AI_PROVIDER_CONSENT_VERSION}-new`), false);
});

test("Safari Private puede continuar en memoria y la revocación queda fail-closed", () => {
  const throwingStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const accepted = acceptAiProcessingConsent(throwingStorage as unknown as Storage, "safari-private", AI_IMAGE_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.persisted, false);
  assert.equal(hasActiveAiProcessingConsent(throwingStorage, "safari-private", AI_IMAGE_PROCESSING_CONSENT), true);

  const revoked = revokeAiProcessingConsent(throwingStorage as unknown as Storage, "safari-private", AI_IMAGE_PROCESSING_CONSENT, LATER);
  assert.equal(revoked.ok, true);
  assert.equal(revoked.persisted, false);
  assert.equal(hasActiveAiProcessingConsent(throwingStorage, "safari-private", AI_IMAGE_PROCESSING_CONSENT), false);
});

test("estado remoto revocado invalida aceptación local y nunca la elimina", () => {
  const storage = new MemoryStorage();
  acceptAiProcessingConsent(storage as unknown as Storage, "remote-revoked", AI_PROVIDER_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  const result = reconcileAuthoritativeAiProcessingConsent(storage, "remote-revoked", AI_PROVIDER_PROCESSING_CONSENT, {
    active: false,
    acceptedAt: FIRST_ACCEPTANCE,
    revokedAt: LATER,
  });
  assert.equal(result.active, false);
  assert.equal(result.consent?.revokedAt, LATER);
  assert.equal(hasActiveAiProcessingConsent(storage, "remote-revoked", AI_PROVIDER_PROCESSING_CONSENT), false);
});

test("ningún GET remoto activo resucita una revocación local sin otra aceptación explícita", () => {
  const storage = new MemoryStorage();
  acceptAiProcessingConsent(storage as unknown as Storage, "pending-revoke", AI_PROVIDER_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  revokeAiProcessingConsent(storage as unknown as Storage, "pending-revoke", AI_PROVIDER_PROCESSING_CONSENT, LATER);
  const result = reconcileAuthoritativeAiProcessingConsent(storage, "pending-revoke", AI_PROVIDER_PROCESSING_CONSENT, {
    active: true,
    acceptedAt: "2026-09-08T20:00:00.000Z",
    revokedAt: null,
  });
  assert.equal(result.active, false);
  assert.equal(result.pendingLocalRevocation, true);
  assert.equal(hasActiveAiProcessingConsent(storage, "pending-revoke", AI_PROVIDER_PROCESSING_CONSENT), false);
});

test("un GET anterior a una revocación se descarta antes de tocar el cache", async () => {
  const storage = new MemoryStorage();
  const userId = "race-revoke";
  acceptAiProcessingConsent(storage as unknown as Storage, userId, AI_PROVIDER_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  let release: ((response: Response) => void) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>((resolve) => { release = resolve; })) as typeof fetch;
  try {
    const pending = resolveAuthoritativeAiProcessingConsent({
      accessToken: "token",
      storage,
      userId,
      scope: AI_PROVIDER_PROCESSING_CONSENT,
    });
    revokeAiProcessingConsent(storage as unknown as Storage, userId, AI_PROVIDER_PROCESSING_CONSENT, LATER);
    beginAiProcessingConsentMutation(userId, AI_PROVIDER_PROCESSING_CONSENT);
    release?.(new Response(JSON.stringify({
      active: true,
      scope: AI_PROVIDER_PROCESSING_CONSENT,
      policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
      acceptedAt: FIRST_ACCEPTANCE,
      revokedAt: null,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await pending;
    assert.equal(result.discarded, true);
    assert.equal(hasActiveAiProcessingConsent(storage, userId, AI_PROVIDER_PROCESSING_CONSENT), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("borrar el workspace local elimina sólo el propietario", () => {
  const storage = new MemoryStorage();
  acceptAiProcessingConsent(storage as unknown as Storage, "delete-a", AI_PROVIDER_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  acceptAiProcessingConsent(storage as unknown as Storage, "delete-b", AI_IMAGE_PROCESSING_CONSENT, FIRST_ACCEPTANCE);
  assert.equal(deleteAiProcessingConsents(storage as unknown as Storage, "delete-a").ok, true);
  assert.equal(readAiProcessingConsent(storage, "delete-a", AI_PROVIDER_PROCESSING_CONSENT), null);
  assert.equal(hasActiveAiProcessingConsent(storage, "delete-b", AI_IMAGE_PROCESSING_CONSENT), true);
});

test("Perfil expone scopes separados y sólo el prompt hace aceptación remota explícita", () => {
  const settings = readFileSync("app/components/backyard-ai/ai-processing-consent.tsx", "utf8");
  const setup = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  const scanner = readFileSync("app/components/backyard-ai/scorecard-scanner.tsx", "utf8");
  const account = readFileSync("app/components/account-panel.tsx", "utf8");
  const manager = readFileSync("app/components/legal-consent-manager.tsx", "utf8");
  assert.match(account, /LegalConsentManager/);
  assert.match(manager, /AiProcessingConsentSettings/);
  assert.match(settings, /Privacidad \/ IA/);
  assert.match(settings, /Instrucciones de ronda/);
  assert.match(settings, /Fotografías de scorecard/);
  assert.match(settings, /No autoriza datos de apuestas, memoria personal ni uso para entrenamiento global/);
  assert.match(settings, /acceptRemoteAiProcessingConsent/);
  assert.match(settings, /revokeRemoteAiProcessingConsent/);
  assert.match(settings, /AbortController/);
  assert.match(settings, /generation !== generations\.current\[scope\]/);
  assert.doesNotMatch(setup, /acceptRemoteAiProcessingConsent/);
  assert.doesNotMatch(scanner, /acceptRemoteAiProcessingConsent/);
});

test("una cuenta autenticada sin token nunca degrada su consentimiento al modo invitado", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const account = readFileSync("app/components/account-panel.tsx", "utf8");
  const manager = readFileSync("app/components/legal-consent-manager.tsx", "utf8");
  const prompt = readFileSync("app/components/backyard-ai/ai-processing-consent.tsx", "utf8");
  const setup = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  const scanner = readFileSync("app/components/backyard-ai/scorecard-scanner.tsx", "utf8");
  const verifier = readFileSync("lib/backyard-ai/server/processing-consent.ts", "utf8");

  assert.match(page, /requiresRemoteConsent=\{identity\.mode === "authenticated"\}/);
  assert.match(account, /authenticated=\{identity\.mode === "authenticated"\}/);
  assert.match(manager, /requiresRemoteConsent=\{authenticated\}/);
  assert.match(prompt, /requiresRemoteConsent && !accessToken/);
  assert.match(setup, /remoteConsentUnavailable = requiresRemoteConsent && !accessToken/);
  assert.match(scanner, /else if \(requiresRemoteConsent\)[\s\S]*No se envió ninguna foto/);
  assert.match(scanner, /if \(requiresRemoteConsent && !accessToken\)[\s\S]*return;/);
  assert.match(verifier, /if \(!token\) return \{ ok: true, authenticated: false, userId: null \}/,
    "el modo invitado explícito conserva consentimiento local y acceso sin bearer");
});

test("aceptar consentimiento se aborta al desmontar y no dispara trabajo tardío", () => {
  const prompt = readFileSync("app/components/backyard-ai/ai-processing-consent.tsx", "utf8");
  const setup = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  const scanner = readFileSync("app/components/backyard-ai/scorecard-scanner.tsx", "utf8");

  assert.match(prompt, /acceptAbort\.current\?\.abort\(\)/);
  assert.match(prompt, /acceptGeneration\.current \+= 1/);
  assert.match(prompt, /acceptRemoteAiProcessingConsent\(accessToken, userId, scope, controller\.signal\)/);
  assert.match(prompt, /mounted\.current && !controller\.signal\.aborted && generation === acceptGeneration\.current/);
  assert.match(prompt, /if \(!isCurrent\(\)\) return;[\s\S]*acceptedCallback\.current/);
  assert.match(setup, /async function submit[\s\S]*if \(!mounted\.current\) return;/);
  assert.match(scanner, /async function scanWithConsent\(\)[\s\S]*if \(!mounted\.current/);
});

test("ledger dedicado conserva auditoría, RLS y niega DELETE ordinario", () => {
  assert.equal(AI_PROCESSING_CONSENT_TABLE, "ai_processing_consents");
  assert.equal(parseAiProcessingConsentScope(AI_PROVIDER_PROCESSING_CONSENT), AI_PROVIDER_PROCESSING_CONSENT);
  assert.equal(parseAiProcessingConsentScope(AI_IMAGE_PROCESSING_CONSENT), AI_IMAGE_PROCESSING_CONSENT);
  assert.equal(parseAiProcessingConsentScope("betting_financial"), null);

  const route = readFileSync("app/api/backyard-ai/consent/route.ts", "utf8");
  const verifier = readFileSync("lib/backyard-ai/server/processing-consent.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260908134650_ai_processing_consents.sql", "utf8");
  const rlsContract = readFileSync("supabase/tests/ai_processing_consents_rls.sql", "utf8");
  assert.match(route, /admin\.auth\.getUser\(token\)/);
  assert.match(route, /aiProcessingConsentLedgerAccess\(process\.env, true\)/);
  assert.match(route, /AI_PROCESSING_CONSENT_TABLE/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /update\(\{ revoked_at: revokedAt/);
  assert.doesNotMatch(route, /legal_acceptances/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.doesNotMatch(route, /\.delete\(/);
  assert.match(verifier, /AI_PROCESSING_CONSENT_TABLE/);
  assert.match(verifier, /if \(!token\) return \{ ok: true, authenticated: false, userId: null \};[\s\S]*aiProcessingConsentLedgerAccess\(process\.env, true\)/);
  assert.match(verifier, /data\.revoked_at !== null/);
  assert.match(migration, /create table if not exists public\.ai_processing_consents/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /where revoked_at is null/);
  assert.match(migration, /for select[\s\S]*to authenticated[\s\S]*auth\.uid\(\)/);
  assert.match(migration, /revoke all on table public\.ai_processing_consents from anon, authenticated/);
  assert.doesNotMatch(migration, /grant delete/i);
  assert.match(rlsContract, /has_table_privilege\('authenticated',[\s\S]*'DELETE'\)/);
  assert.match(rlsContract, /policy_text not like '%auth\.uid\(\)%'/);
});
