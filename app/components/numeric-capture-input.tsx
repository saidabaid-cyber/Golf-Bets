"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { finalizeNumericCapture, initialNumericCapture, parseNumericCapture } from "../../lib/numeric-input";

type NumericCaptureInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number | null | undefined;
  onValueChange: (value: number | null) => void;
  emptyWhenZero?: boolean;
};

export function NumericCaptureInput({
  value,
  onValueChange,
  emptyWhenZero = true,
  onBlur,
  onFocus,
  min,
  max,
  ...inputProps
}: NumericCaptureInputProps) {
  const [rawValue, setRawValue] = useState(() => initialNumericCapture(value, emptyWhenZero));
  const focused = useRef(false);
  const previousValue = useRef(value);

  useEffect(() => {
    if (Object.is(previousValue.current, value)) return;
    previousValue.current = value;
    if (!focused.current) setRawValue(initialNumericCapture(value, emptyWhenZero));
  }, [emptyWhenZero, value]);

  return <input
    {...inputProps}
    type="number"
    min={min}
    max={max}
    value={rawValue}
    onFocus={(event) => {
      focused.current = true;
      onFocus?.(event);
    }}
    onBlur={(event) => {
      focused.current = false;
      const finalized = finalizeNumericCapture(rawValue, min, max);
      setRawValue(finalized.raw);
      previousValue.current = finalized.value;
      if (!Object.is(finalized.value, value)) onValueChange(finalized.value);
      onBlur?.(event);
    }}
    onChange={(event) => {
      setRawValue(event.target.value);
      onValueChange(parseNumericCapture(event.target.value));
    }}
  />;
}
