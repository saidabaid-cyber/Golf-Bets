import {
  BALL_PRICE_TIERS,
  QUALITATIVE_LEVELS,
  normalizeGolfBallCatalog,
  normalizeLaunchMonitorSession,
  summarizeLaunchMonitorSession,
  type BallPriceTier,
  type EquipmentBallFitSummary,
  type GolfBallCatalog,
  type LaunchMonitorSession,
  type LaunchMonitorSummary,
  type QualitativeLevel,
} from "./golf-equipment";

export const BACKYARD_BALL_FIT_DISCLAIMER =
  "The Backyard Ball Fit es una recomendación orientativa basada en tus preferencias y en datos públicos verificados. No es un fitting oficial de ningún fabricante ni sustituye una prueba profesional.";
export const BACKYARD_BALL_FIT_ALGORITHM_VERSION = "backyard-ball-fit-v1";

export const SWING_SPEED_BANDS = ["UNDER_85", "FROM_85_TO_95", "FROM_95_TO_105", "OVER_105", "UNKNOWN"] as const;
export type SwingSpeedBand = (typeof SWING_SPEED_BANDS)[number];

export const BALL_FEEL_PREFERENCES = ["VERY_SOFT", "SOFT", "MEDIUM", "FIRM", "VERY_FIRM", "ANY"] as const;
export type BallFeelPreference = (typeof BALL_FEEL_PREFERENCES)[number];

export const BALL_TRAJECTORY_PREFERENCES = ["LOW", "MID", "HIGH", "UNKNOWN"] as const;
export type BallTrajectoryPreference = (typeof BALL_TRAJECTORY_PREFERENCES)[number];

export const GREEN_FIRMNESS_OPTIONS = ["SOFT", "MEDIUM", "FIRM", "VARIES_UNKNOWN"] as const;
export type GreenFirmness = (typeof GREEN_FIRMNESS_OPTIONS)[number];

export const BALL_FIT_PRIORITIES = [
  "DRIVER_DISTANCE",
  "LESS_DRIVER_SPIN",
  "STABILITY_CONTROL",
  "HEIGHT",
  "IRON_CONTROL",
  "STOP_ON_GREEN",
  "WEDGE_SPIN",
  "GREENSIDE_FEEL",
  "PUTTER_FEEL",
] as const;
export type BallFitPriority = (typeof BALL_FIT_PRIORITIES)[number];

export const APPROACH_BEHAVIORS = ["ROLLS_TOO_MUCH", "STOPS_WELL", "TOO_MUCH_BACKSPIN", "UNKNOWN"] as const;
export type ApproachBehavior = (typeof APPROACH_BEHAVIORS)[number];

export const YES_NO_UNKNOWN = ["YES", "NO", "UNKNOWN"] as const;
export type YesNoUnknown = (typeof YES_NO_UNKNOWN)[number];

export const BALL_FIT_PRICE_PREFERENCES = ["BEST_FIT", "PREMIUM", "MID", "ECONOMY"] as const;
export type BallFitPricePreference = (typeof BALL_FIT_PRICE_PREFERENCES)[number];

export const BALL_COLOR_PREFERENCES = ["WHITE", "YELLOW", "OTHER", "ANY"] as const;
export type BallColorPreference = (typeof BALL_COLOR_PREFERENCES)[number];

export type BallFitInput = {
  userId: string;
  currentBallId: string | null;
  handicap: number | null;
  typicalScore: number | null;
  driverDistanceYards: number | null;
  swingSpeedBand: SwingSpeedBand;
  feelPreference: BallFeelPreference;
  trajectoryPreference: BallTrajectoryPreference;
  greenFirmness: GreenFirmness;
  priorities: BallFitPriority[];
  approachBehavior: ApproachBehavior;
  wantsGreensideSpin: YesNoUnknown;
  pricePreference: BallFitPricePreference;
  colorPreference: BallColorPreference;
  launchMonitorSession: LaunchMonitorSession | null;
};

export type BallFitVerifiedAttributes = {
  flight: QualitativeLevel | null;
  feel: QualitativeLevel | null;
  driverSpin: QualitativeLevel | null;
  ironSpin: QualitativeLevel | null;
  shortGameSpin: QualitativeLevel | null;
  priceTier: BallPriceTier | null;
};

export type BallFitRecommendation = {
  rank: 1 | 2 | 3;
  catalogBallId: string;
  brand: string;
  model: string;
  generation: string | null;
  matchScore: number;
  dataCoverage: number;
  why: string[];
  attributes: BallFitVerifiedAttributes;
  comparisonToCurrent: string[];
};

export type BallFitStatus = "COMPLETE" | "PARTIAL" | "INSUFFICIENT_INPUT" | "NO_VERIFIED_MATCHES";

export type BallFitResult = {
  status: BallFitStatus;
  inputCompleteness: number;
  recommendations: BallFitRecommendation[];
  warnings: string[];
  disclaimer: typeof BACKYARD_BALL_FIT_DISCLAIMER;
  launchMonitorSummary: LaunchMonitorSummary | null;
};

type UnknownRecord = Record<string, unknown>;
type ScoredAttribute = "flight" | "feel" | "driverSpin" | "ironSpin" | "shortGameSpin";
type CriterionMode = "EXACT" | "AT_LEAST" | "AT_MOST";
type Criterion = {
  attribute: ScoredAttribute;
  target: QualitativeLevel;
  mode: CriterionMode;
  weight: number;
  reason: string;
};

const LEVEL_INDEX = new Map<QualitativeLevel, number>(QUALITATIVE_LEVELS.map((value, index) => [value, index]));
const FEEL_TARGETS: Record<Exclude<BallFeelPreference, "ANY">, QualitativeLevel> = {
  VERY_SOFT: "VERY_LOW",
  SOFT: "LOW",
  MEDIUM: "MID",
  FIRM: "HIGH",
  VERY_FIRM: "VERY_HIGH",
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, 240) : null;
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function memberOf<const T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function uniquePriorities(value: unknown): BallFitPriority[] {
  if (!Array.isArray(value)) return [];
  const result: BallFitPriority[] = [];
  for (const priority of value) {
    if (!(BALL_FIT_PRIORITIES as readonly unknown[]).includes(priority) || result.includes(priority as BallFitPriority)) continue;
    result.push(priority as BallFitPriority);
  }
  return result;
}

export function normalizeBallFitInput(value: unknown): BallFitInput | null {
  const source = record(value);
  const userId = source ? text(source.userId) : null;
  if (!source || !userId) return null;
  return {
    userId,
    currentBallId: text(source.currentBallId),
    handicap: finiteNumber(source.handicap, -20, 54),
    typicalScore: finiteNumber(source.typicalScore, 40, 200),
    driverDistanceYards: finiteNumber(source.driverDistanceYards, 50, 500),
    swingSpeedBand: memberOf(source.swingSpeedBand, SWING_SPEED_BANDS, "UNKNOWN"),
    feelPreference: memberOf(source.feelPreference, BALL_FEEL_PREFERENCES, "ANY"),
    trajectoryPreference: memberOf(source.trajectoryPreference, BALL_TRAJECTORY_PREFERENCES, "UNKNOWN"),
    greenFirmness: memberOf(source.greenFirmness, GREEN_FIRMNESS_OPTIONS, "VARIES_UNKNOWN"),
    priorities: uniquePriorities(source.priorities),
    approachBehavior: memberOf(source.approachBehavior, APPROACH_BEHAVIORS, "UNKNOWN"),
    wantsGreensideSpin: memberOf(source.wantsGreensideSpin, YES_NO_UNKNOWN, "UNKNOWN"),
    pricePreference: memberOf(source.pricePreference, BALL_FIT_PRICE_PREFERENCES, "BEST_FIT"),
    colorPreference: memberOf(source.colorPreference, BALL_COLOR_PREFERENCES, "ANY"),
    launchMonitorSession: normalizeLaunchMonitorSession(source.launchMonitorSession, userId),
  };
}

function inputAnswers(input: BallFitInput): boolean[] {
  return [
    input.currentBallId !== null,
    input.handicap !== null || input.typicalScore !== null,
    input.driverDistanceYards !== null,
    input.swingSpeedBand !== "UNKNOWN",
    input.feelPreference !== "ANY",
    input.trajectoryPreference !== "UNKNOWN",
    input.greenFirmness !== "VARIES_UNKNOWN",
    input.priorities.length > 0,
    input.approachBehavior !== "UNKNOWN",
    input.wantsGreensideSpin !== "UNKNOWN",
    input.pricePreference !== "BEST_FIT",
    input.colorPreference !== "ANY",
  ];
}

export function getBallFitInputCompleteness(inputValue: unknown): number {
  const input = normalizeBallFitInput(inputValue);
  if (!input) return 0;
  const answers = inputAnswers(input);
  return Math.round(answers.filter(Boolean).length / answers.length * 100);
}

function addCriterion(criteria: Criterion[], criterion: Criterion) {
  const existing = criteria.find((item) => item.attribute === criterion.attribute && item.target === criterion.target && item.mode === criterion.mode);
  if (existing) existing.weight += criterion.weight;
  else criteria.push(criterion);
}

function criteriaFor(input: BallFitInput): Criterion[] {
  const criteria: Criterion[] = [];
  if (input.feelPreference !== "ANY") {
    addCriterion(criteria, {
      attribute: "feel",
      target: FEEL_TARGETS[input.feelPreference],
      mode: "EXACT",
      weight: 5,
      reason: "El feel verificado se acerca a la sensación que prefieres.",
    });
  }
  if (input.trajectoryPreference !== "UNKNOWN") {
    addCriterion(criteria, {
      attribute: "flight",
      target: input.trajectoryPreference,
      mode: "EXACT",
      weight: 5,
      reason: "El vuelo verificado coincide con la trayectoria que buscas.",
    });
  }
  if (input.approachBehavior === "ROLLS_TOO_MUCH") {
    addCriterion(criteria, { attribute: "ironSpin", target: "HIGH", mode: "AT_LEAST", weight: 5, reason: "Su spin de hierros verificado favorece tu prioridad de detener mejor el approach." });
  } else if (input.approachBehavior === "TOO_MUCH_BACKSPIN") {
    addCriterion(criteria, { attribute: "ironSpin", target: "LOW", mode: "AT_MOST", weight: 5, reason: "Su perfil de spin de hierros se acerca a tu búsqueda de reducir backspin." });
  }
  if (input.wantsGreensideSpin === "YES") {
    addCriterion(criteria, { attribute: "shortGameSpin", target: "HIGH", mode: "AT_LEAST", weight: 5, reason: "El spin de juego corto verificado acompaña tu búsqueda de mayor control alrededor del green." });
  } else if (input.wantsGreensideSpin === "NO") {
    addCriterion(criteria, { attribute: "shortGameSpin", target: "LOW", mode: "AT_MOST", weight: 4, reason: "El spin de juego corto verificado se acerca a tu preferencia de una respuesta menos activa." });
  }
  if (input.greenFirmness === "FIRM") {
    addCriterion(criteria, { attribute: "shortGameSpin", target: "HIGH", mode: "AT_LEAST", weight: 2, reason: "El perfil de juego corto puede ajustarse mejor a los greens firmes que juegas." });
  }

  input.priorities.forEach((priority, index) => {
    const weight = Math.max(2, 5 - index * 0.5);
    if (priority === "LESS_DRIVER_SPIN") {
      addCriterion(criteria, { attribute: "driverSpin", target: "LOW", mode: "AT_MOST", weight, reason: "El spin de driver verificado se acerca a tu prioridad de reducir spin en el juego largo." });
    } else if (priority === "HEIGHT") {
      addCriterion(criteria, { attribute: "flight", target: "HIGH", mode: "AT_LEAST", weight, reason: "El vuelo verificado acompaña tu prioridad de ganar altura." });
    } else if (priority === "IRON_CONTROL" || priority === "STOP_ON_GREEN") {
      addCriterion(criteria, { attribute: "ironSpin", target: "HIGH", mode: "AT_LEAST", weight, reason: "El spin de hierros verificado acompaña tu prioridad de control en approach." });
    } else if (priority === "WEDGE_SPIN") {
      addCriterion(criteria, { attribute: "shortGameSpin", target: "HIGH", mode: "AT_LEAST", weight, reason: "El spin de juego corto verificado coincide con tu prioridad de wedges." });
    } else if ((priority === "GREENSIDE_FEEL" || priority === "PUTTER_FEEL") && input.feelPreference !== "ANY") {
      addCriterion(criteria, { attribute: "feel", target: FEEL_TARGETS[input.feelPreference], mode: "EXACT", weight, reason: "La sensación verificada se acerca a tu prioridad alrededor del green y con el putter." });
    }
  });
  return criteria;
}

function similarity(actual: QualitativeLevel, target: QualitativeLevel, mode: CriterionMode): number {
  const actualIndex = LEVEL_INDEX.get(actual) ?? 2;
  const targetIndex = LEVEL_INDEX.get(target) ?? 2;
  if ((mode === "AT_LEAST" && actualIndex >= targetIndex) || (mode === "AT_MOST" && actualIndex <= targetIndex)) return 1;
  const difference = Math.abs(actualIndex - targetIndex);
  return [1, 0.72, 0.35, 0.12, 0][difference] ?? 0;
}

function priceSimilarity(actual: BallPriceTier | null, preference: BallFitPricePreference): number | null {
  if (preference === "BEST_FIT" || actual === null) return null;
  if (preference === actual) return 1;
  const order: BallPriceTier[] = [...BALL_PRICE_TIERS];
  return Math.abs(order.indexOf(actual) - order.indexOf(preference)) === 1 ? 0.35 : 0;
}

function colorSimilarity(colors: readonly string[], preference: BallColorPreference): number | null {
  if (preference === "ANY" || colors.length === 0) return null;
  const normalized = colors.map((color) => color.toLocaleLowerCase("es-MX"));
  if (preference === "WHITE") return normalized.some((color) => color.includes("white") || color.includes("blanco")) ? 1 : 0;
  if (preference === "YELLOW") return normalized.some((color) => color.includes("yellow") || color.includes("amarillo")) ? 1 : 0;
  return normalized.some((color) => !color.includes("white") && !color.includes("blanco") && !color.includes("yellow") && !color.includes("amarillo")) ? 1 : 0;
}

function verifiedAttributes(ball: GolfBallCatalog): BallFitVerifiedAttributes {
  return {
    flight: ball.flight,
    feel: ball.feel,
    driverSpin: ball.driverSpin,
    ironSpin: ball.ironSpin,
    shortGameSpin: ball.shortGameSpin,
    priceTier: ball.priceTier,
  };
}

function attributeFit(value: QualitativeLevel, criteria: readonly Criterion[]): number | null {
  if (!criteria.length) return null;
  const weight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  return criteria.reduce((sum, criterion) => sum + similarity(value, criterion.target, criterion.mode) * criterion.weight, 0) / weight;
}

const COMPARISON_LABELS: Record<ScoredAttribute, string> = {
  flight: "vuelo",
  feel: "sensación",
  driverSpin: "spin de driver",
  ironSpin: "spin de hierros",
  shortGameSpin: "spin de juego corto",
};

function compareToCurrent(ball: GolfBallCatalog, current: GolfBallCatalog | null, criteria: readonly Criterion[]): string[] {
  if (!current) return ["Sin comparación: la bola actual no tiene datos verificados suficientes en este catálogo."];
  const comparisons: string[] = [];
  for (const attribute of ["flight", "feel", "driverSpin", "ironSpin", "shortGameSpin"] as const) {
    const recommended = ball[attribute];
    const prior = current[attribute];
    const attributeCriteria = criteria.filter((criterion) => criterion.attribute === attribute);
    if (!recommended || !prior || attributeCriteria.length === 0) continue;
    const recommendedFit = attributeFit(recommended, attributeCriteria);
    const priorFit = attributeFit(prior, attributeCriteria);
    if (recommendedFit !== null && priorFit !== null && recommendedFit > priorFit + 0.01) {
      comparisons.push(`Su ${COMPARISON_LABELS[attribute]} verificado está más cerca de la dirección que buscas que el de tu bola actual.`);
    }
  }
  return comparisons.length > 0
    ? comparisons.slice(0, 3)
    : ["No hay una mejora comparativa verificable con los datos disponibles; conviene probar ambas bolas en campo."];
}

type CandidateScore = {
  ball: GolfBallCatalog;
  score: number;
  coverage: number;
  reasons: string[];
};

function scoreBall(ball: GolfBallCatalog, input: BallFitInput, criteria: readonly Criterion[]): CandidateScore | null {
  let intendedWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  let knownWeight = 0;
  let matchedWeight = 0;
  const reasons: Array<{ text: string; strength: number }> = [];

  for (const criterion of criteria) {
    const actual = ball[criterion.attribute];
    if (!actual) continue;
    knownWeight += criterion.weight;
    const strength = similarity(actual, criterion.target, criterion.mode);
    matchedWeight += strength * criterion.weight;
    if (strength >= 0.7) reasons.push({ text: criterion.reason, strength: strength * criterion.weight });
  }

  if (input.pricePreference !== "BEST_FIT") {
    intendedWeight += 3;
    const match = priceSimilarity(ball.priceTier, input.pricePreference);
    if (match !== null) {
      knownWeight += 3;
      matchedWeight += match * 3;
      if (match === 1) reasons.push({ text: "Está dentro de la categoría de precio que elegiste.", strength: 3 });
    }
  }

  if (input.colorPreference !== "ANY") {
    intendedWeight += 1;
    const match = colorSimilarity(ball.colors, input.colorPreference);
    if (match !== null) {
      knownWeight += 1;
      matchedWeight += match;
      if (match === 1) reasons.push({ text: "Está disponible en el color que prefieres según el catálogo verificado.", strength: 1 });
    }
  }

  if (intendedWeight === 0 || knownWeight === 0) return null;
  const coverage = knownWeight / intendedWeight;
  const quality = matchedWeight / knownWeight;
  // Match score is confidence-adjusted: perfect affinity on half the requested
  // verified data cannot look like a 90% conclusion.
  const score = Math.min(98, Math.max(1, Math.round(quality * (0.5 + coverage * 0.5) * 100)));
  const uniqueReasons = [...new Map(reasons.sort((left, right) => right.strength - left.strength).map((reason) => [reason.text, reason.text])).values()];
  return { ball, score, coverage: Math.round(coverage * 100), reasons: uniqueReasons.slice(0, 4) };
}

function comparableSignalCount(input: BallFitInput, criteria: readonly Criterion[]): number {
  void input;
  return new Set(criteria.map((criterion) => criterion.attribute)).size;
}

export function runBackyardBallFit(catalogValues: readonly unknown[], inputValue: unknown): BallFitResult {
  const input = normalizeBallFitInput(inputValue);
  const disclaimer = BACKYARD_BALL_FIT_DISCLAIMER;
  if (!input) {
    return {
      status: "INSUFFICIENT_INPUT",
      inputCompleteness: 0,
      recommendations: [],
      warnings: ["Completa al menos tu identidad de perfil para guardar el fitting."],
      disclaimer,
      launchMonitorSummary: null,
    };
  }
  const completeness = getBallFitInputCompleteness(input);
  const launchMonitorSummary = input.launchMonitorSession ? summarizeLaunchMonitorSession(input.launchMonitorSession) : null;
  const criteria = criteriaFor(input);
  if (comparableSignalCount(input, criteria) < 2) {
    return {
      status: "INSUFFICIENT_INPUT",
      inputCompleteness: completeness,
      recommendations: [],
      warnings: ["Elige al menos dos preferencias de desempeño verificables (feel, vuelo o spin) para comparar bolas con criterio."],
      disclaimer,
      launchMonitorSummary,
    };
  }

  const normalized = catalogValues.map(normalizeGolfBallCatalog);
  const verifiedBalls = normalized.filter((ball): ball is GolfBallCatalog => ball !== null);
  const balls = verifiedBalls.filter((ball) => ball.active);
  if (balls.length === 0) {
    return {
      status: "NO_VERIFIED_MATCHES",
      inputCompleteness: completeness,
      recommendations: [],
      warnings: ["No hay bolas activas con una fuente y fecha de verificación válidas."],
      disclaimer,
      launchMonitorSummary,
    };
  }

  const current = input.currentBallId ? verifiedBalls.find((ball) => ball.id === input.currentBallId) ?? null : null;
  const candidates = balls
    .map((ball) => scoreBall(ball, input, criteria))
    .filter((candidate): candidate is CandidateScore => candidate !== null)
    .sort((left, right) => right.score - left.score
      || right.coverage - left.coverage
      || left.ball.brand.localeCompare(right.ball.brand)
      || left.ball.model.localeCompare(right.ball.model));

  if (candidates.length === 0) {
    return {
      status: "NO_VERIFIED_MATCHES",
      inputCompleteness: completeness,
      recommendations: [],
      warnings: ["Las bolas activas no tienen atributos verificados comparables con tus prioridades."],
      disclaimer,
      launchMonitorSummary,
    };
  }

  const recommendations = candidates.slice(0, 3).map((candidate, index): BallFitRecommendation => ({
    rank: (index + 1) as 1 | 2 | 3,
    catalogBallId: candidate.ball.id,
    brand: candidate.ball.brand,
    model: candidate.ball.model,
    generation: candidate.ball.generation,
    matchScore: candidate.score,
    dataCoverage: candidate.coverage,
    why: candidate.reasons.length > 0
      ? candidate.reasons
      : ["Es una coincidencia parcial; prueba la bola en campo antes de decidir."],
    attributes: verifiedAttributes(candidate.ball),
    comparisonToCurrent: compareToCurrent(candidate.ball, current, criteria),
  }));
  const warnings: string[] = [];
  const rejected = normalized.filter((ball) => ball === null).length;
  if (rejected > 0) warnings.push(`${rejected} registro(s) sin fuente o formato verificable fueron excluidos.`);
  if (recommendations.some((recommendation) => recommendation.dataCoverage < 70)) {
    warnings.push("Algunas coincidencias tienen atributos sin dato verificado; revisa la cobertura antes de comparar.");
  }
  if (launchMonitorSummary) {
    warnings.push("Los golpes del launch monitor se resumen con medianas y promedios resistentes; todavía no se aplican ventanas propietarias de ningún fabricante.");
  }
  if (input.swingSpeedBand !== "UNKNOWN" || input.driverDistanceYards !== null) {
    warnings.push("La velocidad y distancia de driver aportan contexto, pero no se usan para inventar compresión ni para imponer una bola por sí solas.");
  }
  const contextualPriorities = input.priorities.filter((priority) => priority === "DRIVER_DISTANCE" || priority === "STABILITY_CONTROL");
  if (contextualPriorities.length > 0) {
    warnings.push("Distancia y estabilidad quedan como contexto: sólo se puntúan cuando existe un atributo comparable y verificado, sin inferir rendimiento de laboratorio.");
  }

  return {
    status: completeness >= 75 ? "COMPLETE" : "PARTIAL",
    inputCompleteness: completeness,
    recommendations,
    warnings,
    disclaimer,
    launchMonitorSummary,
  };
}

export function toEquipmentBallFitSummary(
  result: BallFitResult,
  idValue: string,
  completedAtValue: string,
  inputValue: unknown,
): EquipmentBallFitSummary | null {
  const id = text(idValue);
  const completedAt = text(completedAtValue);
  const input = normalizeBallFitInput(inputValue);
  if (!id || !completedAt || Number.isNaN(Date.parse(completedAt)) || !input || result.recommendations.length === 0) return null;
  return {
    id,
    completedAt,
    currentBallId: input.currentBallId,
    inputCompleteness: result.inputCompleteness,
    algorithmVersion: BACKYARD_BALL_FIT_ALGORITHM_VERSION,
    status: result.status === "COMPLETE" ? "COMPLETE" : "PARTIAL",
    input,
    recommendations: result.recommendations.map((recommendation) => ({
      catalogBallId: recommendation.catalogBallId,
      matchScore: recommendation.matchScore,
      brand: recommendation.brand,
      model: recommendation.model,
      generation: recommendation.generation,
      dataCoverage: recommendation.dataCoverage,
      why: recommendation.why,
      attributes: recommendation.attributes,
      comparisonToCurrent: recommendation.comparisonToCurrent,
    })),
    warnings: result.warnings,
  };
}

export function restoreEquipmentBallFitSummary(summary: EquipmentBallFitSummary | null): { input: BallFitInput; result: BallFitResult } | null {
  if (!summary?.input || !summary.status || !summary.algorithmVersion) return null;
  const input = normalizeBallFitInput(summary.input);
  if (!input) return null;
  const recommendations = summary.recommendations.flatMap((recommendation, index): BallFitRecommendation[] => {
    if (!recommendation.brand || !recommendation.model || recommendation.dataCoverage === null || !recommendation.attributes) return [];
    return [{
      rank: (index + 1) as 1 | 2 | 3,
      catalogBallId: recommendation.catalogBallId,
      brand: recommendation.brand,
      model: recommendation.model,
      generation: recommendation.generation,
      matchScore: recommendation.matchScore,
      dataCoverage: recommendation.dataCoverage,
      why: recommendation.why,
      attributes: recommendation.attributes,
      comparisonToCurrent: recommendation.comparisonToCurrent,
    }];
  });
  if (recommendations.length !== summary.recommendations.length || recommendations.length === 0) return null;
  return {
    input,
    result: {
      status: summary.status,
      inputCompleteness: summary.inputCompleteness,
      recommendations,
      warnings: summary.warnings,
      disclaimer: BACKYARD_BALL_FIT_DISCLAIMER,
      launchMonitorSummary: input.launchMonitorSession ? summarizeLaunchMonitorSession(input.launchMonitorSession) : null,
    },
  };
}
