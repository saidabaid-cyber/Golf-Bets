"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type BackyardProfile, type LegalAcceptance } from "../../lib/account-state";
import { buildDownloadableAccountExport } from "../../lib/account-data-export";
import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { MARKETING_CONSENT_VERSION, readMarketingConsent, writeMarketingConsent } from "../../lib/marketing-consent";
import { BACKYARD_AI_MEMORY_POLICY_VERSION, defaultLearningConsent, readLearningConsent, writeLearningConsent } from "../../lib/backyard-ai/memory/learning-events";
import type { LearningConsent } from "../../lib/backyard-ai/memory/types";
import { LEGAL_EVIDENCE_DEFINITIONS, type LegalEvidenceAction, type LegalEvidenceSubject } from "../../lib/legal-evidence";
import { hasResolvedMarketingConsent, latestLegalEvidence, legalClientEnvironment, type LegalEvidenceEvent } from "../../lib/legal-evidence-client";
import { AiProcessingConsentSettings } from "./backyard-ai/ai-processing-consent";

export function LegalConsentManager({ profile, userId, accessToken, authenticated, acceptances, legalEvidenceEvents, marketingConsentResolved, bettingConsentGranted, requestBettingConsent, recordLegalChoice, onBack }: {
  profile: BackyardProfile;
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
  const [marketing, setMarketing] = useState(false);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const learningResult = readLearningConsent(localStorage, userId, BACKYARD_AI_MEMORY_POLICY_VERSION);
    const marketingRecord = readMarketingConsent(localStorage, userId);
    setLearning(learningResult.consent);
    setMarketing(hasResolvedMarketingConsent(legalEvidenceEvents, Boolean(marketingRecord?.acceptedAt && !marketingRecord.revokedAt), marketingConsentResolved));
  }, [userId, legalEvidenceEvents, marketingConsentResolved]);

  function changeLearning(patch: Partial<Pick<LearningConsent, "personalMemoryEnabled" | "globalLearningEnabled" | "retainPrivateInputs">>) {
    const now = new Date().toISOString();
    const personalMemoryEnabled = patch.personalMemoryEnabled ?? learning.personalMemoryEnabled;
    const globalLearningEnabled = patch.globalLearningEnabled ?? learning.globalLearningEnabled;
    const anyLearningEnabled = personalMemoryEnabled || globalLearningEnabled;
    const next: LearningConsent = {
      ...learning,
      ...patch,
      updatedAt: now,
      ...(anyLearningEnabled ? { grantedAt: learning.grantedAt ?? now, revokedAt: undefined } : { revokedAt: now }),
    };
    const result = writeLearningConsent(localStorage, next);
    if (!result.ok) { setMessage("No pude guardar esta elección en el dispositivo. No se activó."); return; }
    setLearning(result.consent); setMessage("Elección guardada.");
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

  async function exportLimitedAccountData() {
    if (exporting) return;
    setExporting(true); setMessage("");
    try {
      const result = await buildDownloadableAccountExport({
        storage: localStorage,
        identity: { ...profile, mode: authenticated ? "authenticated" : "guest" },
        environment: legalClientEnvironment(),
        accessToken,
        online: navigator.onLine,
      });
      const payload = result.payload;
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `the-backyard-datos-acotados-${payload.generatedAt.slice(0, 10)}.json`;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage(result.cloudStatus === "included"
        ? "Copia local y limitada de nube preparada. Revisa dentro del archivo qué fuentes incluye y cuáles omite."
        : "Copia local preparada. La parte de nube no estuvo disponible y quedó marcada así dentro del archivo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos preparar la copia limitada.");
    } finally { setExporting(false); }
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

    <section className="card"><h2>Datos financieros/patrimoniales</h2><p>Apuestas, saldos, gastos y resultados económicos. Rechazarlo no bloquea score, campo ni funciones deportivas independientes.</p><div className="row between"><span>{bettingConsentGranted ? `Vigente · ${evidenceLabel("financial_data")}` : evidenceLabel("financial_data")}</span>{bettingConsentGranted ? <button type="button" className="secondary" onClick={() => void revokeFinancialConsent()}>Revocar autorización</button> : <button type="button" className="secondary" onClick={() => void requestBettingConsent()}>Revisar y decidir</button>}</div><p className="hint">{LEGAL_EVIDENCE_DEFINITIONS.financial_data.statements.revoked} Para ejercer derechos ARCO también puedes escribir a <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>.</p></section>

    <AiProcessingConsentSettings userId={userId} accessToken={accessToken} requiresRemoteConsent={authenticated} />

    <section className="card"><h2>Memoria y aprendizaje</h2>
      <label className="preferenceRow"><span><b>Memoria personal</b><small className="preferenceDescription">Recuerda tus preferencias privadas para futuras rondas.</small></span><input type="checkbox" checked={learning.personalMemoryEnabled} onChange={(event) => changeLearning({ personalMemoryEnabled: event.target.checked })} /></label>
      <label className="preferenceRow"><span><b>Learning global futuro</b><small className="preferenceDescription">Opt-in separado. No entrena automáticamente y sólo habilita datos desidentificados y revisados.</small></span><input type="checkbox" checked={learning.globalLearningEnabled} onChange={(event) => changeLearning({ globalLearningEnabled: event.target.checked })} /></label>
      <p className="hint">Versión {BACKYARD_AI_MEMORY_POLICY_VERSION}. Inputs privados permanecen excluidos por defecto.</p>
    </section>

    <section className="card"><h2>Marketing opcional</h2><label className="preferenceRow"><span><b>Recibir comunicaciones de marketing</b><small className="preferenceDescription">Opcional, apagado por defecto y sin activar campañas desde esta pantalla.</small></span><input type="checkbox" checked={marketing} onChange={(event) => void changeMarketing(event.target.checked)} /></label><p className="hint">Versión {MARKETING_CONSENT_VERSION} · {evidenceLabel("marketing")}.</p></section>
    <section className="card"><h2>Copia de datos</h2><p>Descarga una copia acotada del workspace activo: perfil, historial y borrador de ronda, plantillas propias de jugadores, grupos y oponentes, campos, preferencias y evidencia legal local. Si tu sesión está activa también intenta incluir la copia limitada de las fuentes de Preview enumeradas en el archivo.</p><p className="hint">No incluye tokens, secretos, workspaces de otras cuentas, rondas compartidas de terceros ni archivos binarios. Cada sección declara su alcance y omisiones; la copia local sigue disponible sin conexión o sin sesión de nube.</p><button type="button" className="secondary" disabled={exporting} onClick={() => void exportLimitedAccountData()}>{exporting ? "Preparando…" : authenticated ? "Descargar copia limitada" : "Descargar copia local"}</button><p className="hint">Esta herramienta no sustituye una respuesta formal de derechos ARCO ni afirma ser una exportación completa. Para una solicitud ARCO escribe a <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>.</p></section>
    {message && <div className="notice" role="status">{message}</div>}
  </>;
}
