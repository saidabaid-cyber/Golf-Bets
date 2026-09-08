import type { RoundPresentation } from "./types";

export const DEFAULT_ROUND_PRESENTATION: Readonly<Required<RoundPresentation>> = {
  version: 1,
  groupNassauTerm: "polla",
};

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Legacy rounds did not persist presentation metadata and therefore keep the
 * former Polla terminology. Invalid values fail closed to that same behavior. */
export function normalizeRoundPresentation(value: unknown): Required<RoundPresentation> {
  const source = runtimeRecord(value);
  return {
    version: 1,
    groupNassauTerm: source?.groupNassauTerm === "nassau" ? "nassau" : "polla",
  };
}

export type GroupNassauComponent = "first9" | "second9" | "total18";
export type PollaResultComponent = GroupNassauComponent | "mini";

export function groupNassauPresentation(value: unknown) {
  const presentation = normalizeRoundPresentation(value);
  const isNassau = presentation.groupNassauTerm === "nassau";
  const component = (key: GroupNassauComponent) => {
    if (isNassau) {
      return key === "first9" ? "Nassau · frente"
        : key === "second9" ? "Nassau · vuelta"
          : "Nassau · total";
    }
    return key === "first9" ? "Polla 1ª vuelta"
      : key === "second9" ? "Polla 2ª vuelta"
        : "Polla 18 hoyos";
  };
  return {
    term: presentation.groupNassauTerm,
    name: isNassau ? "Nassau" : "Polla",
    pluralName: isNassau ? "Nassau" : "Pollas",
    summary: isNassau ? "Nassau · frente / vuelta / total" : "Pollas · 1ª / 2ª vuelta / total",
    component,
    resultComponent(key: PollaResultComponent) {
      return key === "mini" ? "Mini Polla" : component(key);
    },
  };
}

/** Maps canonical engine/history category names into the terminology chosen by
 * the user, without altering keys, balances, or calculation results. */
export function groupNassauHistoricalLabel(label: string, value: unknown) {
  const presentation = groupNassauPresentation(value);
  if (presentation.term !== "nassau") return label;
  const normalized = label.trim().toLocaleLowerCase("es-MX");
  if (normalized === "polla 1ª vuelta" || normalized === "polla h1–9") return `🥈 ${presentation.component("first9")}`;
  if (normalized === "polla 2ª vuelta" || normalized === "polla h10–18") return `🥈 ${presentation.component("second9")}`;
  if (normalized === "polla nassau" || normalized === "polla 18 hoyos") return `🏆 ${presentation.component("total18")}`;
  return label;
}
