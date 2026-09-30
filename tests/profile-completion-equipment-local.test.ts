import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  queueEquipmentSyncOutbox,
  recordEquipmentSyncBase,
} from "../lib/equipment-offline-store";
import {
  createEmptyEquipmentProfile,
  removePlayerBall,
  saveEquipmentProfile,
  setBallPreference,
  setLastBallFit,
  upsertPlayerBall,
  upsertPlayerClub,
  type EquipmentProfile,
} from "../lib/golf-equipment";
import { completionEquipmentOverride } from "../lib/profile-completion-client";
import {
  EMPTY_COMPLETION_CHOICES,
  profileCompletion,
  profileCompletionWithEquipment,
} from "../lib/profile-completion";

const USER_ID = "completion-equipment-owner";
const CREATED_AT = "2026-09-30T12:00:00.000Z";
const BALL_AT = "2026-09-30T12:01:00.000Z";
const FIT_AT = "2026-09-30T12:02:00.000Z";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

function required<T>(value: T | null): T {
  assert.notEqual(value, null);
  return value as T;
}

function equipmentWithoutBall(): EquipmentProfile {
  const empty = required(createEmptyEquipmentProfile(USER_ID, CREATED_AT));
  return required(upsertPlayerClub(empty, {
    id: "driver-current",
    userId: USER_ID,
    category: "DRIVER",
    catalogClubId: null,
    customBrand: "QA",
    customModel: "Driver",
    generation: null,
    year: null,
    loft: 10,
    handedness: "RH",
    shaftId: null,
    customShaftBrand: null,
    customShaftModel: null,
    customShaft: null,
    flex: null,
    shaftFlexLabel: null,
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
    updatedAt: CREATED_AT,
  }, CREATED_AT));
}

function equipmentWithCurrentBall(): EquipmentProfile {
  return required(upsertPlayerBall(equipmentWithoutBall(), {
    id: "ball-current",
    userId: USER_ID,
    catalogBallId: "catalog-pro-v1x",
    ballBrand: "Titleist",
    ballModel: "Pro V1x",
    generation: "2025",
    year: 2025,
    color: null,
    notes: null,
    isCurrent: true,
    startedUsingAt: BALL_AT,
    stoppedUsingAt: null,
    createdAt: BALL_AT,
    updatedAt: BALL_AT,
  }, BALL_AT));
}

function otherwiseCompleteProgress(equipment: EquipmentProfile) {
  return profileCompletion({
    displayName: "QA Golfer",
    givenName: "QA",
    familyName: "Golfer",
    username: "qa-golfer",
    handedness: "RH",
    homeClub: "La Vista Country Club",
    indexEnabled: true,
    indexResolution: "GHIN",
    indexValue: 7.9,
    equipment,
    choices: EMPTY_COMPLETION_CHOICES,
  });
}

function section(progress: ReturnType<typeof profileCompletion>, id: string) {
  return progress.sections.find((item) => item.id === id);
}

test("una bola actual aplica 83 → 100 inmediatamente sobre el progreso local", () => {
  const withoutBall = equipmentWithoutBall();
  const staleCloudProgress = otherwiseCompleteProgress(withoutBall);
  assert.equal(staleCloudProgress.percent, 83);
  assert.equal(section(staleCloudProgress, "ball")?.status, "Falta completar");

  const localWithBall = equipmentWithCurrentBall();
  const updated = profileCompletionWithEquipment(staleCloudProgress, localWithBall);
  assert.equal(updated.percent, 100);
  assert.equal(section(updated, "ball")?.complete, true);
  assert.equal(section(updated, "ball")?.status, "Completo");
});

test("un fitting local muestra Completo sin alterar el porcentaje obligatorio", () => {
  const withBall = equipmentWithCurrentBall();
  const beforeFit = otherwiseCompleteProgress(withBall);
  assert.equal(beforeFit.percent, 100);
  assert.equal(section(beforeFit, "fitting")?.complete, false);
  assert.equal(section(beforeFit, "fitting")?.status, "Opcional");

  const withFit = required(setLastBallFit(withBall, {
    id: "fit-complete",
    completedAt: FIT_AT,
    currentBallId: "catalog-pro-v1x",
    inputCompleteness: 100,
    recommendations: [{ catalogBallId: "catalog-pro-v1x", matchScore: 96 }],
  }, FIT_AT));
  const updated = profileCompletionWithEquipment(beforeFit, withFit);
  assert.equal(updated.percent, 100);
  assert.equal(section(updated, "fitting")?.complete, true);
  assert.equal(section(updated, "fitting")?.optional, true);
  assert.equal(section(updated, "fitting")?.status, "Completo");
});

test("NO_FIXED_BALL completa Bola sin inventar una PlayerBall", () => {
  const withoutBall = equipmentWithoutBall();
  const noFixedBall = required(setBallPreference(withoutBall, "NO_FIXED_BALL", BALL_AT));
  const updated = profileCompletionWithEquipment(otherwiseCompleteProgress(withoutBall), noFixedBall);
  assert.equal(noFixedBall.balls.length, 0);
  assert.equal(updated.percent, 100);
  assert.equal(section(updated, "ball")?.complete, true);
});

test("eliminar la única bola actual sin NO_FIXED_BALL devuelve Bola a incompleta", () => {
  const withBall = equipmentWithCurrentBall();
  const complete = otherwiseCompleteProgress(withBall);
  assert.equal(complete.percent, 100);

  const removed = required(removePlayerBall(withBall, "ball-current", FIT_AT));
  assert.equal(removed.ballPreference, "NOT_ASKED");
  const updated = profileCompletionWithEquipment(complete, removed);
  assert.equal(updated.percent, 83);
  assert.equal(section(updated, "ball")?.complete, false);
  assert.equal(section(updated, "ball")?.status, "Falta completar");
});

test("el outbox y una nube atrasada conservan Equipment local; una nube convergente ya no requiere override", () => {
  const base = equipmentWithoutBall();
  const local = equipmentWithCurrentBall();
  const pendingStorage = new MemoryStorage();
  assert.equal(saveEquipmentProfile(pendingStorage, local, BALL_AT).ok, true);
  recordEquipmentSyncBase(pendingStorage, USER_ID, {
    profile: base,
    version: 1,
    lastMutationId: "cloud-base",
    updatedAt: CREATED_AT,
  });
  queueEquipmentSyncOutbox(pendingStorage, USER_ID, local, "local-ball-save", BALL_AT);
  const newerLocal = required(upsertPlayerBall(local, {
    id: "ball-newer",
    userId: USER_ID,
    catalogBallId: "catalog-z-star",
    ballBrand: "Srixon",
    ballModel: "Z-STAR",
    generation: "2026",
    year: 2026,
    color: null,
    notes: null,
    isCurrent: true,
    startedUsingAt: FIT_AT,
    stoppedUsingAt: null,
    createdAt: FIT_AT,
    updatedAt: FIT_AT,
  }, FIT_AT));
  assert.equal(saveEquipmentProfile(pendingStorage, newerLocal, FIT_AT).ok, true);

  const pendingOverride = completionEquipmentOverride(pendingStorage, USER_ID, {
    version: 1,
    updatedAt: CREATED_AT,
  });
  assert.equal(pendingOverride?.balls.some((ball) => ball.isCurrent), true);
  assert.equal(pendingOverride?.balls.find((ball) => ball.isCurrent)?.catalogBallId, "catalog-z-star");

  const convergedStorage = new MemoryStorage();
  assert.equal(saveEquipmentProfile(convergedStorage, local, FIT_AT).ok, true);
  recordEquipmentSyncBase(convergedStorage, USER_ID, {
    profile: local,
    version: 2,
    lastMutationId: "cloud-confirmed",
    updatedAt: FIT_AT,
  });
  assert.equal(completionEquipmentOverride(convergedStorage, USER_ID, {
    version: 2,
    updatedAt: FIT_AT,
  }), null);
});

test("ProfileCompletionRing escucha la revisión determinista de Equipment y protege respuestas anteriores", () => {
  const ring = readFileSync("app/components/profile-completion-ring.tsx", "utf8");
  const hook = readFileSync("app/components/use-equipment-profile.ts", "utf8");

  assert.match(hook, /publishEquipmentProfileUpdated\(result\.profile\)/);
  assert.match(ring, /addEventListener\(EQUIPMENT_PROFILE_UPDATED_EVENT, onEquipmentUpdated\)/);
  assert.match(ring, /completionEquipmentOverride\(localStorage, userId, value\.equipmentRevision\)/);
  assert.match(ring, /requestGeneration\.current === generation/);
  assert.doesNotMatch(ring, /setTimeout|setInterval/);
});

test("onboarding y Perfil delegan el auto-guardado de la bola al mismo agregado Equipment", () => {
  for (const path of [
    "app/components/equipment-onboarding.tsx",
    "app/components/equipment-profile-panel.tsx",
  ]) {
    const parent = readFileSync(path, "utf8");
    assert.match(parent, /function selectFitCurrentBall\(ball: GolfBallCatalog\)/);
    assert.match(parent, /setCatalogBallAsCurrent\(current, ball, playerBallId\(\), now\)/);
    assert.match(parent, /onCurrentBallSelect=\{selectFitCurrentBall\}/);
    assert.match(parent, /setLastBallFit\(withChoice, summary, now\)/);
  }
});
