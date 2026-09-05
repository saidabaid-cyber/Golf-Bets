import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ACCOUNT_STORAGE_KEYS,
  BETTING_DATA_CONSENT_TYPE,
  BETTING_DATA_CONSENT_VERSION,
  bettingConsentPromptStorageKey,
  buildLegalAcceptances,
  hasCurrentBettingDataConsent,
  markLegalAcceptancesSynced,
  parseLegalAcceptances,
} from "../lib/account-state";
import { persistBettingDataConsent } from "../lib/betting-consent";
import { PRIVACY_CONTENT_ID, PRIVACY_SECTIONS, privacyPublishedPlainText } from "../lib/privacy-content";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("el aviso publicado coincide íntegramente con el contenido aprobado", () => {
  const text = privacyPublishedPlainText();
  assert.equal(createHash("sha256").update(text).digest("hex"), "af74adf0fb7bb96e73cfdcb56317080c44e1c9112de5fd995e5b43662da2743b");
  assert.equal(PRIVACY_CONTENT_ID, "2026-09-02-v2+sha256-af74adf0fb7bb96e");
  assert.deepEqual(PRIVACY_SECTIONS.map((section) => section.number), Array.from({ length: 16 }, (_, index) => index + 1));
  for (const removed of [
    "Su contenido no sustituye asesoría jurídica individual.",
    "Sus condiciones, ubicaciones de procesamiento y plazos pueden depender de la configuración y términos aplicables; no afirmamos condiciones contractuales o de retención que no hayan sido confirmadas.",
    "Informaremos el trámite, plazos y medios de respuesta conforme a la normativa aplicable.",
  ]) assert.equal(text.includes(removed), false);
  assert.equal(text.includes("NOTA DE REVISIÓN"), false);
});

test("una aceptación antigua o genérica no equivale al consentimiento expreso", () => {
  const generic = buildLegalAcceptances("guest", "2026-09-05T06:00:00.000Z");
  const collision = { ...generic[0], type: "privacy" as const, documentVersion: "2026-09-02-v2" };
  assert.equal(hasCurrentBettingDataConsent([...generic, collision], "guest"), false);
  assert.notEqual(BETTING_DATA_CONSENT_VERSION, collision.documentVersion);
});

test("haber visto la actualización de acceso no fabrica consentimiento", () => {
  const storage = new MemoryStorage();
  storage.setItem(bettingConsentPromptStorageKey("account-a"), "seen");
  assert.equal(hasCurrentBettingDataConsent(parseLegalAcceptances(storage.getItem(ACCOUNT_STORAGE_KEYS.acceptances)), "account-a"), false);
  assert.match(bettingConsentPromptStorageKey("account-a"), new RegExp(BETTING_DATA_CONSENT_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("consentimiento invitado se persiste, se verifica al recargar y no se atribuye a otra cuenta", () => {
  const storage = new MemoryStorage();
  const acceptedAt = "2026-09-05T06:10:00.000Z";
  const result = persistBettingDataConsent(storage as unknown as Storage, "guest", "local_only", acceptedAt);
  assert.equal(result.acceptance.type, BETTING_DATA_CONSENT_TYPE);
  assert.equal(result.acceptance.persistenceStatus, "persisted");
  assert.equal(result.acceptance.syncStatus, "local_only");
  const reloaded = parseLegalAcceptances(storage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
  assert.equal(hasCurrentBettingDataConsent(reloaded, "guest"), true);
  assert.equal(hasCurrentBettingDataConsent(reloaded, "account-a"), false);
});

test("aceptación offline de cuenta queda local y pendiente hasta confirmación remota", () => {
  const storage = new MemoryStorage();
  const result = persistBettingDataConsent(storage as unknown as Storage, "account-a", "pending", "2026-09-05T06:20:00.000Z");
  assert.equal(result.acceptance.syncStatus, "pending");
  const synced = markLegalAcceptancesSynced(result.acceptances, [result.acceptance]);
  assert.equal(synced.find((item) => item.type === BETTING_DATA_CONSENT_TYPE)?.syncStatus, "synced");
});

test("si no se puede persistir no se fabrica aceptación", () => {
  const storage = new MemoryStorage();
  const failing = {
    getItem: storage.getItem.bind(storage),
    setItem() { throw new Error("Cuota agotada"); },
  };
  assert.throws(() => persistBettingDataConsent(failing as unknown as Storage, "guest", "local_only"), /Cuota agotada/);
  assert.equal(storage.getItem(ACCOUNT_STORAGE_KEYS.acceptances), null);
});
