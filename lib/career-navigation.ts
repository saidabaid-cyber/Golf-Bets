export const CAREER_TABS = [
  { id: "summary", label: "Resumen" },
  { id: "achievements", label: "Logros" },
  { id: "rivalries", label: "Rivalidades" },
  { id: "rounds", label: "Rondas" },
  { id: "tournaments", label: "Torneos" },
] as const;
export type CareerView = typeof CAREER_TABS[number]["id"];
export function careerViewFromSearch(search: string): CareerView {
  const value = new URLSearchParams(search).get("career");
  return CAREER_TABS.find(tab => tab.id === value)?.id ?? "summary";
}
