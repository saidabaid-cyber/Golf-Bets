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
  const rawValueRef = useRef(rawValue);
  const focused = useRef(false);
  const previousValue = useRef(value);

  useEffect(() => {
    if (Object.is(previousValue.current, value)) return;
    previousValue.current = value;
    if (!focused.current) {
      const nextRawValue = initialNumericCapture(value, emptyWhenZero);
      rawValueRef.current = nextRawValue;
      setRawValue(nextRawValue);
    }
  }, [emptyWhenZero, value]);

  const commit = (domValue?: string) => {
    // The DOM change event and the Save pointer gesture can occur before React
    // commits the render containing the last character (notably on iOS). Keep
    // the editing buffer in a ref so blur always confirms the newest input.
    const latestRawValue = domValue === undefined ? rawValueRef.current : normalizeNumericCaptureText(domValue);
    const finalized = finalizeNumericCapture(latestRawValue, min, max);
    rawValueRef.current = finalized.raw;
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
    data-numeric-capture="true"
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
      commit(event.currentTarget.value);
      onBlur?.(event);
    }}
    onChange={(event) => {
      const nextRawValue = normalizeNumericCaptureText(event.target.value);
      rawValueRef.current = nextRawValue;
      setRawValue(nextRawValue);
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      onKeyDown?.(event);
    }}
  />;
}
