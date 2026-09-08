import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceBetaOnboarding,
  betaOnboardingIsActive,
  betaOnboardingStorageKey,
  completeBetaOnboarding,
  createBetaOnboardingProgress,
  normalizeBetaOnboardingProgress,
  persistBetaOnboardingProgress,
  readBetaOnboardingProgress,
} from "../lib/beta-onboarding";
import {
  emptyBackyardProfileDetails,
  mergeBackyardProfile,
  normalizeBackyardProfileCache,
  type BackyardProfile,
} from "../lib/account-state";
import { PLAN_CATALOG, planHasFeature, selectablePlanId } from "../lib/plans";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const profile: BackyardProfile = {
  userId: "user-1",
  displayName: "Said",
  email: "said@example.com",
  avatarUrl: "",
  defaultHandicap: 8,
  ...emptyBackyardProfileDetails(),
};

test("registro inicia un onboarding versionado y reanudable en GHIN", () => {
  const storage = memoryStorage();
  const started = createBetaOnboardingProgress("user-1", "2026-09-07T12:00:00.000Z");
  persistBetaOnboardingProgress(storage, started);
  assert.equal(started.step, "ghin");
  assert.equal(betaOnboardingIsActive(readBetaOnboardingProgress(storage, "user-1")), true);
  assert.match(betaOnboardingStorageKey("user-1"), /user-1$/);
});

test("GHIN, equipo y Ball Fit pueden omitirse sin bloquear el onboarding", () => {
  const started = createBetaOnboardingProgress("user-1", "2026-09-07T12:00:00.000Z");
  const equipment = advanceBetaOnboarding(started, "equipment", { skipped: true, now: "2026-09-07T12:01:00.000Z" });
  const improvements = advanceBetaOnboarding(equipment, "improvements", { skipped: true, now: "2026-09-07T12:02:00.000Z" });
  assert.deepEqual(improvements.skippedSteps, ["ghin", "equipment"]);
  assert.equal(improvements.step, "improvements");
});

test("áreas de mejora, objetivo HCP y plan forman un solo Golf Profile", () => {
  const merged = mergeBackyardProfile(profile, {
    displayName: "Said A.",
    avatarUrl: "",
    defaultHandicap: 8,
    improvementGoals: ["DRIVER", "PUTTING", "LOWER_HANDICAP"],
    primaryGoal: "LOWER_HANDICAP",
    targetHandicap: 5,
    planId: "free",
    ghinLinkStatus: "SKIPPED",
  });
  assert.deepEqual(merged.improvementGoals, ["DRIVER", "PUTTING", "LOWER_HANDICAP"]);
  assert.equal(merged.primaryGoal, "LOWER_HANDICAP");
  assert.equal(merged.targetHandicap, 5);
  assert.equal(merged.planId, "free");
  assert.equal(merged.ghinLinkStatus, "SKIPPED");

  const restored = normalizeBackyardProfileCache(JSON.parse(JSON.stringify(merged)), profile);
  assert.deepEqual(restored.improvementGoals, merged.improvementGoals);
  assert.equal(restored.targetHandicap, 5);
});

test("planes Beta exponen entitlements sin precio ni cobro", () => {
  assert.deepEqual(PLAN_CATALOG.map((plan) => plan.id), ["free", "silver", "gold", "black"]);
  assert.equal(selectablePlanId("silver"), "free");
  assert.equal(selectablePlanId("free"), "free");
  assert.equal(planHasFeature("gold", "coach_ai"), true);
  assert.equal(planHasFeature("free", "coach_ai"), false);
  assert.equal(PLAN_CATALOG.some((plan) => "price" in plan), false);
});

test("onboarding conserva el grupo creado y solo termina por acción explícita", () => {
  const started = createBetaOnboardingProgress("user-1", "2026-09-07T12:00:00.000Z");
  const ready = advanceBetaOnboarding(started, "ready", { groupId: "group-domingos", now: "2026-09-07T12:05:00.000Z" });
  assert.equal(ready.status, "in_progress");
  assert.equal(ready.groupId, "group-domingos");
  const completed = completeBetaOnboarding(ready, { now: "2026-09-07T12:06:00.000Z" });
  assert.equal(completed.status, "complete");
  assert.equal(completed.step, "complete");
  assert.equal(betaOnboardingIsActive(completed), false);
});

test("estado inválido o de otra cuenta no puede completar onboarding", () => {
  assert.equal(normalizeBetaOnboardingProgress({ version: 1, userId: "other", status: "complete", step: "complete" }, "user-1"), null);
  const started = createBetaOnboardingProgress("user-1", "2026-09-07T12:00:00.000Z");
  assert.equal(advanceBetaOnboarding(started, "ghin").step, "ghin");
});
