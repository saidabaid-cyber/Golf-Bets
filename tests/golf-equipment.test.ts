import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB,
  createEmptyEquipmentProfile,
  decodeEquipmentProfile,
  encodeEquipmentProfile,
  equipmentProfileFingerprint,
  equipmentProfileStorageKey,
  getLaunchMonitorProtocolProgress,
  loadEquipmentProfile,
  median,
  normalizeEquipmentProfile,
  normalizeEquipmentProfileStrict,
  normalizeGolfBallCatalog,
  normalizeGolfBallCatalogEntries,
  normalizeGolfClubCatalog,
  normalizeGolfShaftCatalog,
  normalizeLaunchMonitorSession,
  normalizePlayerClub,
  normalizePlayerClubDistance,
  removeEquipmentProfile,
  removePlayerClub,
  removePlayerClubDistance,
  replaceCurrentPlayerBall,
  replaceCurrentPlayerClub,
  robustAverage,
  saveEquipmentProfile,
  setBallOnboardingStatus,
  setBallPreference,
  setCurrentPlayerBall,
  setEquipmentOnboardingStatus,
  setLastBallFit,
  setPlayerClubCurrent,
  summarizeLaunchMonitorSession,
  upsertPlayerBall,
  upsertPlayerClub,
  upsertPlayerClubDistance,
  type EquipmentProfile,
  type EquipmentStorageLike,
} from "../lib/golf-equipment";

const USER_ID = "user-equipment-1";
const CREATED_AT = "2026-09-06T12:00:00.000Z";
const UPDATED_AT = "2026-09-06T12:01:00.000Z";

function required<T>(value: T | null): T {
  assert.notEqual(value, null);
  return value as T;
}

function emptyProfile(): EquipmentProfile {
  return required(createEmptyEquipmentProfile(USER_ID, CREATED_AT));
}

function manualClub(overrides: Record<string, unknown> = {}) {
  return {
    id: "club-driver",
    userId: USER_ID,
    category: "DRIVER",
    catalogClubId: null,
    customBrand: "Marca manual",
    customModel: "Modelo propio",
    generation: null,
    year: null,
    loft: null,
    handedness: "RH",
    shaftId: null,
    customShaftBrand: null,
    customShaftModel: null,
    customShaft: null,
    flex: null,
    shaftWeightGrams: null,
    lengthInches: null,
    lieDegrees: null,
    grip: null,
    notes: null,
    setComposition: [],
    isCurrent: true,
    startedUsingAt: CREATED_AT,
    stoppedUsingAt: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function playerBall(overrides: Record<string, unknown> = {}) {
  return {
    id: "player-ball-1",
    userId: USER_ID,
    catalogBallId: "ball-one",
    ballBrand: "Marca",
    ballModel: "Bola Uno",
    generation: null,
    year: 2026,
    color: "Blanco",
    notes: null,
    isCurrent: true,
    startedUsingAt: CREATED_AT,
    stoppedUsingAt: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function ballCatalog(overrides: Record<string, unknown> = {}) {
  return {
    id: "ball-one",
    brand: "Marca verificada",
    model: "Modelo verificado",
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
    officialUrl: "https://example.com/official-ball",
    sourceName: "Fabricante",
    verifiedAt: "2026-09-01",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

class MemoryStorage implements EquipmentStorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("un usuario nuevo puede omitir equipo y bola sin bloquear ni crear datos ficticios", () => {
  let profile = emptyProfile();
  profile = required(setEquipmentOnboardingStatus(profile, "SKIPPED", UPDATED_AT));
  profile = required(setBallOnboardingStatus(profile, "SKIPPED", UPDATED_AT));
  profile = required(setBallPreference(profile, "SKIPPED", UPDATED_AT));

  assert.equal(profile.equipmentOnboarding, "SKIPPED");
  assert.equal(profile.ballOnboarding, "SKIPPED");
  assert.equal(profile.ballPreference, "SKIPPED");
  assert.deepEqual(profile.clubs, []);
  assert.deepEqual(profile.balls, []);
  assert.equal(profile.lastBallFit, null);
});

test("se puede registrar únicamente un driver con Marca + Modelo manual", () => {
  const club = normalizePlayerClub(manualClub(), USER_ID);
  assert.ok(club);
  assert.equal(club.catalogClubId, null);
  assert.equal(club.customBrand, "Marca manual");
  assert.equal(club.customModel, "Modelo propio");
  assert.equal(club.loft, null);
  assert.equal(club.shaftId, null);

  const profile = required(upsertPlayerClub(emptyProfile(), club, UPDATED_AT));
  assert.equal(profile.clubs.length, 1);
  assert.equal(profile.clubs[0].category, "DRIVER");
});

test("una bolsa completa conserva múltiples maderas, híbridos, wedges y composición de hierros", () => {
  const categories = [
    "DRIVER",
    "MINI_DRIVER",
    "FAIRWAY_WOOD",
    "FAIRWAY_WOOD",
    "HYBRID",
    "UTILITY_IRON",
    "IRON_SET",
    "WEDGE",
    "WEDGE",
    "WEDGE",
    "PUTTER",
  ] as const;
  let profile = emptyProfile();
  categories.forEach((category, index) => {
    profile = required(upsertPlayerClub(profile, manualClub({
      id: `club-${index}`,
      category,
      customBrand: `Marca ${index}`,
      customModel: `Modelo ${index}`,
      setComposition: category === "IRON_SET" ? ["1", "2", "4", "5", "6", "7", "8", "9", "PW", "UW", "desconocido"] : [],
      loft: category === "WEDGE" ? 50 + index : null,
    }), UPDATED_AT));
  });

  assert.equal(profile.clubs.length, categories.length);
  assert.equal(profile.clubs.filter((club) => club.category === "FAIRWAY_WOOD").length, 2);
  assert.equal(profile.clubs.filter((club) => club.category === "WEDGE").length, 3);
  assert.deepEqual(profile.clubs.find((club) => club.category === "IRON_SET")?.setComposition, ["1", "2", "4", "5", "6", "7", "8", "9", "PW", "UW"]);
});

test("sets combinados conservan un modelo por set y composiciones independientes", () => {
  let profile = required(upsertPlayerClub(emptyProfile(), manualClub({
    id: "combo-long",
    category: "IRON_SET",
    customModel: "Modelo A",
    setComposition: ["4", "5", "6"],
  }), UPDATED_AT));
  profile = required(upsertPlayerClub(profile, manualClub({
    id: "combo-short",
    category: "IRON_SET",
    customModel: "Modelo B",
    setComposition: ["7", "8", "9", "PW"],
  }), "2026-09-06T12:02:00.000Z"));

  assert.equal(profile.clubs.filter((club) => club.category === "IRON_SET").length, 2);
  assert.deepEqual(profile.clubs.find((club) => club.id === "combo-long")?.setComposition, ["4", "5", "6"]);
  assert.deepEqual(profile.clubs.find((club) => club.id === "combo-short")?.setComposition, ["7", "8", "9", "PW"]);
});

test("un modelo ausente del catálogo usa identidad manual y nunca crea una segunda cuenta", () => {
  const club = normalizePlayerClub(manualClub({ userId: USER_ID }), USER_ID);
  assert.ok(club);
  assert.equal(normalizePlayerClub(manualClub({ userId: "other-user" }), USER_ID), null);
  assert.equal(normalizePlayerClub(manualClub({ catalogClubId: null, customBrand: null, customModel: null }), USER_ID), null);

  const profile = required(upsertPlayerClub(emptyProfile(), club, UPDATED_AT));
  assert.equal(profile.userId, USER_ID);
  assert.equal(profile.clubs[0].userId, USER_ID);
});

test("editar y archivar un bastón conserva shaft separado y fechas de uso", () => {
  let profile = required(upsertPlayerClub(emptyProfile(), manualClub(), UPDATED_AT));
  profile = required(upsertPlayerClub(profile, manualClub({ customShaftBrand: "Fujikura", customShaftModel: "Ventus Blue", customShaft: "Fujikura Ventus Blue", flex: "STIFF", updatedAt: "2026-09-06T12:02:00.000Z" }), "2026-09-06T12:02:00.000Z"));
  assert.equal(profile.clubs.length, 1);
  assert.equal(profile.clubs[0].customShaftBrand, "Fujikura");
  assert.equal(profile.clubs[0].customShaftModel, "Ventus Blue");

  profile = required(setPlayerClubCurrent(profile, "club-driver", false, "2026-09-06T12:03:00.000Z"));
  assert.equal(profile.clubs[0].isCurrent, false, "el equipo anterior queda disponible como histórico local");
  assert.equal(profile.clubs[0].stoppedUsingAt, "2026-09-06T12:03:00.000Z");

  profile = required(setPlayerClubCurrent(profile, "club-driver", true, "2026-09-06T12:03:30.000Z"));
  assert.equal(profile.clubs[0].startedUsingAt, CREATED_AT);
  assert.equal(profile.clubs[0].stoppedUsingAt, null);

  profile = required(removePlayerClub(profile, "club-driver", "2026-09-06T12:04:00.000Z"));
  assert.deepEqual(profile.clubs, []);
});

test("cambiar el modelo actual archiva el bastón anterior y comienza una identidad nueva", () => {
  let profile = required(upsertPlayerClub(emptyProfile(), manualClub(), UPDATED_AT));
  profile = required(replaceCurrentPlayerClub(profile, "club-driver", manualClub({
    id: "club-driver-next",
    customModel: "Modelo siguiente",
    createdAt: "2026-09-06T13:00:00.000Z",
    updatedAt: "2026-09-06T13:00:00.000Z",
  }), "2026-09-06T13:00:00.000Z"));
  assert.equal(profile.clubs.length, 2);
  assert.equal(profile.clubs.find((club) => club.id === "club-driver")?.isCurrent, false);
  assert.equal(profile.clubs.find((club) => club.id === "club-driver")?.stoppedUsingAt, "2026-09-06T13:00:00.000Z");
  assert.equal(profile.clubs.find((club) => club.id === "club-driver-next")?.isCurrent, true);
  assert.equal(profile.clubs.find((club) => club.id === "club-driver-next")?.startedUsingAt, "2026-09-06T13:00:00.000Z");
});

test("distancias manuales validan dueño y bastón, persisten y se eliminan en cascada", () => {
  let profile = required(upsertPlayerClub(emptyProfile(), manualClub(), UPDATED_AT));
  const distance = {
    id: "distance-driver",
    userId: USER_ID,
    playerClubId: "club-driver",
    carryDistance: 235,
    totalDistance: 252,
    unit: "YD",
    source: "MANUAL",
    sampleCount: 1,
    confidence: null,
    updatedAt: "2026-09-06T12:02:00.000Z",
  };
  assert.ok(normalizePlayerClubDistance(distance, USER_ID));
  assert.equal(normalizePlayerClubDistance({ ...distance, userId: "other-user" }, USER_ID), null);
  assert.equal(normalizePlayerClubDistance({ ...distance, carryDistance: 250, totalDistance: 240 }, USER_ID), null);
  assert.equal(normalizePlayerClubDistance({ ...distance, carryDistance: 801 }, USER_ID), null);
  assert.equal(upsertPlayerClubDistance(profile, { ...distance, playerClubId: "missing-club" }), null);

  profile = required(upsertPlayerClubDistance(profile, distance, "2026-09-06T12:02:00.000Z"));
  assert.equal(profile.distances[0].carryDistance, 235);
  const reopened = decodeEquipmentProfile(required(encodeEquipmentProfile(profile, "2026-09-06T12:03:00.000Z")), USER_ID);
  assert.equal(reopened?.distances[0].totalDistance, 252);

  profile = required(removePlayerClubDistance(profile, "distance-driver", "2026-09-06T12:04:00.000Z"));
  assert.deepEqual(profile.distances, []);
  profile = required(upsertPlayerClubDistance(profile, distance, "2026-09-06T12:05:00.000Z"));
  profile = required(removePlayerClub(profile, "club-driver", "2026-09-06T12:06:00.000Z"));
  assert.deepEqual(profile.distances, [], "no quedan referencias huérfanas al borrar el bastón");
});

test("fingerprint y mutadores no cambian ante una escritura semánticamente idéntica", () => {
  const profile = required(upsertPlayerClub(emptyProfile(), manualClub(), UPDATED_AT));
  const fingerprint = equipmentProfileFingerprint(profile, USER_ID);
  const repeated = required(upsertPlayerClub(profile, manualClub({ updatedAt: "2026-09-06T19:00:00.000Z" }), "2026-09-06T19:00:00.000Z"));
  assert.equal(equipmentProfileFingerprint(repeated, USER_ID), fingerprint);
  assert.equal(repeated.updatedAt, profile.updatedAt, "un submit equivalente no genera nueva mutación de sync");
  const statusRepeated = required(setEquipmentOnboardingStatus(profile, profile.equipmentOnboarding, "2026-09-06T20:00:00.000Z"));
  assert.equal(statusRepeated.updatedAt, profile.updatedAt);

  let rendered = profile;
  let simulatedPosts = 0;
  for (let index = 0; index < 20; index += 1) {
    const next = required(setEquipmentOnboardingStatus(rendered, rendered.equipmentOnboarding, new Date(Date.parse(UPDATED_AT) + index * 1_000).toISOString()));
    if (equipmentProfileFingerprint(next, USER_ID) !== equipmentProfileFingerprint(rendered, USER_ID)) simulatedPosts += 1;
    rendered = next;
  }
  assert.equal(simulatedPosts, 0, "20 renders sin cambios no producen una mutación de red pendiente");
});

test("bola fija, notas, cambio e historial conservan una sola actual y fechas de uso", () => {
  let profile = required(upsertPlayerBall(emptyProfile(), playerBall({ notes: "Funciona bien con viento." }), UPDATED_AT));
  assert.equal(profile.ballPreference, "FIXED");
  assert.equal(profile.balls[0].notes, "Funciona bien con viento.");
  profile = required(upsertPlayerBall(profile, playerBall({
    id: "player-ball-2",
    catalogBallId: "ball-two",
    ballModel: "Bola Dos",
    updatedAt: "2026-09-06T12:02:00.000Z",
  }), "2026-09-06T12:02:00.000Z"));

  assert.equal(profile.balls.length, 2);
  assert.equal(profile.balls.filter((ball) => ball.isCurrent).length, 1);
  assert.equal(profile.balls.find((ball) => ball.isCurrent)?.id, "player-ball-2");
  assert.equal(profile.balls.find((ball) => ball.id === "player-ball-1")?.stoppedUsingAt, "2026-09-06T12:02:00.000Z");

  profile = required(setCurrentPlayerBall(profile, "player-ball-1", "2026-09-06T12:03:00.000Z"));
  assert.equal(profile.balls.find((ball) => ball.isCurrent)?.id, "player-ball-1");
  assert.equal(profile.balls.find((ball) => ball.id === "player-ball-1")?.stoppedUsingAt, null);
  assert.equal(profile.balls.find((ball) => ball.id === "player-ball-2")?.stoppedUsingAt, "2026-09-06T12:03:00.000Z");
  profile = required(setBallPreference(profile, "NO_FIXED_BALL", "2026-09-06T12:04:00.000Z"));
  assert.equal(profile.ballPreference, "NO_FIXED_BALL");
  assert.equal(profile.balls.some((ball) => ball.isCurrent), false);
  assert.equal(profile.balls.length, 2);
  assert.equal(profile.balls.find((ball) => ball.id === "player-ball-1")?.stoppedUsingAt, "2026-09-06T12:04:00.000Z");
});

test("cambiar modelo desde editar preserva la bola anterior como histórico", () => {
  let profile = required(upsertPlayerBall(emptyProfile(), playerBall(), UPDATED_AT));
  profile = required(replaceCurrentPlayerBall(profile, "player-ball-1", playerBall({
    id: "player-ball-next",
    catalogBallId: "ball-next",
    ballModel: "Bola siguiente",
    createdAt: "2026-09-06T13:00:00.000Z",
    updatedAt: "2026-09-06T13:00:00.000Z",
  }), "2026-09-06T13:00:00.000Z"));
  assert.equal(profile.balls.length, 2);
  assert.equal(profile.balls.find((ball) => ball.id === "player-ball-1")?.isCurrent, false);
  assert.equal(profile.balls.find((ball) => ball.id === "player-ball-1")?.stoppedUsingAt, "2026-09-06T13:00:00.000Z");
  assert.equal(profile.balls.find((ball) => ball.id === "player-ball-next")?.isCurrent, true);
});

test("guardar, cerrar y reabrir usa un envelope versionado y aislado por userId", () => {
  const storage = new MemoryStorage();
  const profile = required(upsertPlayerClub(emptyProfile(), manualClub(), UPDATED_AT));
  const saved = saveEquipmentProfile(storage, profile, "2026-09-06T12:05:00.000Z");
  assert.equal(saved.ok, true);

  const reopened = loadEquipmentProfile(storage, USER_ID);
  assert.equal(reopened.ok, true);
  if (!reopened.ok) return;
  assert.deepEqual(reopened.profile, profile);
  assert.equal(loadEquipmentProfile(storage, "other-user").ok, true, "otra cuenta recibe su espacio vacío, no datos ajenos");

  const key = required(equipmentProfileStorageKey(USER_ID));
  const encoded = storage.values.get(key);
  assert.ok(encoded);
  assert.equal(decodeEquipmentProfile(encoded, "other-user"), null);
  assert.ok(decodeEquipmentProfile(encoded, USER_ID));
  assert.equal(decodeEquipmentProfile(encoded.replace('"version":1', '"version":2'), USER_ID), null);

  assert.equal(removeEquipmentProfile(storage, USER_ID).ok, true);
  assert.equal(storage.values.has(key), false);
});

test("un modelo de proveedor conserva snapshots de club y shaft al reabrir sin catálogo cliente", () => {
  const profile = required(upsertPlayerClub(emptyProfile(), manualClub({
    catalogClubId: "db-only-club",
    customBrand: "Marca remota",
    customModel: "Modelo remoto",
    shaftId: "db-only-shaft",
    customShaftBrand: "Shaft remoto",
    customShaftModel: "Serie remota",
    customShaft: "Shaft remoto Serie remota",
  }), UPDATED_AT));
  const reopened = decodeEquipmentProfile(required(encodeEquipmentProfile(profile)), USER_ID);
  assert.equal(reopened?.clubs[0].catalogClubId, "db-only-club");
  assert.equal(reopened?.clubs[0].customBrand, "Marca remota");
  assert.equal(reopened?.clubs[0].customModel, "Modelo remoto");
  assert.equal(reopened?.clubs[0].shaftId, "db-only-shaft");
  assert.equal(reopened?.clubs[0].customShaftBrand, "Shaft remoto");
  assert.equal(reopened?.clubs[0].customShaftModel, "Serie remota");
});

test("el último resultado de fitting se incorpora al mismo perfil versionado", () => {
  const profile = setLastBallFit(emptyProfile(), {
    id: "fit-one",
    completedAt: UPDATED_AT,
    currentBallId: null,
    inputCompleteness: 75,
    recommendations: [
      { catalogBallId: "ball-one", matchScore: 91 },
      { catalogBallId: "invalid-score", matchScore: 200 },
    ],
  }, UPDATED_AT);

  assert.ok(profile);
  assert.equal(profile.lastBallFit?.id, "fit-one");
  assert.equal(profile.lastBallFit?.recommendations.length, 1);
  assert.equal(profile.lastBallFit?.recommendations[0]?.catalogBallId, "ball-one");
  assert.equal(profile.lastBallFit?.recommendations[0]?.matchScore, 91);
});

test("la normalización no pierde el perfil existente por entradas opcionales inválidas", () => {
  const profile = emptyProfile();
  const normalized = normalizeEquipmentProfile({
    ...profile,
    ballPreference: "FIXED",
    clubs: [manualClub(), { bad: "record" }],
    balls: [playerBall(), { userId: "intruder" }],
  }, USER_ID);
  assert.ok(normalized);
  assert.equal(normalized.userId, USER_ID);
  assert.equal(normalized.clubs.length, 1);
  assert.equal(normalized.balls.length, 1);
  assert.equal(normalized.ballPreference, "FIXED");

  const encoded = encodeEquipmentProfile(normalized, UPDATED_AT);
  assert.ok(encoded);
});

test("un snapshot v1 anterior sin distancias sigue siendo legible", () => {
  const current = emptyProfile();
  const legacy: Record<string, unknown> = { ...current, schemaVersion: 1 };
  delete legacy.distances;
  const normalized = normalizeEquipmentProfile(legacy, USER_ID);
  assert.ok(normalized);
  assert.equal(normalized.schemaVersion, 2);
  assert.deepEqual(normalized.distances, []);
  assert.equal(normalizeEquipmentProfileStrict(legacy, USER_ID), null, "un cliente v1 nunca puede bajar el snapshot cloud v2");
});

test("los catálogos conservan null cuando no existe compresión u otro dato verificado", () => {
  const ball = normalizeGolfBallCatalog(ballCatalog({ compression: undefined, flight: "invented", officialUrl: "http://unsafe.example" }));
  assert.ok(ball);
  assert.equal(ball.compression, null);
  assert.equal(ball.flight, null);
  assert.equal(ball.officialUrl, null);

  const root = { schemaVersion: 1, models: [ballCatalog(), { bad: true }] };
  assert.equal(normalizeGolfBallCatalogEntries(root).length, 1);

  const club = normalizeGolfClubCatalog({
    id: "club-catalog-1",
    brand: "Marca",
    model: "Driver",
    generation: null,
    year: 2026,
    category: "DRIVER",
    subCategory: null,
    active: true,
    handedness: "BOTH",
    lofts: [9, 10.5, 10.5, "desconocido"],
    standardLength: null,
    lie: null,
    headVolume: 460,
    officialUrl: "https://example.com/driver",
    verifiedAt: "2026-09-01",
  });
  assert.ok(club);
  assert.deepEqual(club.handedness, ["RH", "LH"]);
  assert.deepEqual(club.lofts, [9, 10.5]);

  assert.equal(normalizeGolfShaftCatalog({ id: "shaft", brand: "Marca", model: "Shaft", flex: ["STIFF"] }), null, "sin active no se inventa el estado del shaft");
});

test("mediana y promedio resistente reducen outliers y permiten excluir un golpe malo", () => {
  assert.equal(median([100, 102, 900]), 102);
  assert.equal(robustAverage([100, 101, 102, 103, 900]), 102);

  const session = normalizeLaunchMonitorSession({
    id: "session-1",
    userId: USER_ID,
    source: "Launch monitor del usuario",
    startedAt: CREATED_AT,
    completedAt: UPDATED_AT,
    shots: [
      { id: "d1", club: "DRIVER", excluded: false, ballSpeedMph: 150, carryYards: 250 },
      { id: "d2", club: "DRIVER", excluded: false, ballSpeedMph: 151, carryYards: 252 },
      { id: "d3", club: "DRIVER", excluded: false, ballSpeedMph: 152, carryYards: 251 },
      { id: "bad", club: "DRIVER", excluded: true, ballSpeedMph: 30, carryYards: 20 },
      { id: "bad-format", club: "DRIVER", excluded: false, carryYards: -40 },
    ],
  }, USER_ID);
  assert.ok(session);
  assert.equal(session.shots.length, 4);

  const summary = summarizeLaunchMonitorSession(session);
  assert.ok(summary);
  assert.equal(summary.includedShots, 3);
  assert.equal(summary.excludedShots, 1);
  assert.equal(summary.byClub[0].metrics.carryYards?.median, 251);
  assert.equal(summary.byClub[0].metrics.carryYards?.resistantAverage, 251);

  const progress = getLaunchMonitorProtocolProgress(session);
  assert.ok(progress);
  assert.equal(progress.complete, false);
  assert.equal(progress.counts.DRIVER, 3);
  assert.equal(progress.missing.DRIVER, 0);
  assert.equal(progress.missing.IRON_7, 3);
});

test("el protocolo avanzado queda completo con tres golpes incluidos por cada palo", () => {
  const clubs = ["DRIVER", "IRON_7", "PITCHING_WEDGE", "HALF_WEDGE"] as const;
  const progress = getLaunchMonitorProtocolProgress({
    id: "session-complete",
    userId: USER_ID,
    startedAt: CREATED_AT,
    shots: clubs.flatMap((club) => Array.from({ length: 3 }, (_, index) => ({
      id: `${club}-${index}`,
      club,
      excluded: false,
      carryYards: 100 + index,
    }))),
  });
  assert.ok(progress);
  assert.equal(progress.complete, true);
  assert.deepEqual(progress.missing, { DRIVER: 0, IRON_7: 0, PITCHING_WEDGE: 0, HALF_WEDGE: 0 });
});

test("la captura limita cada palo a 30 golpes y la escritura cloud rechaza normalización con pérdida", () => {
  const shots = Array.from({ length: MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB + 2 }, (_, index) => ({
    id: `driver-${index}`,
    club: "DRIVER",
    excluded: false,
    carryYards: 220 + index,
  }));
  const session = normalizeLaunchMonitorSession({
    id: "session-capped",
    userId: USER_ID,
    startedAt: CREATED_AT,
    shots,
  }, USER_ID);
  assert.ok(session);
  assert.equal(session.shots.length, MAX_LAUNCH_MONITOR_SHOTS_PER_CLUB);

  const malformed = { ...emptyProfile(), clubs: [manualClub(), { id: "invalid" }] };
  assert.equal(normalizeEquipmentProfileStrict(malformed, USER_ID), null);
  const lossy = {
    ...emptyProfile(),
    clubs: [manualClub({ notes: "x".repeat(1_500) })],
  };
  assert.equal(normalizeEquipmentProfileStrict(lossy, USER_ID), null, "cloud no debe truncar notas silenciosamente");
  assert.ok(normalizeEquipmentProfileStrict(emptyProfile(), USER_ID));
});
