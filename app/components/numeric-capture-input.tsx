"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { flushSync } from "react-dom";
import { finalizeNumericCapture, initialNumericCapture, normalizeNumericCaptureText } from "../../lib/numeric-input";

type NumericCaptureInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number | null | undefined;
  onValueChange: (value: number | null) => void;
  emptyWhenZero?: boolean;
  commitUnchanged?: boolean;
};

export function NumericCaptureInput({
  value,
  onValueChange,
  emptyWhenZero = true,
  commitUnchanged = false,
  onBlur,
  onFocus,
  onKeyDown,
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

  const commit = () => {
    const finalized = finalizeNumericCapture(rawValue, min, max);
    setRawValue(finalized.raw);
    previousValue.current = finalized.value;
    if (commitUnchanged || !Object.is(finalized.value, value)) {
      // A Save-button click follows blur in the same browser gesture. Flush the
      // confirmed value now so that Save never observes the previous render.
      flushSync(() => onValueChange(finalized.value));
    }
  };

  return <input
    {...inputProps}
    type="text"
    inputMode="text"
    enterKeyHint={inputProps.enterKeyHint ?? "done"}
    value={rawValue}
    onFocus={(event) => {
      focused.current = true;
      onFocus?.(event);
    }}
    onBlur={(event) => {
      focused.current = false;
      commit();
      onBlur?.(event);
    }}
    onChange={(event) => {
      setRawValue(normalizeNumericCaptureText(event.target.value));
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      onKeyDown?.(event);
    }}
  />;
}
