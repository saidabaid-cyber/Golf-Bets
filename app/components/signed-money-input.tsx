"use client";

import { NumericCaptureInput } from "./numeric-capture-input";

export function SignedMoneyInput({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const tone = value > 0 ? "gain" : value < 0 ? "loss" : "neutral";
  return <div className={`signedMoneyCapture ${tone}`}>
    <div className="moneyField"><span>$</span><NumericCaptureInput aria-label={label} step={50} value={value} emptyWhenZero={false} placeholder="0" onValueChange={(next) => onChange(next ?? 0)} /></div>
  </div>;
}
