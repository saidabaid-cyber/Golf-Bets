import assert from "node:assert/strict";
import test from "node:test";

import {
  BALL_FIT_DRAFT_VERSION,
  ballFitDraftStorageKey,
  loadBallFitDraft,
  normalizeBallFitDraft,
  removeBallFitDraft,
  saveBallFitDraft,
} from "../lib/ball-fitting-storage";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const input = {
  userId: "fit-owner",
  currentBallId: "titleist-pro-v1-2026",
  handicap: 8.4,
  typicalScore: 82,
  driverDistanceYards: 255,
  swingSpeedBand: "FROM_95_TO_105",
  feelPreference: "SOFT",
  trajectoryPreference: "MID",
  greenFirmness: "MEDIUM",
  priorities: ["STOP_ON_GREEN", "LESS_DRIVER_SPIN"],
  approachBehavior: "ROLLS_TOO_MUCH",
  wantsGreensideSpin: "YES",
  pricePreference: "PREMIUM",
  colorPreference: "WHITE",
  launchMonitorSession: null,
};

test("el Ball Fit se guarda a mitad del flujo y reaparece tras cerrar la PWA", () => {
  const storage = new MemoryStorage();
  const draft = saveBallFitDraft(storage, input, 4, "2026-09-06T20:00:00.000Z");
  assert.ok(draft);
  assert.equal(draft.schemaVersion, BALL_FIT_DRAFT_VERSION);
  assert.equal(draft.step, 4);

  const reopened = loadBallFitDraft(storage, "fit-owner");
  assert.ok(reopened);
  assert.equal(reopened.step, 4);
  assert.deepEqual(reopened.input.priorities, ["STOP_ON_GREEN", "LESS_DRIVER_SPIN"]);
  assert.equal(reopened.input.handicap, 8.4);
});

test("un borrador de fitting nunca cruza entre cuentas", () => {
  const storage = new MemoryStorage();
  assert.ok(saveBallFitDraft(storage, input, 2));
  assert.equal(loadBallFitDraft(storage, "other-owner"), null);
  const ownerKey = ballFitDraftStorageKey("fit-owner");
  assert.ok(ownerKey);
  const serialized = storage.values.get(ownerKey);
  assert.ok(serialized);
  assert.equal(normalizeBallFitDraft(JSON.parse(serialized), "other-owner"), null);
  assert.equal(ballFitDraftStorageKey(""), null);
});

test("borrar el fitting opcional es explícito y no toca otro perfil", () => {
  const storage = new MemoryStorage();
  assert.ok(saveBallFitDraft(storage, input, 6));
  const other = { ...input, userId: "other-owner" };
  assert.ok(saveBallFitDraft(storage, other, 1));
  assert.equal(removeBallFitDraft(storage, "fit-owner"), true);
  assert.equal(loadBallFitDraft(storage, "fit-owner"), null);
  assert.ok(loadBallFitDraft(storage, "other-owner"));
});

test("un borrador corrupto o con versión futura falla cerrado", () => {
  const storage = new MemoryStorage();
  const key = ballFitDraftStorageKey("fit-owner");
  assert.ok(key);
  storage.setItem(key, "{broken");
  assert.equal(loadBallFitDraft(storage, "fit-owner"), null);
  storage.setItem(key, JSON.stringify({ schemaVersion: 99, userId: "fit-owner", step: 1, input, updatedAt: new Date().toISOString() }));
  assert.equal(loadBallFitDraft(storage, "fit-owner"), null);
});
