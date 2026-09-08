import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LEGAL_DOCUMENTS,
  LEGAL_EVIDENCE_DEFINITIONS,
  LEGAL_SOURCE_HASHES,
  PRIVACY_INTEGRAL_TEXT,
  PRIVACY_LEGAL_VERSION,
  PRIVACY_SIMPLIFIED_TEXT,
  TERMS_LEGAL_VERSION,
  TERMS_TEXT,
} from "../lib/legal-documents";
import {
  buildLegalEvidenceEvent,
  getOrCreateGuestLegalActor,
  hasCurrentCoreLegalChoices,
  hasCurrentFinancialConsent,
  hasCurrentMarketingConsent,
  latestLegalEvidence,
  legalEvidenceRequestBody,
  mergeServerLegalEvidence,
  persistLegalEvidence,
  readLegalEvidence,
  recordLocalLegalEvidence,
  type LegalEvidenceServerRow,
} from "../lib/legal-choice-state";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
];

test("los textos publicados corresponden sólo al paquete V6/V2 del 8 de septiembre", () => {
  assert.equal(PRIVACY_LEGAL_VERSION, "2026-09-08-v6");
  assert.equal(TERMS_LEGAL_VERSION, "2026-09-08-v2");
  assert.notEqual(TERMS_LEGAL_VERSION, "2026-09-02-v2");
  assert.equal(hash(PRIVACY_INTEGRAL_TEXT), LEGAL_SOURCE_HASHES.privacyPublished);
  assert.equal(hash(TERMS_TEXT), LEGAL_SOURCE_HASHES.termsPublished);
  assert.equal(hash(PRIVACY_SIMPLIFIED_TEXT), LEGAL_SOURCE_HASHES.privacySimplified);
  assert.equal(LEGAL_SOURCE_HASHES.privacyTxt, "4c8e197b62d945278573f6b476847452772839ef5245ecf51b9a3017079814c4");
  assert.equal(LEGAL_SOURCE_HASHES.termsTxt, "ddd3140b246d84beeb3ef312d4ce89d4a3e248f7d4eb473e4c61eed008d6aa9d");
  assert.equal((PRIVACY_INTEGRAL_TEXT.match(/^\d+\.\s/gm) || []).length, 20);
  assert.equal((TERMS_TEXT.match(/^\d+\.\s/gm) || []).length, 23);
  assert.equal(PRIVACY_INTEGRAL_TEXT.endsWith(PRIVACY_SIMPLIFIED_TEXT), true);
  assert.match(PRIVACY_INTEGRAL_TEXT, /Responsable actual: Said Abaid Taja/);
  assert.match(TERMS_TEXT, /Prestador actual: Said Abaid Taja/);
  assert.equal(PRIVACY_INTEGRAL_TEXT.includes("NOTA INTERNA"), false);
  assert.equal(TERMS_TEXT.includes("aprobado por el abogado"), false);
});

test("las tres rutas usan contenido centralizado, versión visible y hashes separados", () => {
  assert.equal(LEGAL_DOCUMENTS.privacy_integral.path, "/legal/privacy");
  assert.equal(LEGAL_DOCUMENTS.privacy_simplified.path, "/legal/privacy-simplified");
  assert.equal(LEGAL_DOCUMENTS.terms.path, "/legal/terms");
  assert.equal(LEGAL_DOCUMENTS.privacy_integral.version, "2026-09-08-v6");
  assert.equal(LEGAL_DOCUMENTS.terms.version, "2026-09-08-v2");
  assert.notEqual(LEGAL_DOCUMENTS.privacy_integral.contentHash, LEGAL_DOCUMENTS.privacy_simplified.contentHash);
  for (const path of ["app/legal/privacy/page.tsx", "app/legal/privacy-simplified/page.tsx", "app/legal/terms/page.tsx"]) {
    assert.match(readFileSync(path, "utf8"), /LegalDocument/);
  }
  assert.match(readFileSync("app/components/legal-document.tsx", "utf8"), /Versión vigente: \{document\.version\}/);
});

test("cada manifestación conserva el hash exacto de la frase presentada", () => {
  const definitions = Object.values(LEGAL_EVIDENCE_DEFINITIONS) as Array<{
    statements: Record<string, string>;
    statementHashes: Record<string, string>;
  }>;
  for (const definition of definitions) {
    for (const [action, statement] of Object.entries(definition.statements)) {
      assert.equal(hash(statement), definition.statementHashes[action]);
    }
  }
  const ceremony = readFileSync("app/components/legal-consent-screen.tsx", "utf8");
  assert.match(ceremony, /LEGAL_EVIDENCE_DEFINITIONS/);
  assert.match(ceremony, /ceremonyStatements\.financialRejected/);
  assert.match(ceremony, /ceremonyStatements\.marketingRejected/);
});

test("invitado recibe actor aleatorio estable y nunca se presenta como cuenta", () => {
  const storage = new MemoryStorage();
  const actor = getOrCreateGuestLegalActor(storage as unknown as Storage, () => ids[0]);
  assert.equal(actor, `guest-local:${ids[0]}`);
  assert.equal(getOrCreateGuestLegalActor(storage as unknown as Storage, () => ids[1]), actor);
  assert.notEqual(actor, "guest");
  assert.equal(actor.startsWith("account:"), false);
});

test("una versión nueva no borra evidencia histórica ni la convierte en vigente", () => {
  const storage = new MemoryStorage();
  const current = buildLegalEvidenceEvent({ actorKey: "account:user-a", actorContext: "authenticated", environment: "test", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "synced", clientOccurredAt: "2026-09-02T12:00:00.000Z", idempotencyKey: ids[0] });
  const historicalStatement = "Acepté la versión histórica de los Términos.";
  const historical = {
    ...current,
    documentVersion: "2026-09-02-v2",
    documentHash: "a".repeat(64),
    statementKey: "terms.accepted.2026-09-02-v2",
    statementText: historicalStatement,
    statementHash: hash(historicalStatement),
  };
  persistLegalEvidence(storage as unknown as Storage, historical);
  const restored = readLegalEvidence(storage as unknown as Storage, "account:user-a", "test");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].documentVersion, "2026-09-02-v2");
  assert.equal(hasCurrentCoreLegalChoices(restored), false);
});

test("aviso, términos, edad, tratamiento económico y marketing son elecciones separadas", () => {
  assert.deepEqual(Object.keys(LEGAL_EVIDENCE_DEFINITIONS), ["privacy_notice", "terms", "age_declaration", "financial_data", "marketing"]);
  const storage = new MemoryStorage();
  let cursor = 0;
  const randomId = () => ids[cursor++];
  const identity = { mode: "guest" as const, userId: "guest" };
  for (const [subject, action] of [
    ["privacy_notice", "presented"],
    ["terms", "accepted"],
    ["age_declaration", "accepted"],
    ["financial_data", "rejected"],
    ["marketing", "rejected"],
  ] as const) {
    recordLocalLegalEvidence(storage as unknown as Storage, identity, { environment: "test", subject, action, origin: "onboarding", randomId });
  }
  const events = readLegalEvidence(storage, `guest-local:${ids[0]}`, "test");
  assert.equal(events.length, 5);
  assert.equal(hasCurrentCoreLegalChoices(events), true);
  assert.equal(hasCurrentFinancialConsent(events), false);
  assert.equal(hasCurrentMarketingConsent(events), false);
  assert.equal(latestLegalEvidence(events, "privacy_notice")?.action, "presented");
});

test("aceptar y revocar conserva ambos eventos y el último evento gobierna", () => {
  const base = {
    actorKey: "account:user-a",
    actorContext: "authenticated" as const,
    environment: "test" as const,
    subject: "financial_data" as const,
    origin: "account_privacy",
    syncStatus: "pending" as const,
  };
  const accepted = buildLegalEvidenceEvent({ ...base, action: "accepted", clientOccurredAt: "2026-09-08T12:00:00.000Z", idempotencyKey: ids[0] });
  const revoked = buildLegalEvidenceEvent({ ...base, action: "revoked", clientOccurredAt: "2026-09-08T12:01:00.000Z", idempotencyKey: ids[1] });
  const storage = new MemoryStorage();
  persistLegalEvidence(storage, accepted);
  persistLegalEvidence(storage, revoked);
  const events = readLegalEvidence(storage, base.actorKey, "test");
  assert.equal(events.length, 2);
  assert.equal(hasCurrentFinancialConsent(events), false);
  assert.equal(latestLegalEvidence(events, "financial_data")?.action, "revoked");
});

test("idempotencia reintenta el mismo evento pero nunca sobrescribe evidencia", () => {
  const storage = new MemoryStorage();
  const event = buildLegalEvidenceEvent({ actorKey: "account:user-a", actorContext: "authenticated", environment: "test", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", clientOccurredAt: "2026-09-08T12:00:00.000Z", idempotencyKey: ids[0] });
  persistLegalEvidence(storage, event);
  assert.equal(persistLegalEvidence(storage, event).idempotencyKey, ids[0]);
  assert.equal(readLegalEvidence(storage, event.actorKey, "test").length, 1);
  assert.throws(() => persistLegalEvidence(storage, { ...event, origin: "existing_user_update" }), /idempotency_conflict/);
  assert.deepEqual(legalEvidenceRequestBody(event), { subject: "terms", action: "accepted", origin: "onboarding", clientOccurredAt: event.clientOccurredAt, idempotencyKey: ids[0] });
});

test("si falla almacenamiento local no se fabrica evidencia", () => {
  const storage = new MemoryStorage();
  const failing = { getItem: storage.getItem.bind(storage), setItem() { throw new Error("Cuota agotada"); } };
  assert.throws(() => recordLocalLegalEvidence(failing as unknown as Storage, { mode: "guest", userId: "guest" }, { environment: "test", subject: "terms", action: "accepted", origin: "onboarding", randomId: () => ids[0] }), /Cuota agotada/);
  assert.equal(storage.values.size, 0);
});

test("sincronización conserva hora cliente y añade recepción de servidor", () => {
  const local = buildLegalEvidenceEvent({ actorKey: "account:user-a", actorContext: "authenticated", environment: "test", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", clientOccurredAt: "2026-09-08T12:00:00.000Z", idempotencyKey: ids[0] });
  const row: LegalEvidenceServerRow = {
    environment: "test", document_key: local.documentKey, purpose_key: local.subject, document_version: local.documentVersion,
    document_hash: local.documentHash, statement_key: local.statementKey, statement_text: local.statementText, statement_hash: local.statementHash,
    action: local.action, locale: "es-MX", origin: local.origin, client_occurred_at: local.clientOccurredAt,
    server_received_at: "2026-09-08T12:05:00.000Z", idempotency_key: local.idempotencyKey,
  };
  const merged = mergeServerLegalEvidence([local], [row], "user-a", "test");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].clientOccurredAt, "2026-09-08T12:00:00.000Z");
  assert.equal(merged[0].serverReceivedAt, "2026-09-08T12:05:00.000Z");
  assert.equal(merged[0].syncStatus, "synced");
});

test("migración es aditiva, RLS de lectura propia y ledger sin mutación del cliente", () => {
  const migration = readFileSync("supabase/migrations/20260908173547_legal_evidence_events_append_only.sql", "utf8");
  assert.match(migration, /create table if not exists public\.legal_evidence_events/);
  assert.match(migration, /server_received_at timestamptz not null default now\(\)/);
  assert.match(migration, /unique \(user_id, environment, idempotency_key\)/);
  assert.match(migration, /grant select on table public\.legal_evidence_events to authenticated/);
  assert.match(migration, /grant select, insert on table public\.legal_evidence_events to service_role/);
  assert.doesNotMatch(migration, /grant[^;]*(insert|update|delete|truncate)[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
});

test("API deriva identidad, versión, hash y manifestación en servidor", () => {
  const route = readFileSync("app/api/legal/evidence/route.ts", "utf8");
  assert.match(route, /auth\.getUser\(token\)/);
  assert.match(route, /legalEvidenceDefinition\(input\.subject, input\.action\)/);
  assert.match(route, /user_id: auth\.user\.id/);
  assert.match(route, /server_received_at,idempotency_key/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /input\.userId|input\.documentHash|input\.statementText/);
});

test("UI no acepta implícitamente y conserva la app durante la actualización", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const ceremony = readFileSync("app/components/legal-consent-screen.tsx", "utf8");
  const account = readFileSync("app/components/account-panel.tsx", "utf8");
  const documents = readFileSync("lib/legal-documents.ts", "utf8");
  assert.doesNotMatch(provider, /Al continuar aceptas/);
  for (const label of ["Aviso de Privacidad Simplificado", "Términos y Condiciones", "18 años", "datos financieros o patrimoniales", "marketing"]) assert.match(`${provider}\n${ceremony}\n${documents}`, new RegExp(label, "i"));
  assert.match(LEGAL_EVIDENCE_DEFINITIONS.age_declaration.statements.accepted, /no constituye verificación documental/);
  assert.match(ceremony, /no acepta ni consiente por los demás jugadores/);
  assert.match(provider, /<Fragment key=\{identity\.userId\}>\{children\}<\/Fragment>/);
  assert.match(provider, /legalUpdateDeferred/);
  assert.match(account, /Legal y privacidad/);
  assert.match(account, /Confirmar revocación económica/);
  assert.match(account, /Confirmar revocación de marketing/);
});
