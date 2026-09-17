"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { RoundSetupPreflightIssue } from "../../lib/round-setup-preflight";
import { issuesBlockingWizardStep, readWizardStep, wizardEditorId, wizardIssueStep, type WizardBetEntry, type WizardStep } from "../../lib/round-setup-wizard";
import { WizardBetEditorContext } from "./round-wizard-context";
import styles from "./round-setup-wizard.module.css";

const STEPS = ["Campo", "Jugadores", "Grupales", "Personales"] as const;
const WizardContext = createContext<{ step: WizardStep; edit: (step: WizardStep) => void; target: { id: string; revision: number } | null }>({ step: 1, edit: () => {}, target: null });

export function RoundSetupWizard({ storageKey, issues, onStart, onSave, onExit, editing = false, children }: {
  storageKey: string;
  issues: readonly RoundSetupPreflightIssue[];
  onStart: () => Promise<boolean>;
  onSave: () => boolean | void;
  onExit: () => void;
  editing?: boolean;
  children: ReactNode;
}) {
  const [step, setStep] = useState<WizardStep>(() => {
    try { return readWizardStep(sessionStorage.getItem(storageKey)); } catch { return 1; }
  });
  const [visitedReview, setVisitedReview] = useState(step === 5);
  const [target, setTarget] = useState<{ id: string; revision: number } | null>(null);
  const targetRevision = useRef(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const blocking = issuesBlockingWizardStep(issues, step);

  function save() {
    if (onSave() === false) { setError("No pudimos guardar el borrador en este dispositivo. Reintenta antes de salir."); return false; }
    return true;
  }
  function navigate(next: WizardStep, issue?: RoundSetupPreflightIssue) {
    if (inFlight.current || !save()) return;
    setError("");
    setStep(next);
    setTarget(issue ? { id: wizardEditorId(issue.targetId), revision: ++targetRevision.current } : null);
    if (next === 5) setVisitedReview(true);
    try { sessionStorage.setItem(storageKey, String(next)); } catch { /* Round data uses the existing draft store. */ }
    requestAnimationFrame(() => {
      const control = issue ? document.getElementById(issue.targetId) ?? document.getElementById(`result-section-${wizardEditorId(issue.targetId)}`) : titleRef.current;
      control?.scrollIntoView({ block: "start", behavior: "smooth" });
      if (issue) control?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
      else titleRef.current?.focus({ preventScroll: true });
    });
  }
  function advance(next: WizardStep) {
    const first = issues.find((issue) => wizardIssueStep(issue) < next);
    if (first) { navigate(wizardIssueStep(first), first); return; }
    navigate(next);
  }
  async function start() {
    if (inFlight.current) return;
    if (issues.length) { navigate(wizardIssueStep(issues[0]), issues[0]); return; }
    if (!save()) return;
    inFlight.current = true;
    setStarting(true);
    setError("");
    try {
      if (await onStart()) {
        try { sessionStorage.removeItem(storageKey); } catch { /* Nonessential UI preference. */ }
        return; // Keep the guard closed until this wizard unmounts after navigation.
      }
    } catch { setError("No pudimos iniciar la ronda. Tu configuración se conserva; vuelve a intentar."); }
    inFlight.current = false;
    setStarting(false);
  }

  return <WizardContext value={{ step, edit: navigate, target }}><div className={styles.wizard} aria-busy={starting}>
    <header className={styles.header}>
      <div><small>CONFIGURAR Y JUGAR</small><h1 ref={titleRef} tabIndex={-1}>{step === 5 ? "Revisar ronda" : STEPS[step - 1]}</h1></div>
      <button type="button" className="textButton" disabled={starting} onClick={() => { if (save()) onExit(); }}>Guardar y salir</button>
    </header>
    <nav className={styles.stepper} aria-label="Pasos para configurar la ronda">{STEPS.map((label, index) => {
      const number = (index + 1) as WizardStep;
      const completed = number < step && !issues.some((issue) => wizardIssueStep(issue) === number);
      return <button type="button" key={label} aria-current={step === number ? "step" : undefined} aria-label={`${number} ${label} · ${step === number ? "actual" : completed ? "completado" : "pendiente"}`} disabled={starting} onClick={() => number < step ? navigate(number) : advance(number)}><span aria-hidden="true">{completed ? "✓" : number}</span><b>{label}</b></button>;
    })}</nav>
    {children}
    {blocking.length > 0 && <section className={styles.preflight} aria-label="Falta completar"><h2>FALTA COMPLETAR</h2><p>Toca para corregir. El resto de tu configuración se conserva.</p>{blocking.map((issue) => <button type="button" key={issue.id} onClick={() => navigate(wizardIssueStep(issue), issue)}><b>{issue.label} ›</b><span>{issue.detail}</span></button>)}</section>}
    {error && <p className="notice bad" role="alert">{error}</p>}
    <footer className={styles.controls}>
      {step > 1 && <button type="button" className="secondary" disabled={starting} onClick={() => navigate((step - 1) as WizardStep)}>← Atrás</button>}
      {step < 5 ? <button type="button" className="primary" disabled={blocking.length > 0} onClick={() => advance((step + 1) as WizardStep)}>{step === 4 ? "Revisar y jugar →" : "Continuar →"}</button> : <button type="button" className="primary" disabled={starting || issues.length > 0} onClick={() => void start()}>{starting ? "Iniciando…" : editing ? "Guardar y continuar →" : "Iniciar ronda →"}</button>}
      {visitedReview && step < 4 && <button type="button" className="textButton" disabled={starting} onClick={() => advance(5)}>Volver al resumen</button>}
    </footer>
  </div></WizardContext>;
}

export function RoundSetupStep({ step, children }: { step: WizardStep; children: ReactNode }) {
  const wizard = useContext(WizardContext);
  // Keep existing editors mounted: switching steps never reconstructs or resets a bet.
  return <div className={styles.panel} data-wizard-step={step} hidden={wizard.step !== step}>{children}</div>;
}

export function WizardReviewBlock({ step, title, children }: { step: WizardStep; title: string; children: ReactNode }) {
  const wizard = useContext(WizardContext);
  return <section className={`card ${styles.review}`}><div><h2>{title}</h2><button type="button" className="textButton" onClick={() => wizard.edit(step)}>Editar {STEPS[step - 1].toLowerCase()}</button></div>{children}</section>;
}

export function WizardBetCatalog({ entries, children }: { entries: readonly WizardBetEntry[]; children: ReactNode }) {
  const wizard = useContext(WizardContext);
  const [selection, setSelection] = useState<{ id: string | null; revision: number | undefined }>({ id: null, revision: undefined });
  const selected = wizard.target && wizard.target.revision !== selection.revision && entries.some((entry) => entry.id === wizard.target?.id) ? wizard.target.id : selection.id;
  const select = (id: string | null) => setSelection({ id, revision: wizard.target?.revision });
  const active = entries.filter((entry) => entry.enabled);
  return <WizardBetEditorContext value={{ ids: entries.map((entry) => entry.id), selected, select }}>
    <div className={styles.catalog}>
      {selected ? <button type="button" className="secondary" onClick={() => select(null)}>← Elegir otra apuesta · {active.length} activa{active.length === 1 ? "" : "s"}</button> : <>
        <p className="hint">{active.length ? `${active.length} modalidades activas. Toca para editar.` : "Opcional. Puedes jugar sin apuestas."}</p>
        <div className={styles.choices}>{entries.map((entry) => <button type="button" key={entry.id} aria-label={`Configurar ${entry.label}`} data-enabled={entry.enabled} onClick={() => select(entry.id)}><b>{entry.label}</b><small>{entry.enabled ? "✓ Activa · Editar" : "Configurar"}</small></button>)}</div>
      </>}
      {children}
    </div>
  </WizardBetEditorContext>;
}
