import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("initial consent is embedded in onboarding instead of gating app entry", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  const provider = source("app/components/account-provider.tsx");
  assert.match(consent, /export function InitialOnboardingConsents/);
  assert.match(onboarding, /<InitialOnboardingConsents/);
  assert.match(onboarding, /disabled=\{!entryMode \|\| !initialConsentsReady\}/);
  assert.doesNotMatch(provider, /AccountConsentCheckpoint/);
  assert.doesNotMatch(provider, /requiresAccountConsent/);
  assert.match(provider, /return app;/);
});

test("required legal and optional betting/AI choices use the existing persistence APIs", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  for (const copy of ["Términos y Condiciones", "Aviso de Privacidad", "18 años", "apuestas, resultados y gastos", "Seleccionar todo"]) assert.match(consent, new RegExp(copy));
  assert.match(consent, /saveRemoteAiConsentDecisions/);
  assert.match(consent, /await onAcceptLegal\(betting\)/);
  assert.match(consent, /accepted: choices\[scope\] === true/);
  assert.match(consent, /Opcional para las demás funciones/);
});

test("AI outage is fail-closed and does not block the rest of onboarding", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  assert.match(consent, /Continuar sin IA/);
  assert.match(consent, /ninguna función de IA queda autorizada/);
  assert.match(consent, /if \(legalRequired\) await onAcceptLegal\(betting\)/);
  assert.doesNotMatch(consent, /localStorage/);
});

test("removed full-screen consent copy cannot reappear after onboarding", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  assert.doesNotMatch(consent, /ANTES DE EMPEZAR/);
  assert.doesNotMatch(consent, /CONTINUAR A THE BACKYARD/);
  assert.doesNotMatch(consent, /children: ReactNode/);
  assert.doesNotMatch(consent, /<main/);
});

test("betting consent is requested only by a betting action, not automatically after account entry", () => {
  const provider = source("app/components/account-provider.tsx");
  assert.match(provider, /const requestBettingConsent = useCallback/);
  assert.doesNotMatch(provider, /bettingConsentPromptStorageKey\(identity\.userId\)[^\n]+=== "seen"[^\n]+setBettingConsentOpen\(true\)/);
  assert.match(provider, /bettingConsentRequest\.current/);
});
