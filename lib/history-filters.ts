import type { RoundSnapshot } from "./types";

export const MONTH_LABELS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"] as const;

type CalendarDate = {
  year: string;
  month: string;
};

function runtimeValue(value: unknown, key: string): unknown {
  try {
    return value && typeof value === "object" ? Reflect.get(value, key) : undefined;
  } catch {
    return undefined;
  }
}

function runtimeRound(value: unknown): { round: RoundSnapshot; id: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = runtimeValue(value, "id");
  return typeof id === "string" && Boolean(id.trim()) ? { round: value as RoundSnapshot, id: id.trim() } : undefined;
}

function calendarDate(value: unknown): CalendarDate | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth ? { year: match[1], month: match[2] } : undefined;
}

function snapshotTimestamp(round: RoundSnapshot) {
  for (const key of ["updatedAt", "completedAt", "date"] as const) {
    const candidate = runtimeValue(round, key);
    if (typeof candidate !== "string") continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * Keeps the latest persisted correction for every usable round id. The ordering
 * mirrors persisted history reconciliation: newest first and, when timestamps
 * are equal or missing, the later input wins deterministically.
 */
function latestHistorySnapshots(history: readonly RoundSnapshot[]) {
  if (!Array.isArray(history)) return [];

  const latest = new Map<string, { round: RoundSnapshot; timestamp: number; index: number }>();
  history.forEach((value: unknown, index) => {
    const entry = runtimeRound(value);
    if (!entry) return;
    const { round, id } = entry;
    const timestamp = snapshotTimestamp(round);
    const previous = latest.get(id);
    if (!previous || timestamp > previous.timestamp || (timestamp === previous.timestamp && index > previous.index)) {
      latest.set(id, { round, timestamp, index });
    }
  });

  return [...latest.values()]
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) return left.timestamp > right.timestamp ? -1 : 1;
      return right.index - left.index;
    })
    .map(({ round }) => round);
}

export function historyYears(history: readonly RoundSnapshot[]) {
  const years = new Set<string>();
  for (const round of latestHistorySnapshots(history)) {
    const date = calendarDate(runtimeValue(round, "date"));
    if (date) years.add(date.year);
  }
  return [...years].sort().reverse();
}

export function filterHistory(history: readonly RoundSnapshot[], year: string, month: string) {
  const selectedYear = typeof year === "string" ? year.trim() : "";
  const selectedMonth = typeof month === "string" ? month.trim() : "";
  const hasFilter = Boolean(selectedYear || selectedMonth);

  return latestHistorySnapshots(history).filter((round) => {
    const date = calendarDate(runtimeValue(round, "date"));
    // Keep damaged dated snapshots discoverable in the unfiltered history so
    // the user can inspect/delete them, but never assign them to a period.
    if (!date) return !hasFilter;
    return (!selectedYear || date.year === selectedYear) && (!selectedMonth || date.month === selectedMonth);
  });
}
