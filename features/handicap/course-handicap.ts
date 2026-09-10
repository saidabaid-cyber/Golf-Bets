export const COURSE_HANDICAP_FORMULA_VERSION = "WHS-2024-COURSE-HANDICAP-V1" as const;

export type HandicapIndexSource = "BACKYARD_MANUAL" | "BACKYARD_WHS_FUTURE" | "GHIN_OFFICIAL_FUTURE";

export type CourseHandicapInput = {
  playerId: string;
  index: number;
  indexSource: HandicapIndexSource;
  teeId: string;
  teeName: string;
  slope: number;
  courseRating: number;
  par: number;
  effectiveAt: string;
};

export type CourseHandicapSnapshot = CourseHandicapInput & {
  index: number;
  courseHandicap: number;
  formulaVersion: typeof COURSE_HANDICAP_FORMULA_VERSION;
  calculatedAt: string;
};

export function normalizeBackyardHandicap(value: number) {
  if (!Number.isFinite(value)) throw new Error("El HCP debe ser un número válido.");
  return Math.max(-15, Math.min(36, value));
}

function validateCourseHandicapInput(input: CourseHandicapInput) {
  if (!input.playerId || !input.teeId || !input.teeName) throw new Error("Falta jugador o tee para calcular el HCP de juego.");
  if (!Number.isFinite(input.slope) || input.slope < 55 || input.slope > 155) throw new Error("Slope fuera del rango válido.");
  if (!Number.isFinite(input.courseRating) || input.courseRating < 40 || input.courseRating > 100) throw new Error("Course Rating fuera del rango válido.");
  if (!Number.isFinite(input.par) || input.par < 27 || input.par > 90) throw new Error("Par fuera del rango válido.");
}

/** WHS Course Handicap: Index × (Slope / 113) + (Course Rating − Par). */
export function calculateCourseHandicap(input: CourseHandicapInput) {
  validateCourseHandicapInput(input);
  const index = normalizeBackyardHandicap(input.index);
  return Math.round(index * (input.slope / 113) + (input.courseRating - input.par));
}

export function createCourseHandicapSnapshot(input: CourseHandicapInput, calculatedAt: string): CourseHandicapSnapshot {
  const index = normalizeBackyardHandicap(input.index);
  return { ...input, index, courseHandicap: calculateCourseHandicap({ ...input, index }), formulaVersion: COURSE_HANDICAP_FORMULA_VERSION, calculatedAt };
}
