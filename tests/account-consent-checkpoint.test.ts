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
  assert.match(onboarding, /canContinue=\{Boolean\(entryMode\)\}/);
  assert.doesNotMatch(onboarding, /initialBettingDecision|onResolveBetting/);
  assert.match(onboarding, /actions=\{null\}/);
  assert.doesNotMatch(provider, /AccountConsentCheckpoint/);
  assert.doesNotMatch(provider, /requiresAccountConsent/);
  assert.match(provider, /return app;/);
});

test("required legal and optional AI choices are grouped without asking about bets", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  for (const copy of ["Términos y Condiciones", "Aviso de Privacidad", "mayoría de edad", "CONSENTIMIENTOS REQUERIDOS", "AUTORIZACIONES DE BACKYARD AI"]) assert.match(consent, new RegExp(copy));
  assert.match(consent, /AUTORIZAR LAS 3 FUNCIONES DE IA/);
  assert.match(consent, /ACEPTAR TODO Y CONTINUAR/);
  assert.match(consent, /NO ACEPTO/);
  assert.match(consent, /AHORA NO/);
  assert.doesNotMatch(consent, /FUNCIONES DE APUESTAS|ACTIVAR APUESTAS|apuestas, resultados y gastos/);
  assert.doesNotMatch(consent, /type="checkbox"/);
  assert.match(consent, /saveRemoteAiConsentDecisions/);
  assert.match(consent, /AI_PROCESSING_CONSENT_SCOPES\.map/);
  assert.match(consent, /await onAcceptRequired\(\)/);
  assert.doesNotMatch(consent, /onResolveBetting|initialBettingDecision/);
});

test("AI outage is fail-closed and Ahora no records all three declined scopes", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  assert.match(consent, /AI_PROCESSING_CONSENT_SCOPES\.map\(\(scope\) => \(\{ scope, accepted \}\)\)/);
  assert.match(consent, /se pedirá autorización contextual al usar IA/);
  assert.match(consent, /disabled=\{!resolved \|\| !canContinue/);
  assert.doesNotMatch(consent, /localStorage/);
});

test("guest onboarding also omits betting permission", () => {
  const provider = source("app/components/account-provider.tsx");
  const start = provider.indexOf("function ConsentScreen");
  const end = provider.indexOf("function ProfileSetupScreen", start);
  const guest = provider.slice(start, end);
  assert.doesNotMatch(guest, /type="checkbox"/);
  assert.match(guest, /ACEPTAR TODO Y CONTINUAR/);
  assert.doesNotMatch(guest, /FUNCIONES DE APUESTAS|ACTIVAR APUESTAS|financial|apuestas/i);
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

test("betting state remains contextual and is not passed into onboarding", () => {
  const provider = source("app/components/account-provider.tsx");
  assert.match(provider, /hasResolvedFinancialChoice\(legalEvidenceEvents, legacyBettingConsent, legalEvidenceResolved\)/);
  assert.doesNotMatch(provider, /const financialConsentResolved = legalEvidenceResolved \|\|/);
  assert.doesNotMatch(provider, /initialBettingDecision=|onResolveBetting=/);
  assert.match(provider, /requestBettingConsent/);
});
