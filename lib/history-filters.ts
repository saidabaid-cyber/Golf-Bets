import type { RoundSnapshot } from "./types";

export const MONTH_LABELS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"] as const;

export function historyYears(history: RoundSnapshot[]) {
  return Array.from(new Set(history.map((round) => /^\d{4}/.exec(round.date)?.[0]).filter((value): value is string => Boolean(value)))).sort().reverse();
}

export function filterHistory(history: RoundSnapshot[], year: string, month: string) {
  return history.filter((round) => {
    const [roundYear, roundMonth] = round.date.split("-");
    return (!year || roundYear === year) && (!month || roundMonth === month);
  });
}
