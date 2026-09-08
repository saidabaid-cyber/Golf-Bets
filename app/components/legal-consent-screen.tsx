"use client";

import Link from "next/link";
import { useState } from "react";
import { LEGAL_EVIDENCE_DEFINITIONS, PRIVACY_LEGAL_VERSION, TERMS_LEGAL_VERSION } from "../../lib/legal-documents";
import { BrandLockup } from "./brand-lockup";

export type LegalCeremonyChoices = {
  financial: "accepted" | "rejected";
  marketing: "accepted" | "rejected";
};

const ceremonyStatements = {
  privacyPresented: LEGAL_EVIDENCE_DEFINITIONS.privacy_notice.statements.presented,
  termsAccepted: LEGAL_EVIDENCE_DEFINITIONS.terms.statements.accepted,
  termsRejected: LEGAL_EVIDENCE_DEFINITIONS.terms.statements.rejected,
  ageAccepted: LEGAL_EVIDENCE_DEFINITIONS.age_declaration.statements.accepted,
  financialAccepted: LEGAL_EVIDENCE_DEFINITIONS.financial_data.statements.accepted,
  financialRejected: LEGAL_EVIDENCE_DEFINITIONS.financial_data.statements.rejected,
  marketingAccepted: LEGAL_EVIDENCE_DEFINITIONS.marketing.statements.accepted,
  marketingRejected: LEGAL_EVIDENCE_DEFINITIONS.marketing.statements.rejected,
} as const;

export function LegalConsentScreen({ mode, onSubmit, onRejectTerms }: {
  mode: "first_access" | "update";
  onSubmit: (choices: LegalCeremonyChoices) => Promise<void>;
  onRejectTerms: () => Promise<void>;
}) {
  const [terms, setTerms] = useState(false);
  const [privacyPresented, setPrivacyPresented] = useState(false);
  const [age, setAge] = useState(false);
  const [financial, setFinancial] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returnTo = mode === "update" ? "app" : "onboarding";
  const ready = terms && privacyPresented && age;

  async function submit() {
    if (!ready) return;
    setBusy(true); setError("");
    try {
      await onSubmit({
        financial: financial ? "accepted" : "rejected",
        marketing: marketing ? "accepted" : "rejected",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar tus elecciones. Nada se marcó como confirmado; reintenta.");
    } finally { setBusy(false); }
  }

  async function rejectTerms() {
    setBusy(true); setError("");
    try { await onRejectTerms(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar tu elección. Reintenta."); }
    finally { setBusy(false); }
  }

  return <main className={`consentScreen ${mode === "update" ? "legalUpdateScreen" : ""}`}>
    <section className="consentCard legalConsentCard" role={mode === "update" ? "dialog" : undefined} aria-modal={mode === "update" ? "true" : undefined} aria-labelledby="legal-consent-title">
      <BrandLockup compact />
      <div className="eyebrow">{mode === "update" ? "ACTUALIZACIÓN LEGAL" : "PRIMER ACCESO"}</div>
      <h1 id="legal-consent-title">Tus documentos y elecciones</h1>
      <p>Revisa cada decisión por separado. El marketing y el tratamiento económico son opcionales y no condicionan las funciones deportivas independientes.</p>

      <div className="legalDocumentSummary" aria-label="Documentos vigentes">
        <Link href={`/legal/privacy-simplified?returnTo=${returnTo}`}>Aviso Simplificado · {PRIVACY_LEGAL_VERSION}</Link>
        <Link href={`/legal/privacy?returnTo=${returnTo}`}>Aviso Integral · {PRIVACY_LEGAL_VERSION}</Link>
        <Link href={`/legal/terms?returnTo=${returnTo}`}>Términos y Condiciones · {TERMS_LEGAL_VERSION}</Link>
      </div>

      <label className="consentCheck"><input type="checkbox" checked={privacyPresented} onChange={(event) => setPrivacyPresented(event.target.checked)} /><span>{ceremonyStatements.privacyPresented} Consulta el <Link href={`/legal/privacy-simplified?returnTo=${returnTo}`}>Aviso Simplificado</Link> y el <Link href={`/legal/privacy?returnTo=${returnTo}`}>Aviso Integral</Link>. Este acuse no es un consentimiento general.</span></label>
      <label className="consentCheck"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} /><span>{ceremonyStatements.termsAccepted} <Link href={`/legal/terms?returnTo=${returnTo}`}>Leer los Términos.</Link></span></label>
      <label className="consentCheck"><input type="checkbox" checked={age} onChange={(event) => setAge(event.target.checked)} /><span>{ceremonyStatements.ageAccepted}</span></label>
      <label className="consentCheck expressConsentCheck"><input type="checkbox" checked={financial} onChange={(event) => setFinancial(event.target.checked)} /><span>{ceremonyStatements.financialAccepted} Si no marcas esta casilla, se registrará: “{ceremonyStatements.financialRejected}” y sólo esas funciones permanecerán desactivadas.</span></label>
      <label className="consentCheck optionalConsentCheck"><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /><span>{ceremonyStatements.marketingAccepted} Si no marcas esta casilla, se registrará: “{ceremonyStatements.marketingRejected}” No hay campañas ni rastreo activos en esta versión.</span></label>

      <p className="officialPriority">Cada persona decide por su propia cuenta. El organizador de una ronda no acepta ni consiente por los demás jugadores.</p>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <button className="primary big" disabled={!ready || busy} onClick={submit}>{busy ? "Guardando…" : financial ? "Guardar elecciones y continuar" : "Continuar sin funciones económicas"}</button>
      <button className="textButton consentBack" disabled={busy} onClick={rejectTerms}>{ceremonyStatements.termsRejected}</button>
    </section>
  </main>;
}
