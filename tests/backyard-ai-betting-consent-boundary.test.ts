import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  roundSetupChangeContainsBettingData,
  runBettingDataActionWithConsent,
  runRoundSetupActionWithBettingConsent,
} from "../lib/backyard-ai/runtime/betting-consent-boundary";
import { createRoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";
import { initialBets, restoreBetConfig } from "../lib/new-round-bets";

function scoreOnlyDraft() {
  return createRoundSetupDraft({
    date: "2026-09-08",
    players: [{ id: "said", name: "Said Abaid", handicap: 8 }],
    ownerId: "said",
  });
}

test("una ronda sólo-score se aplica sin solicitar consentimiento de apuestas", () => {
  const draft = scoreOnlyDraft();
  let applied = 0;
  let requested = 0;

  const outcome = runRoundSetupActionWithBettingConsent(
    draft,
    () => { applied += 1; },
    () => { requested += 1; },
  );

  assert.equal(outcome, "APPLIED");
  assert.equal(applied, 1);
  assert.equal(requested, 0);
  assert.equal(roundSetupChangeContainsBettingData({ previousDraft: draft, nextDraft: draft, actions: [] }), false);
});

test("una ronda con apuestas espera el consentimiento antes de aplicar o persistir", () => {
  const previousDraft = scoreOnlyDraft();
  const bettingDraft = structuredClone(previousDraft);
  bettingDraft.bets.skins.enabled = true;
  bettingDraft.bets.skins.value = 200;
  let applied = 0;
  let resume: (() => void) | undefined;

  const outcome = runRoundSetupActionWithBettingConsent(
    bettingDraft,
    () => { applied += 1; },
    (pending) => { resume = pending; },
  );

  assert.equal(outcome, "CONSENT_REQUIRED");
  assert.equal(applied, 0);
  assert.ok(resume);
  resume();
  assert.equal(applied, 1);
  assert.equal(roundSetupChangeContainsBettingData({
    previousDraft,
    nextDraft: bettingDraft,
    actions: [{
      type: "configure_core_bet",
      bet: "skins",
      enabled: true,
      value: 200,
      source: "explicit",
      confidence: 1,
      evidence: "Skins de 200",
    }],
  }), true);
});

test("Card AI con apuestas restauradas no muta scores hasta aceptar; cancelar conserva todo intacto", async () => {
  const playerIds = ["said", "pedro"];
  const defaults = initialBets(playerIds);
  const restoredBets = restoreBetConfig({
    skins: { ...defaults.skins, enabled: true, value: 200 },
  }, playerIds, { startHole: 1, roundHoles: 18 });
  const originalScores: Record<number, Record<string, number>> = { 1: { said: 4, pedro: 5 } };
  let scores: Record<number, Record<string, number>> = structuredClone(originalScores);
  let persisted = 0;
  let resolveConsent: ((accepted: boolean) => void) | undefined;
  const requestConsent = () => new Promise<boolean>((resolve) => { resolveConsent = resolve; });
  const applyConfirmedCard = () => {
    persisted += 1;
    scores = { ...scores, 2: { said: 5, pedro: 4 } };
    return true;
  };

  const cancelled = runBettingDataActionWithConsent(restoredBets.skins.enabled, applyConfirmedCard, requestConsent);
  await Promise.resolve();
  assert.ok(resolveConsent);
  assert.equal(persisted, 0);
  assert.deepEqual(scores, originalScores);
  resolveConsent(false);
  assert.deepEqual(await cancelled, { status: "CONSENT_CANCELLED" });
  assert.equal(persisted, 0);
  assert.deepEqual(scores, originalScores);

  const accepted = runBettingDataActionWithConsent(restoredBets.skins.enabled, applyConfirmedCard, requestConsent);
  await Promise.resolve();
  assert.equal(persisted, 0);
  assert.deepEqual(scores, originalScores);
  resolveConsent(true);
  assert.deepEqual(await accepted, { status: "APPLIED", value: true });
  assert.equal(persisted, 1);
  assert.deepEqual(scores, { ...originalScores, 2: { said: 5, pedro: 4 } });
});

test("Card AI sólo-score aplica sin abrir el consentimiento B", async () => {
  let requested = 0;
  let applied = 0;
  const outcome = await runBettingDataActionWithConsent(
    false,
    () => { applied += 1; return true; },
    async () => { requested += 1; return false; },
  );

  assert.deepEqual(outcome, { status: "APPLIED", value: true });
  assert.equal(applied, 1);
  assert.equal(requested, 0);
});

test("AiRoundSetup sólo exige el consentimiento AI; app/page conserva el gate B al aplicar", () => {
  const setupSource = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  const scannerSource = readFileSync("app/components/backyard-ai/scorecard-scanner.tsx", "utf8");
  const pageSource = readFileSync("app/page.tsx", "utf8");

  assert.doesNotMatch(setupSource, /onRequireBettingConsent|bettingConsentGranted/);
  assert.match(setupSource, /hasActiveAiProcessingConsent/);
  assert.match(pageSource, /runRoundSetupActionWithBettingConsent\(draft, start, runAfterBettingConsent\)/);
  assert.match(pageSource, /runRoundSetupActionWithBettingConsent\(draft, edit, runAfterBettingConsent\)/);
  assert.match(pageSource, /roundSetupChangeContainsBettingData/);
  assert.match(pageSource, /hasActiveBettingData=\{hasActiveBettingConfiguration\(\)\}/);
  assert.match(pageSource, /requestBettingConsent=\{requestBettingConsent\}/);
  assert.match(scannerSource, /runBettingDataActionWithConsent\([\s\S]*?if \(!mounted\.current\) return false;[\s\S]*?onApply\(/);
});
