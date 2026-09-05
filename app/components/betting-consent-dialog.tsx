"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function BettingConsentDialog({ onAccept, onDismiss }: {
  onAccept: () => Promise<void>;
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

  return <div className="modalBackdrop bettingConsentBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onDismiss(); }}>
    <section ref={dialogRef} className="confirmDialog bettingConsentDialog" role="dialog" aria-modal="true" aria-labelledby="betting-consent-title" aria-describedby="betting-consent-description" onKeyDown={handleKeyDown}>
      <button type="button" className="modalClose" aria-label="Cerrar consentimiento" disabled={busy} onClick={onDismiss}>×</button>
      <div className="eyebrow">CONSENTIMIENTO EXPRESO</div>
      <h2 id="betting-consent-title">Apuestas, resultados y gastos</h2>
      <p id="betting-consent-description">Para registrar estos datos necesitamos tu autorización específica. Puedes seguir usando las funciones que no dependan de este tratamiento si cierras esta ventana.</p>
      <label className="consentCheck bettingConsentCheck">
        <input ref={checkboxRef} type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        <span>Consiento expresamente el tratamiento de los datos relativos a apuestas registradas, resultados y gastos, conforme al <Link href="/legal/privacy?returnTo=app">Aviso de Privacidad</Link>.</span>
      </label>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <div className="confirmActions">
        <button type="button" className="secondary" disabled={busy} onClick={onDismiss}>Ahora no</button>
        <button type="button" className="primary" disabled={!checked || busy} onClick={async () => {
          setBusy(true); setError("");
          try { await onAccept(); }
          catch (acceptError) { setError(acceptError instanceof Error ? acceptError.message : "No se pudo guardar la aceptación en este dispositivo."); }
          finally { setBusy(false); }
        }}>{busy ? "Guardando…" : "Aceptar y continuar"}</button>
      </div>
    </section>
  </div>;
}
