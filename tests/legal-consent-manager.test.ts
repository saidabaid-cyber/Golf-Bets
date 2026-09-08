import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MARKETING_CONSENT_VERSION, readMarketingConsent, writeMarketingConsent } from "../lib/marketing-consent";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("marketing queda apagado hasta una elección afirmativa y es revocable", () => {
  const storage = new MemoryStorage();
  assert.equal(readMarketingConsent(storage as unknown as Storage, "said"), null);
  const accepted = writeMarketingConsent(storage as unknown as Storage, "said", true, "2026-09-08T12:00:00.000Z");
  assert.equal(accepted.policyVersion, MARKETING_CONSENT_VERSION);
  assert.equal(accepted.acceptedAt, "2026-09-08T12:00:00.000Z");
  assert.equal(accepted.revokedAt, null);
  const revoked = writeMarketingConsent(storage as unknown as Storage, "said", false, "2026-09-08T13:00:00.000Z");
  assert.equal(revoked.acceptedAt, accepted.acceptedAt);
  assert.equal(revoked.revokedAt, "2026-09-08T13:00:00.000Z");
});

test("Legal y privacidad usa una pantalla secundaria y mantiene finalidades separadas", () => {
  const account = readFileSync("app/components/account-panel.tsx", "utf8");
  const manager = readFileSync("app/components/legal-consent-manager.tsx", "utf8");
  assert.match(account, /GESTIONAR CONSENTIMIENTOS/);
  assert.doesNotMatch(account, /Revocar Términos/);
  for (const label of ["Términos y Condiciones", "Aviso Integral", "Declaración de mayoría de edad", "Datos financieros\/patrimoniales", "AiProcessingConsentSettings", "Memoria y aprendizaje", "Marketing opcional"]) assert.match(manager, new RegExp(label, "i"));
  assert.match(manager, /globalLearningEnabled/);
  assert.match(manager, /personalMemoryEnabled/);
});
