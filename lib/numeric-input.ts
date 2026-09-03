export function initialNumericCapture(value: number | null | undefined, emptyWhenZero = true) {
  if (value === null || value === undefined || (emptyWhenZero && value === 0)) return "";
  return String(value);
}

export function parseNumericCapture(raw: string) {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function numericCaptureOr(raw: string, fallback = 0) {
  return parseNumericCapture(raw) ?? fallback;
}

export type NumericDirection = "gain" | "loss";

export function applyNumericDirection(value: number | null, direction: NumericDirection) {
  const magnitude = Math.abs(value ?? 0);
  return direction === "loss" ? -magnitude : magnitude;
}

function finiteLimit(value: string | number | undefined) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function finalizeNumericCapture(
  raw: string,
  min?: string | number,
  max?: string | number,
) {
  const parsed = parseNumericCapture(raw);
  if (parsed === null) return { raw: "", value: null } as const;
  const lower = finiteLimit(min);
  const upper = finiteLimit(max);
  const value = Math.min(upper ?? Number.POSITIVE_INFINITY, Math.max(lower ?? Number.NEGATIVE_INFINITY, parsed));
  return { raw: String(value), value } as const;
}
