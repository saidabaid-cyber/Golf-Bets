"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BETTING_DATA_CONSENT_TYPE, type LegalAcceptance } from "../../lib/account-state";
import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { MARKETING_CONSENT_VERSION, readMarketingConsent, writeMarketingConsent } from "../../lib/marketing-consent";
import { BACKYARD_AI_MEMORY_POLICY_VERSION, defaultLearningConsent, readLearningConsent, writeLearningConsent } from "../../lib/backyard-ai/memory/learning-events";
import type { LearningConsent } from "../../lib/backyard-ai/memory/types";
import { AiProcessingConsentSettings } from "./backyard-ai/ai-processing-consent";

export function LegalConsentManager({ userId, accessToken, authenticated, acceptances, bettingConsentGranted, requestBettingConsent, onBack }: {
  userId: string;
  accessToken: string | null;
  authenticated: boolean;
  acceptances: LegalAcceptance[];
  bettingConsentGranted: boolean;
  requestBettingConsent: () => Promise<boolean>;
  onBack: () => void;
}) {
  const [learning, setLearning] = useState<LearningConsent>(() => defaultLearningConsent(userId, BACKYARD_AI_MEMORY_POLICY_VERSION));
  const [marketing, setMarketing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const learningResult = readLearningConsent(localStorage, userId, BACKYARD_AI_MEMORY_POLICY_VERSION);
    const marketingRecord = readMarketingConsent(localStorage, userId);
    setLearning(learningResult.consent);
    setMarketing(Boolean(marketingRecord?.acceptedAt && !marketingRecord.revokedAt));
  }, [userId]);

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

  function changeMarketing(accepted: boolean) {
    try { writeMarketingConsent(localStorage, userId, accepted); setMarketing(accepted); setMessage(accepted ? "Marketing opcional activado." : "Marketing opcional desactivado."); }
    catch { setMessage("No pude guardar esta elección. Marketing permanece desactivado."); setMarketing(false); }
  }

  const accepted = (type: LegalAcceptance["type"]) => acceptances.some((item) => item.userId === userId && item.type === type);
  return <>
    <button type="button" className="secondary pageBack" onClick={onBack}>← Legal y privacidad</button>
    <section className="hero"><div><div className="eyebrow">PRIVACIDAD</div><h1>Gestionar consentimientos</h1><p>Cada finalidad se controla por separado. Nada está premarcado.</p></div></section>
    <section className="card"><h2>Documentos y edad</h2><div className="documentConsentList">
      <Link href="/legal/terms?returnTo=account"><span>Términos y Condiciones</span><b>{accepted("terms") ? "Aceptados" : "Pendientes"} · {LEGAL_DOCUMENT_VERSIONS.terms}</b></Link>
      <Link href="/legal/privacy-simplified?returnTo=account"><span>Aviso Simplificado</span><b>{LEGAL_DOCUMENT_VERSIONS.privacy.split("+")[0]}</b></Link>
      <Link href="/legal/privacy?returnTo=account"><span>Aviso Integral</span><b>{accepted("privacy") ? "Presentado" : "Pendiente"} · {LEGAL_DOCUMENT_VERSIONS.privacy.split("+")[0]}</b></Link>
      <div><span>Declaración de mayoría de edad</span><b>{accepted("age_confirmation") ? "Confirmada" : "Pendiente"}</b></div>
    </div><p className="hint">Los Términos no se muestran como un switch cotidiano. Para dejar de usar el servicio puedes cerrar sesión o solicitar eliminación; tus derechos ARCO permanecen disponibles.</p></section>

    <section className="card"><h2>Datos financieros/patrimoniales</h2><p>Apuestas, saldos, gastos y resultados económicos. Rechazarlo no bloquea score, campo ni funciones deportivas independientes.</p><div className="row between"><span>{bettingConsentGranted || accepted(BETTING_DATA_CONSENT_TYPE) ? "Vigente" : "No otorgado"}</span>{!bettingConsentGranted && <button type="button" className="secondary" onClick={() => void requestBettingConsent()}>Revisar y decidir</button>}</div>{bettingConsentGranted && <p className="hint">Para revocar esta finalidad, solicita la limitación a <a href={`mailto:${legalConfig.privacyEmail}?subject=Revocaci%C3%B3n%20de%20consentimiento%20financiero`}>{legalConfig.privacyEmail}</a>. Te explicaremos el alcance antes de aplicarla.</p>}</section>

    <AiProcessingConsentSettings userId={userId} accessToken={accessToken} requiresRemoteConsent={authenticated} />

    <section className="card"><h2>Memoria y aprendizaje</h2>
      <label className="preferenceRow"><span><b>Memoria personal</b><small className="preferenceDescription">Recuerda tus preferencias privadas para futuras rondas.</small></span><input type="checkbox" checked={learning.personalMemoryEnabled} onChange={(event) => changeLearning({ personalMemoryEnabled: event.target.checked })} /></label>
      <label className="preferenceRow"><span><b>Learning global futuro</b><small className="preferenceDescription">Opt-in separado. No entrena automáticamente y sólo habilita datos desidentificados y revisados.</small></span><input type="checkbox" checked={learning.globalLearningEnabled} onChange={(event) => changeLearning({ globalLearningEnabled: event.target.checked })} /></label>
      <p className="hint">Versión {BACKYARD_AI_MEMORY_POLICY_VERSION}. Inputs privados permanecen excluidos por defecto.</p>
    </section>

    <section className="card"><h2>Marketing opcional</h2><label className="preferenceRow"><span><b>Recibir comunicaciones de marketing</b><small className="preferenceDescription">Opcional, apagado por defecto y sin activar campañas desde esta pantalla.</small></span><input type="checkbox" checked={marketing} onChange={(event) => changeMarketing(event.target.checked)} /></label><p className="hint">Versión {MARKETING_CONSENT_VERSION}.</p></section>
    {message && <div className="notice" role="status">{message}</div>}
  </>;
}
