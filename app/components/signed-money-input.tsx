"use client";

import { useEffect, useState } from "react";
import { applyNumericDirection, type NumericDirection } from "../../lib/numeric-input";
import { NumericCaptureInput } from "./numeric-capture-input";

export function SignedMoneyInput({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const [direction, setDirection] = useState<NumericDirection>(value < 0 ? "loss" : "gain");

  useEffect(() => {
    if (value !== 0) setDirection(value < 0 ? "loss" : "gain");
  }, [value]);

  return <div className="signedMoneyCapture">
    <div className="signedMoneyDirection" role="group" aria-label={`Resultado de ${label}`}>
      <button type="button" className={direction === "gain" ? "active" : ""} aria-pressed={direction === "gain"} onClick={() => { setDirection("gain"); onChange(Math.abs(value)); }}>Gana +</button>
      <button type="button" className={direction === "loss" ? "active loss" : ""} aria-pressed={direction === "loss"} onClick={() => { setDirection("loss"); onChange(-Math.abs(value)); }}>Pierde −</button>
    </div>
    <div className="moneyField"><span>$</span><NumericCaptureInput inputMode="numeric" step={50} min={0} value={Math.abs(value)} onValueChange={(next) => onChange(applyNumericDirection(next, direction))} /></div>
  </div>;
}
