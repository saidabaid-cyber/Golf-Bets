export const CAREER_TABS = [
  { id: "summary", label: "Resumen" },
  { id: "achievements", label: "Logros" },
  { id: "rivalries", label: "Rivalidades" },
  { id: "rounds", label: "Rondas" },
  { id: "tournaments", label: "Torneos" },
] as const;
export type CareerView = typeof CAREER_TABS[number]["id"];
export type CareerDetail = "index" | "attest" | null;
export function careerViewFromSearch(search: string): CareerView {
  const value = new URLSearchParams(search).get("career");
  return CAREER_TABS.find(tab => tab.id === value)?.id ?? "summary";
}
/** Index/Atest are details of Resumen, never content above another section. */
export function careerDetailFromSearch(search: string): CareerDetail {
  const value = new URLSearchParams(search).get("careerDetail");
  return careerViewFromSearch(search) === "summary" && (value === "index" || value === "attest") ? value : null;
}
