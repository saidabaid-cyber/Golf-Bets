import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKYARD_BALL_FIT_ALGORITHM_VERSION,
  BACKYARD_BALL_FIT_DISCLAIMER,
  BALL_FIT_WEIGHT_CONFIG,
  ballFitDefaultsFromProfile,
  getBallFitInputCompleteness,
  normalizeBallFitInput,
  restoreEquipmentBallFitSummary,
  runBackyardBallFit,
  toEquipmentBallFitSummary,
} from "../lib/ball-fitting";

const CREATED_AT = "2026-09-06T12:00:00.000Z";
const UPDATED_AT = "2026-09-06T12:01:00.000Z";

function catalogBall(overrides: Record<string, unknown> = {}) {
  return {
    id: "control-ball",
    brand: "Verified Brand",
    model: "Control One",
    generation: "2026",
    year: 2026,
    active: true,
    coverMaterial: "Urethane",
    construction: "3-piece",
    compression: null,
    compressionType: "UNKNOWN",
    compressionSource: null,
    compressionSourceUrl: null,
    flight: "MID",
    driverSpin: "LOW",
    ironSpin: "HIGH",
    shortGameSpin: "HIGH",
    feel: "LOW",
    colors: ["White", "Yellow"],
    priceTier: "PREMIUM",
    targetProfile: ["Control"],
    officialUrl: "https://example.com/control-one",
    sourceName: "Official manufacturer site",
    verifiedAt: "2026-09-01",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function catalog() {
  return [
    catalogBall(),
    catalogBall({
      id: "distance-ball",
      model: "Flight Two",
      flight: "HIGH",
      driverSpin: "VERY_LOW",
      ironSpin: "MID",
      shortGameSpin: "MID",
      feel: "MID",
      priceTier: "MID",
      colors: ["White"],
      officialUrl: "https://example.com/flight-two",
    }),
    catalogBall({
      id: "soft-ball",
      model: "Soft Three",
      flight: "LOW",
      driverSpin: "MID",
      ironSpin: "LOW",
      shortGameSpin: "LOW",
      feel: "VERY_LOW",
      priceTier: "ECONOMY",
      colors: ["Yellow"],
      officialUrl: "https://example.com/soft-three",
    }),
    catalogBall({
      id: "fourth-ball",
      model: "Fourth",
      flight: "VERY_HIGH",
      driverSpin: "VERY_HIGH",
      ironSpin: "VERY_LOW",
      shortGameSpin: "VERY_LOW",
      feel: "VERY_HIGH",
      priceTier: "PREMIUM",
      colors: ["Pink"],
      officialUrl: "https://example.com/fourth",
    }),
  ];
}

function completeInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "fit-user",
    currentBallId: "soft-ball",
    handicap: 12.4,
    typicalScore: 86,
    driverDistanceYards: 245,
    swingSpeedBand: "FROM_95_TO_105",
    feelPreference: "SOFT",
    trajectoryPreference: "MID",
    greenFirmness: "FIRM",
    priorities: ["STOP_ON_GREEN", "WEDGE_SPIN", "LESS_DRIVER_SPIN"],
    approachBehavior: "ROLLS_TOO_MUCH",
    wantsGreensideSpin: "YES",
    pricePreference: "PREMIUM",
    colorPreference: "WHITE",
    launchMonitorSession: null,
    ...overrides,
  };
}

test("The Backyard Ball Fit devuelve un grupo Top 3, no una verdad única", () => {
  const result = runBackyardBallFit(catalog(), completeInput());

  assert.equal(result.status, "COMPLETE");
  assert.equal(result.inputCompleteness, 100);
  assert.equal(result.recommendations.length, 3);
  assert.deepEqual(result.recommendations.map((item) => item.rank), [1, 2, 3]);
  assert.equal(result.recommendations[0].catalogBallId, "control-ball");
  assert.equal(result.recommendations[0].matchScore, 98, "el score se limita para no expresar certeza absoluta");
  assert.equal(result.recommendations[0].dataCoverage, 100);
  assert.ok(result.recommendations[0].why.some((reason) => reason.includes("approach") || reason.includes("juego corto")));
  assert.ok(result.recommendations[0].comparisonToCurrent.some((reason) => reason.includes("verificado")));
  assert.equal(result.disclaimer, BACKYARD_BALL_FIT_DISCLAIMER);
  assert.match(result.disclaimer, /orientativa/);
  assert.match(result.disclaimer, /No es un fitting oficial/);
});

test("los pesos son centrales, versionados y la selección prioriza un Top 3 multimarca", () => {
  assert.equal(BACKYARD_BALL_FIT_ALGORITHM_VERSION, "backyard-ball-fit-v2");
  assert.equal(BALL_FIT_WEIGHT_CONFIG.confidence.maximumMatchScore, 98);

  const result = runBackyardBallFit([
    catalogBall({ id: "brand-a-one", brand: "Brand A", model: "One" }),
    catalogBall({ id: "brand-a-two", brand: "Brand A", model: "Two" }),
    catalogBall({ id: "brand-b", brand: "Brand B", model: "Three", feel: "MID" }),
    catalogBall({ id: "brand-c", brand: "Brand C", model: "Four", flight: "HIGH" }),
  ], completeInput());

  assert.equal(result.recommendations.length, 3);
  assert.deepEqual(new Set(result.recommendations.map((item) => item.brand)).size, 3);
  assert.equal(result.recommendations[0].catalogBallId, "brand-a-one");
});

test("HCP bajo y alto sólo ponderan preferencias explícitas y nunca eligen una bola por sí solos", () => {
  const lowHandicap = runBackyardBallFit(catalog(), completeInput({ handicap: 4 }));
  const highHandicap = runBackyardBallFit(catalog(), completeInput({ handicap: 24 }));

  assert.equal(lowHandicap.recommendations[0].catalogBallId, "control-ball");
  assert.equal(highHandicap.recommendations[0].catalogBallId, "control-ball");
  assert.ok(lowHandicap.warnings.some((warning) => warning.includes("nunca determina")));
  assert.ok(highHandicap.warnings.some((warning) => warning.includes("nunca determina")));

  const handicapOnly = runBackyardBallFit(catalog(), { userId: "fit-user", handicap: 24 });
  assert.equal(handicapOnly.status, "INSUFFICIENT_INPUT");
  assert.deepEqual(handicapOnly.recommendations, []);
});

test("el fitting precarga señales conocidas de Mi juego sin fabricar respuestas", () => {
  const defaults = ballFitDefaultsFromProfile({
    typicalScore: 84,
    driverDistanceYards: 252,
    driverSwingSpeedBand: "FROM_95_TO_105",
    usualTrajectory: "MID",
    gamePriority: "SHORT_GAME",
  });
  assert.deepEqual(defaults, {
    typicalScore: 84,
    driverDistanceYards: 252,
    swingSpeedBand: "FROM_95_TO_105",
    trajectoryPreference: "MID",
    priorities: ["WEDGE_SPIN", "GREENSIDE_FEEL"],
  });
  assert.deepEqual(ballFitDefaultsFromProfile({}), {
    typicalScore: null,
    driverDistanceYards: null,
    swingSpeedBand: "UNKNOWN",
    trajectoryPreference: "UNKNOWN",
    priorities: [],
  });
});

test("un fitting corto pero suficiente produce resultado parcial y conserva null sin dato verificado", () => {
  const sparseBall = catalogBall({
    id: "sparse-ball",
    model: "Sparse",
    flight: null,
    driverSpin: null,
    ironSpin: null,
    shortGameSpin: null,
    feel: "LOW",
    priceTier: null,
    colors: [],
  });
  const result = runBackyardBallFit([sparseBall], {
    userId: "fit-user",
    feelPreference: "SOFT",
    trajectoryPreference: "MID",
    priorities: [],
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].attributes.flight, null);
  assert.equal(result.recommendations[0].attributes.driverSpin, null);
  assert.equal(result.recommendations[0].dataCoverage, 50);
  assert.ok(result.recommendations[0].matchScore < 90, "la falta de cobertura reduce la confianza del Match Score");
  assert.ok(result.warnings.some((warning) => warning.includes("sin dato verificado")));
});

test("un fitting incompleto no fabrica recomendaciones con una sola señal", () => {
  const normalized = normalizeBallFitInput({ userId: "fit-user", priorities: ["DRIVER_DISTANCE"] });
  assert.ok(normalized);
  assert.equal(normalized.handicap, null);
  assert.equal(normalized.swingSpeedBand, "UNKNOWN");
  assert.equal(normalized.feelPreference, "ANY");

  const result = runBackyardBallFit(catalog(), normalized);
  assert.equal(result.status, "INSUFFICIENT_INPUT");
  assert.deepEqual(result.recommendations, []);
  assert.ok(result.warnings[0].includes("al menos dos"));
});

test("la completitud diferencia contexto capturado de preferencias omitidas", () => {
  assert.equal(getBallFitInputCompleteness(completeInput()), 100);
  assert.equal(getBallFitInputCompleteness({ userId: "fit-user" }), 0);
  assert.equal(getBallFitInputCompleteness({
    userId: "fit-user",
    handicap: 18,
    typicalScore: 95,
    feelPreference: "MEDIUM",
    priorities: ["IRON_CONTROL"],
  }), 25, "HCP y score típico cuentan como una sola respuesta de perfil");
});

test("registros inactivos o sin procedencia verificable jamás entran al Top 3", () => {
  const result = runBackyardBallFit([
    catalogBall({ id: "archived", active: false }),
    catalogBall({ id: "missing-source", sourceName: null }),
  ], completeInput());

  assert.equal(result.status, "NO_VERIFIED_MATCHES");
  assert.deepEqual(result.recommendations, []);
  assert.ok(result.warnings[0].includes("fuente y fecha de verificación"));
});

test("atributos no confirmados, incluida compresión, no se estiman por HCP o velocidad", () => {
  const unknownTechnical = catalogBall({
    compression: null,
    flight: null,
    driverSpin: null,
    ironSpin: "HIGH",
    shortGameSpin: "HIGH",
    feel: "LOW",
  });
  const result = runBackyardBallFit([unknownTechnical], completeInput());

  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].attributes.flight, null);
  assert.equal(result.recommendations[0].attributes.driverSpin, null);
  assert.ok(result.warnings.some((warning) => warning.includes("no se usan para inventar compresión")));
});

test("una bola histórica inactiva puede ser referencia, pero nunca candidata nueva", () => {
  const currentArchived = catalogBall({
    id: "old-current",
    model: "Generación anterior",
    active: false,
    ironSpin: "LOW",
    shortGameSpin: "LOW",
  });
  const result = runBackyardBallFit([currentArchived, ...catalog()], completeInput({ currentBallId: "old-current" }));

  assert.equal(result.recommendations.some((item) => item.catalogBallId === "old-current"), false);
  assert.ok(result.recommendations[0].comparisonToCurrent.some((comparison) => comparison.includes("verificado")));
});

test("el resumen guardable permite persistir y regresar al último Ball Fit", () => {
  const input = completeInput({ currentBallId: "soft-ball" });
  const result = runBackyardBallFit(catalog(), input);
  const summary = toEquipmentBallFitSummary(result, "fit-2026-09", "2026-09-06T13:00:00.000Z", input);

  assert.ok(summary);
  assert.equal(summary.recommendations.length, 3);
  assert.equal(summary.recommendations[0].catalogBallId, "control-ball");
  assert.equal(summary.currentBallId, "soft-ball");
  assert.equal(summary.inputCompleteness, 100);
  assert.equal(summary.input?.swingSpeedBand, "FROM_95_TO_105");
  assert.equal(summary.recommendations[0].why.length > 0, true);
  const restored = restoreEquipmentBallFitSummary(summary);
  assert.ok(restored);
  assert.deepEqual(restored.result.recommendations, result.recommendations);

  const incompleteInput = normalizeBallFitInput({ userId: "fit-user" });
  assert.ok(incompleteInput);
  const incomplete = runBackyardBallFit(catalog(), incompleteInput);
  assert.equal(toEquipmentBallFitSummary(incomplete, "empty", "2026-09-06T13:00:00.000Z", incompleteInput), null);
});

test("los datos de launch monitor excluyen golpes malos y viajan como contexto resistente", () => {
  const result = runBackyardBallFit(catalog(), completeInput({
    launchMonitorSession: {
      id: "launch-1",
      userId: "fit-user",
      source: "Equipo del jugador",
      startedAt: CREATED_AT,
      completedAt: UPDATED_AT,
      shots: [
        { id: "one", club: "DRIVER", excluded: false, clubSpeedMph: 100, ballSpeedMph: 148, spinRpm: 2400, carryYards: 245 },
        { id: "two", club: "DRIVER", excluded: false, clubSpeedMph: 101, ballSpeedMph: 149, spinRpm: 2450, carryYards: 247 },
        { id: "three", club: "DRIVER", excluded: false, clubSpeedMph: 99, ballSpeedMph: 147, spinRpm: 2350, carryYards: 243 },
        { id: "mishit", club: "DRIVER", excluded: true, clubSpeedMph: 60, ballSpeedMph: 70, spinRpm: 9000, carryYards: 80 },
      ],
    },
  }));

  assert.ok(result.launchMonitorSummary);
  assert.equal(result.launchMonitorSummary.includedShots, 3);
  assert.equal(result.launchMonitorSummary.excludedShots, 1);
  assert.equal(result.launchMonitorSummary.byClub[0].metrics.spinRpm?.median, 2400);
  assert.equal(result.launchMonitorSummary.byClub[0].metrics.carryYards?.resistantAverage, 245);
  assert.ok(result.warnings.some((warning) => warning.includes("medianas")));
  assert.ok(result.warnings.some((warning) => warning.includes("no se aplican ventanas propietarias")));
});

test("prioridades repetidas se deduplican y el orden permanece significativo", () => {
  const input = normalizeBallFitInput(completeInput({
    priorities: ["WEDGE_SPIN", "WEDGE_SPIN", "STOP_ON_GREEN", "invalid"],
  }));
  assert.ok(input);
  assert.deepEqual(input.priorities, ["WEDGE_SPIN", "STOP_ON_GREEN"]);

  const first = runBackyardBallFit(catalog(), input);
  const second = runBackyardBallFit(catalog(), input);
  assert.deepEqual(first, second, "el algoritmo puro es determinista para catálogo e input iguales");
});

test("una preferencia direccional favorece menos spin sin castigar valores aún más bajos", () => {
  const lowSpin = catalogBall({ id: "low-spin", model: "Low", driverSpin: "VERY_LOW" });
  const highSpin = catalogBall({ id: "high-spin", model: "High", driverSpin: "VERY_HIGH" });
  const result = runBackyardBallFit([highSpin, lowSpin], {
    userId: "fit-user",
    trajectoryPreference: "MID",
    priorities: ["LESS_DRIVER_SPIN"],
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.recommendations[0].catalogBallId, "low-spin");
  const low = result.recommendations.find((item) => item.catalogBallId === "low-spin");
  const high = result.recommendations.find((item) => item.catalogBallId === "high-spin");
  assert.ok(low && high);
  assert.ok(low.matchScore > high.matchScore);
});
