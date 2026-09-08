import assert from "node:assert/strict";
import test from "node:test";

import {
  aiProcessingConsentLedgerAccess,
  backyardAiConfig,
  DEFAULT_BACKYARD_AI_MODEL,
  publicBackyardAiStatus,
} from "../lib/backyard-ai/server/config";
import { consumeBackyardAiLimit, resetBackyardAiLimitsForTests } from "../lib/backyard-ai/server/rate-limit";

const configuredEnvironment = {
  BACKYARD_AI_ENABLED: "true",
  OPENAI_API_KEY: "top-secret",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

test("Backyard AI server status never exposes the API key", () => {
  const status = publicBackyardAiStatus(configuredEnvironment);
  assert.deepEqual(status, { enabled: true, configured: true, state: "ready" });
  assert.equal(JSON.stringify(status).includes("top-secret"), false);

  assert.deepEqual(
    publicBackyardAiStatus({ ...configuredEnvironment, BACKYARD_AI_ENABLED: undefined }),
    { enabled: false, configured: true, state: "disabled" },
    "una llave presente no habilita endpoints nuevos sin opt-in explícito",
  );
});

test("Backyard AI model selection supports overrides and a safe default", () => {
  assert.equal(backyardAiConfig({ OPENAI_API_KEY: "x" }).ready, false, "los endpoints nuevos requieren opt-in explícito");
  assert.equal(backyardAiConfig({ ...configuredEnvironment, OPENAI_API_KEY: "x" }).ready, true);
  assert.equal(backyardAiConfig({ BACKYARD_AI_ENABLED: "true", OPENAI_API_KEY: "x" }).ready, false, "el límite distribuido también es obligatorio");
  assert.equal(backyardAiConfig({ OPENAI_API_KEY: "x" }).roundSetupModel, DEFAULT_BACKYARD_AI_MODEL);
  assert.equal(backyardAiConfig({ OPENAI_API_KEY: "x", OPENAI_RULES_MODEL: "rules-model" }).scorecardModel, "rules-model");
  assert.equal(backyardAiConfig({ OPENAI_API_KEY: "x", OPENAI_BACKYARD_MODEL: "round-model", OPENAI_SCORECARD_MODEL: "vision-model" }).scorecardModel, "vision-model");
  assert.equal(backyardAiConfig({ BACKYARD_AI_ENABLED: "false", OPENAI_API_KEY: "x" }).ready, false);
});

test("el ledger AI autenticado queda fail-closed en Preview y Guest no se rompe", () => {
  const inheritedProduction = {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: "https://shared-production.supabase.co",
  };
  assert.deepEqual(
    aiProcessingConsentLedgerAccess(inheritedProduction, true),
    { allowed: false, reason: "preview_binding_missing" },
    "las credenciales cloud heredadas no bastan para tocar el ledger nuevo",
  );
  assert.deepEqual(
    aiProcessingConsentLedgerAccess({
      ...inheritedProduction,
      BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL: "https://isolated-preview.supabase.co",
    }, true),
    { allowed: false, reason: "preview_binding_mismatch" },
  );
  assert.deepEqual(
    aiProcessingConsentLedgerAccess({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://isolated-preview.supabase.co/",
      BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL: "https://isolated-preview.supabase.co",
    }, true),
    { allowed: true, reason: "preview_bound" },
  );
  assert.deepEqual(
    aiProcessingConsentLedgerAccess(inheritedProduction, false),
    { allowed: true, reason: "guest" },
    "Guest no consulta ni escribe el ledger server-side",
  );
  assert.deepEqual(
    aiProcessingConsentLedgerAccess({ ...inheritedProduction, VERCEL_ENV: "production" }, true),
    { allowed: true, reason: "not_preview" },
  );
});

test("Backyard AI process limiter resets after its window", () => {
  resetBackyardAiLimitsForTests();
  assert.equal(consumeBackyardAiLimit("ip", 2, 1_000, 100), true);
  assert.equal(consumeBackyardAiLimit("ip", 2, 1_000, 200), true);
  assert.equal(consumeBackyardAiLimit("ip", 2, 1_000, 300), false);
  assert.equal(consumeBackyardAiLimit("ip", 2, 1_000, 1_101), true);
});
