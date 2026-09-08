"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LEGAL_EVIDENCE_DEFINITIONS } from "../../lib/legal-documents";

const financialStatements = LEGAL_EVIDENCE_DEFINITIONS.financial_data.statements;

export function BettingConsentDialog({ onAccept, onReject, onDismiss }: {
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    checkboxRef.current?.focus();
    return () => prior?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) { event.preventDefault(); onDismiss(); return; }
    if (event.key !== "Tab") return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("a[href], input, button:not([disabled])") || [])];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <main className="consentScreen bettingConsentAccess">
    <section ref={dialogRef} className="consentCard bettingConsentDialog" role="dialog" aria-modal="true" aria-labelledby="betting-consent-title" aria-describedby="betting-consent-description" onKeyDown={handleKeyDown}>
      <button type="button" className="modalClose" aria-label="Cerrar consentimiento" disabled={busy} onClick={onDismiss}>×</button>
      <div className="eyebrow">CONSENTIMIENTO EXPRESO</div>
      <h2 id="betting-consent-title">Apuestas, resultados y gastos</h2>
       <p id="betting-consent-description">Para registrar apuestas privadas, saldos, gastos y resultados económicos necesitamos tu autorización específica. Puedes seguir usando las funciones deportivas que no dependan de este tratamiento si eliges no autorizar.</p>
      <label className="consentCheck bettingConsentCheck">
        <input ref={checkboxRef} type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        <span>{financialStatements.accepted} Consulta el <Link href="/legal/privacy?returnTo=app">Aviso de Privacidad Integral</Link>.</span>
      </label>
      <p className="hint">Si eliges “No autorizar”, se registrará: “{financialStatements.rejected}”</p>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <div className="confirmActions">
        <button type="button" className="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await onReject(); }
          catch (rejectError) { setError(rejectError instanceof Error ? rejectError.message : "No se pudo guardar el rechazo."); }
          finally { setBusy(false); }
        }}>No autorizar</button>
        <button type="button" className="primary" disabled={!checked || busy} onClick={async () => {
          setBusy(true); setError("");
          try { await onAccept(); }
          catch (acceptError) { setError(acceptError instanceof Error ? acceptError.message : "No se pudo guardar la aceptación en este dispositivo."); }
          finally { setBusy(false); }
        }}>{busy ? "Guardando…" : "Aceptar y continuar"}</button>
      </div>
     </section>
   </main>;
}
