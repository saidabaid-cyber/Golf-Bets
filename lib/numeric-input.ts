export function initialNumericCapture(value: number | null | undefined, emptyWhenZero = true) {
  if (value === null || value === undefined || (emptyWhenZero && value === 0)) return "";
  return String(value);
}

/** Keeps the editing buffer human-friendly without turning intermediate input
 * into application state. iOS can show its complete keyboard while the final
 * value remains strictly numeric. */
export function normalizeNumericCaptureText(raw: string) {
  const compact = raw.replace(/\s/g, "");
  const sign = /^[+-]/.test(compact) ? compact[0] : "";
  const body = compact.replace(/[+-]/g, "");
  let separator = false;
  let normalized = "";
  for (const character of body) {
    if (/\d/.test(character)) normalized += character;
    else if ((character === "." || character === ",") && !separator) {
      normalized += character;
      separator = true;
    }
  }
  return sign + normalized;
}

export function parseNumericCapture(raw: string) {
  if (raw.trim() === "") return null;
  const normalized = normalizeNumericCaptureText(raw).replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
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
