"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type LegalAcceptance } from "../../lib/account-state";
import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { MARKETING_CONSENT_VERSION, readMarketingConsent, writeMarketingConsent } from "../../lib/marketing-consent";
import { BACKYARD_AI_MEMORY_POLICY_VERSION, defaultLearningConsent, readLearningConsent } from "../../lib/backyard-ai/memory/learning-events";
import type { LearningConsent } from "../../lib/backyard-ai/memory/types";
import { cacheAccountLearningConsent, readAccountLearningConsent } from "../../lib/account-learning-consent-cache";
import {
  OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT,
  requestOptionalAuthorizationState,
  saveOptionalAuthorizationScope,
} from "../../lib/account-optional-authorizations";
import { LEGAL_EVIDENCE_DEFINITIONS, type LegalEvidenceAction, type LegalEvidenceSubject } from "../../lib/legal-evidence";
import { hasResolvedMarketingConsent, latestLegalEvidence, type LegalEvidenceEvent } from "../../lib/legal-evidence-client";
import { AiProcessingConsentSettings } from "./backyard-ai/ai-processing-consent";
import { BottomBackAction } from "./bottom-back-action";

export function LegalConsentManager({ userId, accessToken, authenticated, acceptances, legalEvidenceEvents, marketingConsentResolved, bettingConsentGranted, requestBettingConsent, recordLegalChoice, onBack }: {
  userId: string;
  accessToken: string | null;
  authenticated: boolean;
  acceptances: LegalAcceptance[];
  legalEvidenceEvents: LegalEvidenceEvent[];
  marketingConsentResolved: boolean;
  bettingConsentGranted: boolean;
  requestBettingConsent: () => Promise<boolean>;
  recordLegalChoice: (subject: LegalEvidenceSubject, action: LegalEvidenceAction) => Promise<void>;
  onBack: () => void;
}) {
  const [learning, setLearning] = useState<LearningConsent>(() => defaultLearningConsent(userId, BACKYARD_AI_MEMORY_POLICY_VERSION));
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningLoading, setLearningLoading] = useState(true);
  const learningRequest = useRef<AbortController | null>(null);
  const learningRevision = useRef(0);
  const [marketing, setMarketing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const learningResult = authenticated
      ? { consent: readAccountLearningConsent(localStorage, userId) }
      : readLearningConsent(localStorage, userId, BACKYARD_AI_MEMORY_POLICY_VERSION);
    const marketingRecord = readMarketingConsent(localStorage, userId);
    setLearning(learningResult.consent);
    setMarketing(hasResolvedMarketingConsent(legalEvidenceEvents, Boolean(marketingRecord?.acceptedAt && !marketingRecord.revokedAt), marketingConsentResolved));
    if (!authenticated || !accessToken) {
      setLearningLoading(false);
      return;
    }
    const revision = ++learningRevision.current;
    setLearningLoading(true);
    learningRequest.current?.abort();
    const controller = new AbortController();
    learningRequest.current = controller;
    void requestOptionalAuthorizationState(accessToken, controller.signal).then((saved) => {
      if (controller.signal.aborted || revision !== learningRevision.current) return;
      setLearning(cacheAccountLearningConsent(localStorage, userId, saved, learningResult.consent));
      setMessage("");
    }).catch(() => {
      if (!controller.signal.aborted && revision === learningRevision.current) setMessage("No pudimos consultar memoria y aprendizaje. Sólo conservamos activa una decisión confirmada por el servidor durante esta sesión.");
    }).finally(() => {
      if (!controller.signal.aborted && revision === learningRevision.current) setLearningLoading(false);
    });
    return () => controller.abort();
  }, [accessToken, authenticated, userId, legalEvidenceEvents, marketingConsentResolved]);

  async function changeLearning(scope: "PERSONAL_MEMORY" | "GLOBAL_LEARNING", enabled: boolean) {
    if (learningBusy || learningLoading || !authenticated || !accessToken) {
      setMessage("Inicia sesión para guardar esta elección en el registro de tu cuenta.");
      return;
    }
    learningRequest.current?.abort();
    learningRevision.current += 1;
    setLearningBusy(true); setMessage("");
    try {
      const saved = await saveOptionalAuthorizationScope(accessToken, scope, enabled, crypto.randomUUID());
      setLearning((current) => cacheAccountLearningConsent(localStorage, userId, saved, current));
      window.dispatchEvent(new Event(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT));
      setMessage(enabled ? "Autorización activada y registrada." : "Revocación registrada. Las demás autorizaciones no cambiaron.");
    } catch {
      setMessage("No pudimos confirmar esta elección. Conservamos el estado anterior.");
    } finally { setLearningBusy(false); }
  }

  async function changeMarketing(accepted: boolean) {
    setMessage("");
    if (!accepted) {
      try {
        writeMarketingConsent(localStorage, userId, false);
        setMarketing(false);
        await recordLegalChoice("marketing", "revoked");
        setMessage("Marketing opcional desactivado. La revocación quedó guardada.");
      } catch { setMessage("Marketing permanece desactivado, pero no pudimos guardar toda la evidencia de revocación. Reintenta."); setMarketing(false); }
      return;
    }
    try {
      await recordLegalChoice("marketing", "accepted");
      writeMarketingConsent(localStorage, userId, true);
      setMarketing(true);
      setMessage("Marketing opcional activado. La elección quedó guardada.");
    } catch {
      try { writeMarketingConsent(localStorage, userId, false); } catch { /* Fail closed in memory even if storage is unavailable. */ }
      setMarketing(false);
      setMessage("No pude guardar esta elección. Marketing permanece desactivado.");
    }
  }

  async function revokeFinancialConsent() {
    setMessage("");
    try {
      await recordLegalChoice("financial_data", "revoked");
      setMessage("Autorización financiera revocada para nuevas operaciones. La evidencia previa se conserva.");
    } catch { setMessage("No pudimos guardar la revocación. Las funciones económicas permanecen sin cambios; reintenta."); }
  }

  const accepted = (type: LegalAcceptance["type"]) => acceptances.some((item) => item.userId === userId && item.type === type);
  const evidenceLabel = (subject: LegalEvidenceSubject) => {
    const event = latestLegalEvidence(legalEvidenceEvents, subject);
    if (!event) return "Evidencia pendiente";
    const action = event.action === "presented" ? "Presentado" : event.action === "accepted" ? "Aceptado" : event.action === "rejected" ? "Rechazado" : "Revocado";
    const receipt = event.syncStatus === "synced" ? "Servidor" : event.syncStatus === "local_only" ? "Este dispositivo" : "Recepción pendiente";
    return `${action} · ${receipt}`;
  };
  return <>
    <button type="button" className="secondary pageBack" onClick={onBack}>← Legal y privacidad</button>
    <section className="hero"><div><div className="eyebrow">PRIVACIDAD</div><h1>Gestionar consentimientos</h1><p>Cada finalidad se controla por separado. Nada está premarcado.</p></div></section>
    <section className="card"><h2>Documentos y edad</h2><div className="documentConsentList">
      <Link href="/legal/terms?returnTo=account"><span>Términos y Condiciones</span><b>{accepted("terms") ? evidenceLabel("terms") : "Pendientes"} · {LEGAL_DOCUMENT_VERSIONS.terms}</b></Link>
      <Link href="/legal/privacy-simplified?returnTo=account"><span>Aviso Simplificado</span><b>{LEGAL_DOCUMENT_VERSIONS.privacy.split("+")[0]}</b></Link>
      <Link href="/legal/privacy?returnTo=account"><span>Aviso Integral</span><b>{accepted("privacy") ? evidenceLabel("privacy_notice") : "Pendiente"} · {LEGAL_DOCUMENT_VERSIONS.privacy.split("+")[0]}</b></Link>
      <div><span>Declaración de mayoría de edad</span><b>{accepted("age_confirmation") ? evidenceLabel("age_declaration") : "Pendiente"}</b></div>
    </div><p className="hint">Los Términos no se muestran como un switch cotidiano. Para dejar de usar el servicio puedes cerrar sesión o solicitar eliminación; tus derechos ARCO permanecen disponibles.</p></section>

    <AiProcessingConsentSettings userId={userId} accessToken={accessToken} requiresRemoteConsent={authenticated} />

    <section className="card"><h2>Memoria y aprendizaje</h2>
      <label className="preferenceRow"><span><b>Memoria personal</b><small className="preferenceDescription">Recuerda tus preferencias privadas para futuras rondas.</small></span><input type="checkbox" disabled={learningBusy || learningLoading || !authenticated || !accessToken} checked={learning.personalMemoryEnabled} onChange={(event) => void changeLearning("PERSONAL_MEMORY", event.target.checked)} /></label>
      <label className="preferenceRow"><span><b>Learning global futuro</b><small className="preferenceDescription">Sólo habilita datos desidentificados y revisados; puedes revocarlo por separado.</small></span><input type="checkbox" disabled={learningBusy || learningLoading || !authenticated || !accessToken} checked={learning.globalLearningEnabled} onChange={(event) => void changeLearning("GLOBAL_LEARNING", event.target.checked)} /></label>
      <p className="hint">Versión {BACKYARD_AI_MEMORY_POLICY_VERSION}. Inputs privados permanecen excluidos por defecto.</p>
    </section>

    <section className="card"><h2>Datos financieros/patrimoniales</h2><p>Apuestas, saldos, gastos y resultados económicos. Rechazarlo no bloquea score, campo ni funciones deportivas independientes.</p><div className="row between"><span>{bettingConsentGranted ? `Vigente · ${evidenceLabel("financial_data")}` : evidenceLabel("financial_data")}</span>{bettingConsentGranted ? <button type="button" className="secondary" onClick={() => void revokeFinancialConsent()}>Revocar autorización</button> : <button type="button" className="secondary" onClick={() => void requestBettingConsent()}>Revisar y decidir</button>}</div><p className="hint">{LEGAL_EVIDENCE_DEFINITIONS.financial_data.statements.revoked} Para ejercer derechos ARCO también puedes escribir a <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>.</p></section>

    <section className="card"><h2>Marketing opcional</h2><label className="preferenceRow"><span><b>Recibir comunicaciones de marketing</b><small className="preferenceDescription">Opcional, apagado por defecto y sin activar campañas desde esta pantalla.</small></span><input type="checkbox" checked={marketing} onChange={(event) => void changeMarketing(event.target.checked)} /></label><p className="hint">Versión {MARKETING_CONSENT_VERSION} · {evidenceLabel("marketing")}.</p></section>
    {message && <div className="notice" role="status">{message}</div>}
    <BottomBackAction label="← Legal y privacidad" onBack={onBack} />
  </>;
}
