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
  for (const label of ["Términos y Condiciones", "Aviso Integral", "Declaración de mayoría de edad", "Apuestas, resultados y gastos", "AiProcessingConsentSettings", "Memoria y aprendizaje", "Marketing opcional"]) assert.match(manager, new RegExp(label, "i"));
  assert.ok(manager.indexOf("Documentos y edad") < manager.indexOf("<AiProcessingConsentSettings"));
  assert.ok(manager.indexOf("<AiProcessingConsentSettings") < manager.indexOf("Memoria y aprendizaje"));
  assert.ok(manager.indexOf("<h2>Memoria y aprendizaje") < manager.indexOf("<h2>Apuestas, resultados y gastos"));
  assert.ok(manager.indexOf("<h2>Apuestas, resultados y gastos") < manager.indexOf("<h2>Marketing opcional"));
  assert.doesNotMatch(manager, /Copia de datos|Descargar copia limitada/);
  assert.match(manager, /globalLearningEnabled/);
  assert.match(manager, /personalMemoryEnabled/);
});

test("Legal y privacidad uses the same exit at the top and after its long content", () => {
  const manager = readFileSync("app/components/legal-consent-manager.tsx", "utf8");
  assert.match(manager, /<button type="button" className="secondary pageBack" onClick=\{onBack\}>\u2190 Legal y privacidad<\/button>/);
  assert.match(manager, /<BottomBackAction label="\u2190 Legal y privacidad" onBack=\{onBack\} \/>/);
});
