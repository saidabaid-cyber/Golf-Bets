import type { BackyardIndexIneligibilityReason } from "./types";

/** Shared user-facing reasons for Index cards and historical round details. */
export const BACKYARD_INDEX_REASON_LABELS: Record<BackyardIndexIneligibilityReason, string> = {
  INDEX_NOT_ENABLED: "El Índice Backyard no estaba activado al cerrar esta ronda.",
  MISSING_INDEX_SNAPSHOT: "Ronda anterior sin snapshot de Índice Backyard.",
  INVALID_INDEX_SNAPSHOT: "La evidencia guardada ya no valida esta ronda.",
  ROUND_NOT_COMPLETED: "La ronda no está cerrada.",
  INVALID_PLAYED_DATE: "La fecha jugada no es una fecha de calendario válida.",
  PLAYER_NOT_LINKED: "El jugador no está vinculado a tu cuenta.",
  NOT_COMPLETE_18_HOLES: "Sólo se admiten 18 hoyos completos en esta versión.",
  MISSING_COURSE_SNAPSHOT: "Falta el campo congelado de la ronda.",
  MISSING_HOLE_DEFINITIONS: "Faltan par o stroke index válidos para los 18 hoyos.",
  MISSING_HOLE_SCORES: "Faltan scores del jugador.",
  INVALID_HOLE_SCORES: "Hay scores inválidos.",
  MISSING_TEE_ASSIGNMENT: "Falta el tee congelado del jugador.",
  MISSING_OFFICIAL_TEE_RATING: "Falta Rating/Slope verificado del tee.",
  INVALID_OFFICIAL_TEE_RATING: "La evidencia verificada del tee es incompleta.",
  TEE_RATING_MISMATCH: "El Rating/Slope no coincide con el tee jugado.",
  MISSING_COURSE_HANDICAP_FOR_ADJUSTMENT: "Falta Course Handicap congelado para ajustar el score.",
  COURSE_HANDICAP_TEE_MISMATCH: "El Course Handicap no corresponde al tee jugado.",
  MISSING_ADJUSTED_GROSS_SCORE: "No puede calcularse adjusted gross score.",
  MISSING_PCC_EVIDENCE: "PCC desconocido; no se asumió cero.",
  INVALID_PCC_EVIDENCE: "La evidencia o declaración PCC es inválida.",
};
