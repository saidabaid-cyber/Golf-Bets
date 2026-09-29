import type { EquipmentProfile } from "./golf-equipment";
export const COMPLETION_SECTIONS = ["personal", "username", "golf", "handicap", "equipment", "ball", "fitting"] as const;
export const REQUIRED_COMPLETION_SECTIONS = ["personal", "username", "golf", "handicap", "equipment", "ball"] as const;
export type CompletionSection = typeof COMPLETION_SECTIONS[number];
export type CompletionChoices = { handicap_choice: "MANUAL" | "UNKNOWN" | null; manual_hcp: number | null; not_applicable: string[] };
export const EMPTY_COMPLETION_CHOICES: CompletionChoices = { handicap_choice: null, manual_hcp: null, not_applicable: [] };
export const COMPLETION_LABELS: Record<CompletionSection, string> = { personal: "Datos personales", username: "Nombre de usuario", golf: "Información de golf", handicap: "Fuente de handicap", equipment: "Equipo", ball: "Bola", fitting: "Fitting" };
export function validCompletionChoices(value: unknown): value is CompletionChoices {
 if (!value || typeof value !== "object") return false;
 const v = value as CompletionChoices;
 return [null,"MANUAL","UNKNOWN"].includes(v.handicap_choice) &&
  (v.handicap_choice === "MANUAL" ? typeof v.manual_hcp === "number" && Number.isFinite(v.manual_hcp) && v.manual_hcp >= -10 && v.manual_hcp <= 54 : v.manual_hcp === null) &&
  Array.isArray(v.not_applicable) && v.not_applicable.length <= 4 && v.not_applicable.every(key => ["golf","equipment","ball","fitting"].includes(key));
}
/** Required profile facts determine the percentage. Fitting remains visible as
 * an optional enhancement but can never prevent a complete profile. Legacy
 * `not_applicable` values remain readable for schema compatibility and are no
 * longer product controls or completion shortcuts. */
export function profileCompletion(input: { displayName?: string | null; givenName?: string | null; familyName?: string | null; avatarUrl?: string | null; username?: string | null; handedness?: string | null; homeClub?: string | null; preferredTee?: string | null; indexEnabled: boolean; indexResolution?: "GHIN" | "BACKYARD" | "NONE" | null; indexValue?: number | null; equipment: EquipmentProfile | null; choices: CompletionChoices }) {
 const { choices, equipment } = input;
 const facts: Record<CompletionSection, boolean> = {
  personal: Boolean(input.displayName?.trim() && input.givenName?.trim() && input.familyName?.trim() && input.avatarUrl?.trim()),
  username: Boolean(input.username?.trim()),
  golf: Boolean(input.handedness && input.homeClub?.trim()),
  handicap: input.indexEnabled || Boolean(input.indexResolution) || choices.handicap_choice === "UNKNOWN" || (choices.handicap_choice === "MANUAL" && choices.manual_hcp !== null),
  equipment: Boolean(equipment?.clubs.length),
  ball: Boolean(equipment?.balls.some(ball => ball.isCurrent) || equipment?.ballPreference === "NO_FIXED_BALL"),
  fitting: Boolean(equipment?.lastBallFit),
 };
 const handicapStatus = input.indexResolution === "GHIN" ? `GHIN${typeof input.indexValue === "number" && Number.isFinite(input.indexValue) ? ` · ${input.indexValue.toLocaleString("es-MX", { maximumFractionDigits: 1 })}` : " vinculado"}`
  : input.indexResolution === "BACKYARD" || input.indexEnabled ? "Backyard Index activado"
  : input.indexResolution === "NONE" || choices.handicap_choice === "UNKNOWN" ? "Sin índice por ahora"
  : choices.handicap_choice === "MANUAL" ? "HCP manual guardado" : "Falta elegir una fuente";
 const sections = COMPLETION_SECTIONS.map(id => {
  const optional = id === "fitting";
  const complete = facts[id];
  const status = id === "handicap" ? handicapStatus : complete ? "Completo" : optional ? "Opcional" : "Falta completar";
  return { id, label: COMPLETION_LABELS[id], complete, optional, status };
 });
 const required = sections.filter(section => !section.optional);
 return { version: 2 as const, percent: Math.round(100 * required.filter(section => section.complete).length / REQUIRED_COMPLETION_SECTIONS.length), sections };
}
export type ProfileCompletion = ReturnType<typeof profileCompletion>;
