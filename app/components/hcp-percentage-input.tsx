"use client";

import styles from "./hcp-percentage-input.module.css";

export function normalizeHcpPercentage(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(5, Math.round(value / 5) * 5));
}

export function HcpPercentageInput({ value, onChange, disabled = false, label = "HCP aplicado" }: { value: number; onChange: (value: number) => void; disabled?: boolean; label?: string }) {
  const normalized = normalizeHcpPercentage(value);
  return <label className={styles.control}>
    <span>{label}: <b>{normalized}%</b></span>
    <div>
      <button type="button" disabled={disabled || normalized <= 5} onClick={() => onChange(normalizeHcpPercentage(normalized - 5))}>−5%</button>
      <input aria-label={label} type="range" min={5} max={100} step={5} value={normalized} disabled={disabled} onChange={(event) => onChange(normalizeHcpPercentage(Number(event.target.value)))} />
      <button type="button" disabled={disabled || normalized >= 100} onClick={() => onChange(normalizeHcpPercentage(normalized + 5))}>+5%</button>
    </div>
  </label>;
}
