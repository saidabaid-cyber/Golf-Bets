"use client";

import { NumericCaptureInput } from "./numeric-capture-input";

/** Currency prefix only; numeric capture and saved values retain their semantics. */
export function BetMoneyInput({ label, value, onChange, min = 0, max, step = 1, className }: {
  label: string; value: number | undefined; onChange: (value: number) => void;
  min?: number; max?: number; step?: number; className?: string;
}) {
  return <label className={className}>{label}<span className="moneyField"><span aria-hidden="true">$</span><NumericCaptureInput aria-label={label} inputMode="decimal" min={min} max={max} step={step} value={typeof value === "number" && Number.isFinite(value) ? value : null} emptyWhenZero onValueChange={(next) => onChange(next ?? 0)} /></span></label>;
}
