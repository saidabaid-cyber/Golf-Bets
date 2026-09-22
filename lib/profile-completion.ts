import type { EquipmentProfile } from "./golf-equipment";
export const COMPLETION_SECTIONS = ["personal", "username", "golf", "handicap", "equipment", "ball", "fitting"] as const;
export type CompletionSection = typeof COMPLETION_SECTIONS[number];
export type CompletionChoices = { handicap_choice: "MANUAL" | "UNKNOWN" | null; manual_hcp: number | null; not_applicable: string[] };
export const EMPTY_COMPLETION_CHOICES: CompletionChoices = { handicap_choice: null, manual_hcp: null, not_applicable: [] };
export const COMPLETION_LABELS: Record<CompletionSection, string> = { personal: "Datos personales y avatar", username: "Nombre de usuario", golf: "Información de golf", handicap: "Fuente de hándicap", equipment: "Equipo / bastones", ball: "Bola", fitting: "Fitting" };
export function validCompletionChoices(value: unknown): value is CompletionChoices {
 if (!value || typeof value !== "object") return false;
 const v = value as CompletionChoices;
 return [null,"MANUAL","UNKNOWN"].includes(v.handicap_choice) &&
  (v.handicap_choice === "MANUAL" ? typeof v.manual_hcp === "number" && Number.isFinite(v.manual_hcp) && v.manual_hcp >= -10 && v.manual_hcp <= 54 : v.manual_hcp === null) &&
  Array.isArray(v.not_applicable) && v.not_applicable.length <= 4 && v.not_applicable.every(key => ["golf","equipment","ball","fitting"].includes(key));
}
/** v1: seven equal-weight, disjoint sections. Only durable facts count.
 * Explicit N/A is complete; skipped/pending is not. No GHIN, marketing, privacy
 * audience or optional consent is required. Percentage is derived, never stored. */
export function profileCompletion(input: { displayName?: string | null; givenName?: string | null; familyName?: string | null; avatarUrl?: string | null; username?: string | null; handedness?: string | null; homeClub?: string | null; preferredTee?: string | null; indexEnabled: boolean; equipment: EquipmentProfile | null; choices: CompletionChoices }) {
 const { choices, equipment } = input;
 const facts: Record<CompletionSection, boolean> = {
  personal: Boolean(input.displayName?.trim() && input.givenName?.trim() && input.familyName?.trim() && input.avatarUrl?.trim()),
  username: Boolean(input.username?.trim()),
  golf: Boolean(input.handedness && input.homeClub?.trim()),
  handicap: input.indexEnabled || choices.handicap_choice === "UNKNOWN" || (choices.handicap_choice === "MANUAL" && choices.manual_hcp !== null),
  equipment: Boolean(equipment?.clubs.length),
  ball: Boolean(equipment?.balls.some(ball => ball.isCurrent) || equipment?.ballPreference === "NO_FIXED_BALL"),
  fitting: Boolean(equipment?.lastBallFit),
 };
 const sections = COMPLETION_SECTIONS.map(id => ({ id, label: COMPLETION_LABELS[id], complete: facts[id] || choices.not_applicable.includes(id), notApplicable: choices.not_applicable.includes(id) }));
 return { version: 1 as const, percent: Math.round(100 * sections.filter(s => s.complete).length / sections.length), sections };
}
export type ProfileCompletion = ReturnType<typeof profileCompletion>;
