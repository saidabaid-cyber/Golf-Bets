"use client";

import styles from "./capture-controls.module.css";

export function CompactStepper({ label, value, fallback = 0, min = 0, max = 99, onChange, large = false, valueSuffix }: { label: string; value: number | null | undefined; fallback?: number; min?: number; max?: number; onChange: (value: number) => void; large?: boolean; valueSuffix?: string }) {
  const confirmed = typeof value === "number" && Number.isFinite(value);
  const current = confirmed ? value : fallback;
  return <div className={`${styles.stepper} ${large ? styles.large : ""}`} role="group" aria-label={label}>
    <button type="button" aria-label={`Restar en ${label}`} disabled={current <= min} onClick={() => onChange(Math.max(min, current - 1))}>−</button>
    <button type="button" className={styles.value} aria-label={`Confirmar ${label}: ${current}`} aria-pressed={confirmed} data-pending={!confirmed} onClick={() => onChange(current)}>{current}{valueSuffix && <small>{valueSuffix}</small>}</button>
    <button type="button" aria-label={`Sumar en ${label}`} disabled={current >= max} onClick={() => onChange(Math.min(max, current + 1))}>+</button>
  </div>;
}

export function SignedStepper({ label, value, onDelta }: { label: string; value: number; onDelta: (delta: number) => void }) {
  return <div className={styles.signed} role="group" aria-label={label}>
    <button type="button" aria-label={`Restar ${label}`} onClick={() => onDelta(-1)}>−</button>
    <span aria-live="polite">{value > 0 ? "+" : ""}{value}</span>
    <button type="button" aria-label={`Sumar ${label}`} onClick={() => onDelta(1)}>+</button>
  </div>;
}

/** Untouched and zero are equivalent for optional golf facts; no confirm-zero UI. */
export function TapCounter({ label, icon, value, max = 20, onChange, compact = false }: { label: string; icon: string; value: number | null | undefined; max?: number; onChange: (value: number) => void; compact?: boolean }) {
  const current = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return <div className={`${styles.counter} ${compact ? styles.counterCompact : ""}`} role="group" aria-label={label}>
    <button type="button" className={styles.counterAdd} aria-label={`Agregar ${label}`} disabled={current >= max} onClick={() => onChange(Math.min(max, current + 1))}><span aria-hidden="true">{icon}</span><span>{label}</span>{current > 0 && <b>{current}</b>}</button>
    {current > 0 && <button type="button" className={styles.counterSubtract} aria-label={`Restar ${label}`} onClick={() => onChange(current - 1)}>−</button>}
  </div>;
}
