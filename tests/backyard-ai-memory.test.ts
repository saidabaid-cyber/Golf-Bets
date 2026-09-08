import assert from "node:assert/strict";
import test from "node:test";

import { personalKnowledgeStorageKey } from "../lib/backyard-ai/knowledge/knowledge-storage";
import { persistGroupPreference, readGroupPreferences, writeGroupPreferences } from "../lib/backyard-ai/memory/group-memory";
import {
  appendLearningRecord,
  createAIAction,
  createAICorrection,
  createAIInteraction,
  createPersonalLearningEvent,
  createScorecardCorrection,
  defaultLearningConsent,
  deidentifyLearningEvent,
  deletePersonalAiData,
  learningConsentStorageKey,
  learningRecordsStorageKey,
  readLearningConsent,
  readLearningRecords,
  scorecardCorrectionLearningEvent,
  writeLearningConsent,
} from "../lib/backyard-ai/memory/learning-events";
import {
  persistUserPreference,
  readUserPreferences,
  userPreferenceStorageKey,
} from "../lib/backyard-ai/memory/personal-memory";
import type { GroupPreference, LearningConsent, UserPreference } from "../lib/backyard-ai/memory/types";
import {
  backyardAiMetricsStorageKey,
  emptyBackyardAiMetrics,
  readBackyardAiMetrics,
  recordRoundCompletionMetric,
  recordRoundSetupMetrics,
  recordScorecardMetrics,
  recordScorecardOutcomeMetrics,
  summarizeBackyardAiMetrics,
  updateBackyardAiMetrics,
} from "../lib/backyard-ai/observability/metrics";

const NOW = "2026-09-07T12:00:00.000Z";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

function userPreference(overrides: Partial<UserPreference> = {}): UserPreference {
  return {
    recordType: "USER_PREFERENCE",
    schemaVersion: 1,
    id: "pref-skins",
    ownerId: "user-1",
    key: "bets.skins.defaultValue",
    value: 100,
    context: { region: "MX", gameKey: "skins", ruleset: "group-default" },
    origin: "HISTORY",
    status: "INFERRED",
    confidence: 0.8,
    createdAt: NOW,
    updatedAt: NOW,
    useCount: 1,
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
    ...overrides,
  };
}

function groupPreference(overrides: Partial<GroupPreference> = {}): GroupPreference {
  return {
    recordType: "GROUP_PREFERENCE",
    schemaVersion: 1,
    id: "group-pref-pedro",
    ownerId: "user-1",
    groupId: "group-1",
    key: "bets.skins.exclusions",
    value: ["member-pedro"],
    context: { region: "MX", gameKey: "skins", ruleset: "group-default" },
    origin: "CORRECTION",
    status: "CONFIRMED",
    confidence: 1,
    createdAt: NOW,
    updatedAt: NOW,
    confirmedAt: NOW,
    useCount: 0,
    dataScope: "PERSONAL",
    trainingUse: "EXCLUDED",
    ...overrides,
  };
}

test("personal memory is owner-scoped and semantic updates replace only one preference", () => {
  const storage = memoryStorage();
  const first = persistUserPreference(storage, userPreference());
  assert.equal(first.ok, true);
  const changed = persistUserPreference(storage, userPreference({ id: "pref-skins-v2", value: 200, origin: "USER", status: "CONFIRMED", confidence: 1 }));
  assert.equal(changed.ok, true);

  const own = readUserPreferences(storage, "user-1", NOW);
  assert.equal(own.ok, true);
  assert.equal(own.document.items.length, 1);
  assert.equal(own.document.items[0].value, 200);
  assert.equal(own.document.items[0].trainingUse, "EXCLUDED");
  assert.deepEqual(readUserPreferences(storage, "user-2", NOW).document.items, []);
  assert.notEqual(userPreferenceStorageKey("user-1"), userPreferenceStorageKey("user-2"));
});

test("group memory remains private to its owner and can be filtered by recurrent group", () => {
  const storage = memoryStorage();
  const records = [groupPreference(), groupPreference({ id: "other", groupId: "group-2", value: ["member-carlos"] })];
  assert.equal(writeGroupPreferences(storage, "user-1", records, NOW).ok, true);
  assert.deepEqual(readGroupPreferences(storage, "user-1", "group-1", NOW).document.items.map((item) => item.id), ["group-pref-pedro"]);
  assert.deepEqual(readGroupPreferences(storage, "user-2", "group-1", NOW).document.items, []);
  assert.equal(persistGroupPreference(storage, groupPreference({ id: "group-1-new", value: ["member-said"] }), NOW).ok, true);
  assert.equal(readGroupPreferences(storage, "user-1", undefined, NOW).document.items.length, 2);
  assert.deepEqual(readGroupPreferences(storage, "user-1", "group-2", NOW).document.items[0].value, ["member-carlos"]);
});

test("storage failures are reported without throwing or overwriting unknown state", () => {
  let writes = 0;
  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { writes += 1; },
    removeItem() { throw new Error("blocked"); },
  };
  const result = persistUserPreference(broken, userPreference(), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.error, "storage_read_failed");
  assert.equal(writes, 0);
  assert.equal(readLearningRecords(broken, "user-1", NOW).ok, false);
});

test("global learning is opt-in and private events remain excluded by default", () => {
  const event = createPersonalLearningEvent({
    id: "learning-1",
    ownerId: "user-1",
    eventType: "SETUP_CORRECTED",
    verified: true,
    occurredAt: NOW,
    payload: {
      fieldPath: "/bets/skins/value",
      proposedValue: 100,
      correctedValue: 200,
      playerName: "Pedro",
      prompt: "Pedro juega con said@example.com",
      notes: "free form is not allow-listed",
    },
  });
  assert.ok(event);
  assert.equal(event.trainingUse, "EXCLUDED");
  assert.equal(event.dataScope, "PERSONAL");

  const defaultConsent = defaultLearningConsent("user-1", "privacy-v1", NOW);
  assert.equal(defaultConsent.personalMemoryEnabled, false);
  assert.equal(defaultConsent.globalLearningEnabled, false);
  assert.deepEqual(deidentifyLearningEvent(event, defaultConsent, { outputId: "global-1", auditId: "audit-1", now: NOW }), {
    ok: false,
    reason: "consent_missing",
  });

  const consent: LearningConsent = {
    ...defaultConsent,
    globalLearningEnabled: true,
    grantedAt: NOW,
  };
  const result = deidentifyLearningEvent(event, consent, {
    outputId: "global-1",
    auditId: "audit-1",
    identifiers: ["Pedro"],
    sourceDigest: `sha256:${"a".repeat(64)}`,
    now: NOW,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.dataScope, "GLOBAL_DEIDENTIFIED");
  assert.equal(result.event.trainingUse, "ELIGIBLE");
  assert.equal(result.event.sourceDigest, `sha256:${"a".repeat(64)}`);
  assert.deepEqual(result.event.payload, {
    fieldPath: "/bets/skins/value",
    proposedValue: 100,
    correctedValue: 200,
  });
  const serialized = JSON.stringify(result.event).toLocaleLowerCase("en-US");
  assert.equal(serialized.includes("user-1"), false);
  assert.equal(serialized.includes("pedro"), false);
  assert.equal(serialized.includes("said@example.com"), false);
  assert.ok(result.audit.removedFields.includes("/prompt"));
  assert.ok(result.audit.removedFields.includes("/playerName"));
});

test("interaction, structured action and correction builders remain private and auditable", () => {
  const interaction = createAIInteraction({
    id: "interaction-setup-1",
    ownerId: "user-1",
    kind: "ROUND_SETUP",
    channel: "VOICE",
    locale: "es-MX",
    status: "VALIDATED",
    inputText: "Pedro juega; correo said@example.com",
    identifiersToRedact: ["Pedro"],
    actionSchemaVersion: "round-setup-v1",
    questionCount: 0,
    confidence: 0.95,
    startedAt: NOW,
  });
  assert.ok(interaction);
  assert.equal(interaction.redactedInput, "[REDACTED] juega; correo [REDACTED_EMAIL]");
  assert.equal(interaction.trainingUse, "EXCLUDED");

  const action = createAIAction({
    id: "action-1",
    ownerId: "user-1",
    interactionId: interaction.id,
    actionType: "PATCH_ROUND_SETUP",
    targetPath: "/bets/skins/value",
    proposedPayload: 200,
    validatedPayload: 200,
    confidence: 0.95,
    evidence: [{ source: "USER_CONFIRMED", confidence: 1 }],
    validationStatus: "EXECUTED",
    deterministicEngineVersion: "existing-engine-v1",
    createdAt: NOW,
    executedAt: NOW,
  });
  assert.ok(action);
  assert.equal(action.validatedPayload, 200);

  const correction = createAICorrection({
    id: "correction-1",
    ownerId: "user-1",
    interactionId: interaction.id,
    actionId: action.id,
    correctionType: "SETUP",
    fieldPath: "/bets/skins/value",
    proposedValue: 100,
    correctedValue: 200,
    source: "USER",
    verified: true,
    createdAt: NOW,
    verifiedAt: NOW,
  });
  assert.ok(correction);
  assert.equal(correction.dataScope, "PERSONAL");
  assert.equal(createAIAction({ ...action, targetPath: "bets/skins/value" }), null);
});

test("unverified events and revoked consent cannot enter the global dataset", () => {
  const event = createPersonalLearningEvent({
    id: "learning-2",
    ownerId: "user-1",
    eventType: "AI_FAILURE",
    verified: false,
    occurredAt: NOW,
    payload: { errorCode: "VISION_TIMEOUT" },
  });
  assert.ok(event);
  const consent: LearningConsent = {
    ...defaultLearningConsent("user-1", "privacy-v1", NOW),
    globalLearningEnabled: true,
    grantedAt: NOW,
  };
  assert.deepEqual(deidentifyLearningEvent(event, consent, { outputId: "global-2", auditId: "audit-2", now: NOW }), {
    ok: false,
    reason: "not_verified",
  });
  assert.deepEqual(deidentifyLearningEvent({ ...event, verified: true }, { ...consent, revokedAt: NOW }, { outputId: "global-2", auditId: "audit-2", now: NOW }), {
    ok: false,
    reason: "consent_revoked",
  });
});

test("scorecard corrections store opaque player references and produce structured learning", () => {
  const correction = createScorecardCorrection({
    id: "score-correction-1",
    ownerId: "user-1",
    interactionId: "interaction-1",
    roundId: "round-1",
    roundPlayerId: "round-player-2",
    hole: 14,
    extractedScore: 6,
    correctedScore: 5,
    confidence: 0.61,
    source: "VISION",
    reason: "LOW_CONFIDENCE",
    createdAt: NOW,
  });
  assert.ok(correction);
  const event = scorecardCorrectionLearningEvent(correction, "learning-score-1");
  assert.ok(event);
  assert.deepEqual(event.payload, {
    hole: 14,
    extractedScore: 6,
    correctedScore: 5,
    confidence: 0.61,
    source: "VISION",
    reason: "LOW_CONFIDENCE",
  });
  assert.equal(createScorecardCorrection({ ...correction, hole: 19 }), null);
});

test("learning ledger is bounded, recoverable and never accepts another owner", () => {
  const key = learningRecordsStorageKey("user-1");
  assert.ok(key);
  const storage = memoryStorage({ [key as string]: "not-json" });
  const recovered = readLearningRecords(storage, "user-1", NOW);
  assert.equal(recovered.ok, true);
  if (recovered.ok) assert.equal(recovered.recoveredMalformed, true);
  const event = createPersonalLearningEvent({
    id: "learning-3",
    ownerId: "user-1",
    eventType: "PREFERENCE_CONFIRMED",
    verified: true,
    occurredAt: NOW,
    payload: { fieldPath: "/bets/skins/value", correctedValue: 200 },
  });
  assert.ok(event);
  assert.equal(appendLearningRecord(storage, "user-1", event, NOW).ok, true);
  assert.equal(readLearningRecords(storage, "user-1", NOW).document.items.length, 1);
  const wrongOwner = appendLearningRecord(storage, "user-2", event, NOW);
  assert.equal(wrongOwner.ok, false);
  if (!wrongOwner.ok) assert.equal(wrongOwner.error, "invalid_record");
});

test("consent storage is account scoped and malformed state falls back to opt-out", () => {
  const key = learningConsentStorageKey("user-1");
  assert.ok(key);
  const storage = memoryStorage({ [key as string]: "{}" });
  const recovered = readLearningConsent(storage, "user-1", "privacy-v2", NOW);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.consent.globalLearningEnabled, false);
  if (recovered.ok) assert.equal(recovered.recoveredMalformed, true);
  const allowed: LearningConsent = { ...recovered.consent, globalLearningEnabled: true, grantedAt: NOW };
  assert.equal(writeLearningConsent(storage, allowed).ok, true);
  assert.equal(readLearningConsent(storage, "user-1", "privacy-v2", NOW).consent.globalLearningEnabled, true);
  assert.equal(readLearningConsent(storage, "user-1", "privacy-v3", NOW).consent.globalLearningEnabled, false);
});

test("personal AI deletion is idempotent and returns an auditable result", () => {
  const storage = memoryStorage();
  for (const key of [userPreferenceStorageKey("user-1"), learningConsentStorageKey("user-1"), learningRecordsStorageKey("user-1"), personalKnowledgeStorageKey("user-1"), backyardAiMetricsStorageKey("user-1")]) {
    assert.ok(key);
    storage.setItem(key as string, "private");
  }
  const audit = deletePersonalAiData(storage, "user-1", NOW);
  assert.equal(audit.complete, true);
  assert.equal(audit.removedNamespaces.length, 6);
  assert.equal(storage.values.size, 0);
  assert.equal(deletePersonalAiData(storage, "user-1", NOW).complete, true);
});

test("observability keeps only aggregates and calculates Phase 1 quality metrics", () => {
  let metrics = emptyBackyardAiMetrics(NOW);
  metrics = recordRoundSetupMetrics(metrics, { success: true, corrections: 1, questionCount: 2, durationMs: 1_000, confidence: 0.8, now: NOW });
  metrics = recordRoundSetupMetrics(metrics, { success: false, corrections: 3, questionCount: 1, durationMs: 3_000, confidence: 0.4, now: NOW });
  metrics = recordScorecardMetrics(metrics, { detectedCells: 72, correctedCells: 2, averageConfidence: 0.9, now: NOW });
  metrics = recordScorecardOutcomeMetrics(metrics, { outcome: "result", photoToResultMs: 500, now: NOW });
  metrics = recordScorecardOutcomeMetrics(metrics, { outcome: "failure", now: NOW });
  metrics = recordRoundCompletionMetric(metrics, true, NOW);
  metrics = recordRoundCompletionMetric(metrics, false, NOW);
  const summary = summarizeBackyardAiMetrics(metrics);
  assert.equal(summary.aiSetupSuccessRate, 0.5);
  assert.equal(summary.averageSetupCorrections, 2);
  assert.equal(summary.averageQuestionsBeforeConfirmation, 1.5);
  assert.equal(summary.scorecardCellsDetected, 72);
  assert.equal(summary.scorecardCorrectionRate, 2 / 72);
  assert.equal(summary.roundCompletionRate, 0.5);
  assert.equal(summary.aiFailureRate, 1 / 3);
  assert.equal(summary.averageTimeToCreateRoundMs, 2_000);
  assert.equal(summary.averagePhotoToResultMs, 500);
  assert.ok(summary.averageConfidence !== null && summary.averageConfidence > 0.89 && summary.averageConfidence < 0.9);

  const serialized = JSON.stringify(metrics).toLocaleLowerCase("en-US");
  for (const forbidden of ["prompt", "player", "roundid", "photoreference", "ownerid", "name"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("metrics storage is fail-soft and refuses to overwrite after a read failure", () => {
  let writes = 0;
  const broken = {
    getItem() { throw new Error("denied"); },
    setItem() { writes += 1; },
  };
  const result = updateBackyardAiMetrics(broken, "user-1", (current) => recordRoundCompletionMetric(current, true, NOW), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.error, "storage_read_failed");
  assert.equal(writes, 0);
  assert.equal(readBackyardAiMetrics(broken, "user-1", NOW).ok, false);
});
