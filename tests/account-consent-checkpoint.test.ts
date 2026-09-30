import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("initial consent is embedded in onboarding and canonical unresolved eligibility cannot escape on reload", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  const provider = source("app/components/account-provider.tsx");
  assert.match(consent, /export function InitialOnboardingConsents/);
  assert.match(onboarding, /<InitialOnboardingConsents/);
  assert.match(onboarding, /\{entryMode && <div ref=\{consentSectionRef\}/);
  assert.match(onboarding, /canContinue=\{Boolean\(entryMode\)\}/);
  assert.doesNotMatch(onboarding, /initialBettingDecision|onResolveBetting/);
  assert.match(onboarding, /actions=\{null\}/);
  assert.match(provider, /saved\.eligible && !saved\.resolved/);
  assert.match(provider, /!betaOnboardingRequired && optionalAuthorizationRequired/);
  assert.match(provider, /<InitialOnboardingConsents/);
  assert.match(provider, /optionalAuthorizationCheck !== "ready"/);
  assert.match(provider, /No pudimos consultar el registro canónico/);
  assert.match(provider, /return app;/);
});

test("required legal and the atomic optional bundle are explicit and separate", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  for (const copy of ["Términos y Condiciones", "Aviso de Privacidad", "mayoría de edad", "CONSENTIMIENTOS REQUERIDOS", "FUNCIONES OPCIONALES DE THE BACKYARD"]) assert.match(consent, new RegExp(copy));
  for (const included of ["texto o dictado", "fotos e imágenes", "launch monitor", "Memoria personal", "learning global", "Perfil público", "actividad compartida", "Uso interno de ubicación y notificaciones"]) assert.match(consent, new RegExp(included, "i"));
  assert.match(consent, /AUTORIZAR TODO Y CONTINUAR/);
  assert.match(consent, /ACEPTAR REQUERIDOS/);
  assert.match(consent, /NO ACEPTO/);
  assert.match(consent, /CONTINUAR SIN AUTORIZAR/);
  assert.match(consent, /Marketing y datos financieros\/patrimoniales no forman parte/);
  assert.doesNotMatch(consent, /FUNCIONES DE APUESTAS|ACTIVAR APUESTAS/);
  assert.doesNotMatch(consent, /type="checkbox"/);
  assert.match(consent, /resolveOptionalAuthorizationBundle/);
  assert.match(consent, /isCompleteBundleResolution/);
  assert.match(consent, /Autorización inicial registrada; conservamos tus cambios posteriores/);
  assert.match(consent, /await onAcceptRequired\(\)/);
  assert.doesNotMatch(consent, /onResolveBetting|initialBettingDecision/);
});

test("optional bundle is idempotent, verified before success and fails closed", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  assert.match(consent, /authorizationRequestKey/);
  assert.match(consent, /declineRequestKey/);
  assert.match(consent, /crypto\.randomUUID\(\)/);
  assert.match(consent, /const action = accepted \? "authorize_all" as const : "decline_all" as const/);
  assert.match(consent, /if \(!isCompleteBundleResolution\(saved, action\)\) throw/);
  assert.match(consent, /No pudimos confirmar si el conjunto se guardó/);
  assert.match(consent, /usaremos la misma solicitud y no duplicaremos decisiones/);
  assert.match(consent, /const latest = await requestOptionalAuthorizationState/);
  assert.match(consent, /if \(!latest\.eligible\)/);
  assert.match(consent, /Otra decisión explícita ya fue registrada/);
  assert.match(consent, /required !== "accepted" \|\| !canContinue/);
  assert.doesNotMatch(consent, /saveRemoteAiConsentDecisions|AI_PROCESSING_CONSENT_SCOPES/);
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
