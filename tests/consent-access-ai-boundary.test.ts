import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { authUserFailure } from "../lib/auth-errors";
import * as privacy from "../lib/backyard-ai/privacy";
import * as security from "../lib/backyard-ai/server/http-security";
import * as photoRequest from "../lib/backyard-ai/server/scorecard-request";
import * as records from "../lib/backyard-ai/consent-record";
import * as canonical from "../lib/backyard-ai/runtime/canonical-command-guard";
import * as intentParser from "../lib/backyard-ai/runtime/intent-parser";
import * as providerSetup from "../lib/backyard-ai/runtime/provider-round-setup";
import { resolveAuthoritativeAiProcessingConsent } from "../lib/backyard-ai/consent-client";
import { acceptAiProcessingConsent, hasActiveAiProcessingConsent } from "../lib/backyard-ai/processing-consent";

const OWNER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "synthetic-authenticated-test-token";
const WHEN = "2026-09-16T12:00:00.000Z";
type LedgerOutcome = "missing" | "declined" | "revoked" | "migration_missing" | "database_500" | "environment_unavailable" | "accepted";

/** Runs the production route and production authorization verifier together.
 * Only Auth/DB/provider boundaries are synthetic; never contacts a real provider or DB. */
function providerBoundary(outcome: LedgerOutcome) {
  let providerCalls = 0;
  let ledgerReads = 0;
  const scopes: string[] = [];
  const admin = { from(table: string) {
    assert.equal(table, records.AI_PROCESSING_CONSENT_TABLE);
    const query = {
      select: () => query,
      eq(key: string, value: unknown) {
        if (key === "user_id") assert.equal(value, OWNER);
        if (key === "scope") scopes.push(String(value));
        if (key === "policy_version") assert.equal(value, privacy.BACKYARD_AI_PROVIDER_CONSENT_VERSION);
        return query;
      },
      order: () => query, limit: () => query,
      async maybeSingle() {
        ledgerReads++;
        return {
          error: outcome === "migration_missing" ? { code: "42P01" } : outcome === "database_500" ? { code: "XX000" } : null,
          data: outcome === "missing" ? null : {
            decision_status: outcome === "accepted" ? "accepted" : outcome,
            accepted_at: outcome === "declined" ? null : WHEN,
            revoked_at: outcome === "revoked" ? WHEN : null,
          },
        };
      },
    };
    return query;
  } };
  const userClient = { auth: { async getUser(token: string) {
    assert.equal(token, TOKEN);
    return { data: { user: { id: OWNER, is_anonymous: false } }, error: null };
  } } };
  let verifier: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  function load(path: string) {
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(compiled, {
      exports, Request, Response, Date,
      console: { info() {}, error() {}, warn() {} },
      process: { env: { OPENAI_API_KEY: "synthetic-no-network-test-key" } },
      require(id: string) {
        if (id === "server-only") return {};
        if (id === "node:crypto") return { createHmac };
        if (id === "next/server") return { NextResponse: Response };
        if (id === "openai") return { default: class SyntheticProvider {} };
        if (id.endsWith("/consent-record")) return records;
        if (id.endsWith("/privacy")) return privacy;
        if (id.endsWith("/http-security")) return security;
        if (id.endsWith("/scorecard-request")) return photoRequest;
        if (id.endsWith("/auth-errors")) return { authUserFailure };
        if (id.endsWith("/account-access.server")) return { accountAccessFailure: async () => null };
        if (id.endsWith("/processing-consent")) return verifier;
        if (id.endsWith("/supabase/server")) return { getSupabaseAdmin: () => admin, getSupabaseForUser: () => userClient };
        if (id.endsWith("/config")) return {
          backyardAiConfig: () => ({ enabled: true, configured: true, roundSetupModel: "synthetic" }),
          aiProcessingConsentLedgerAccess: () => ({ allowed: outcome !== "environment_unavailable" }),
        };
        if (id.endsWith("/canonical-command-guard")) return canonical;
        if (id.endsWith("/intent-parser")) return intentParser;
        if (id.endsWith("/provider-round-setup")) return providerSetup;
        if (id.endsWith("/bets/registry")) return { BET_REGISTRY: [] };
        if (id.endsWith("/rate-limit")) return { consumeBackyardAiLimit: () => true };
        if (id.endsWith("/rules-ai-rate-limit")) return { consumePersistentRulesAiLimit: async () => true };
        if (id.endsWith("/openai-structured")) return {
          generateBackyardAiJson: async () => { providerCalls++; return { canonicalCommand: "Jugamos Said", confidence: 1, clarification: null }; },
          classifyBackyardAiFailure: () => ({ code: "provider_failure", message: "Provider failure", status: 502 }),
        };
        if (id.endsWith("/scorecard/extractor")) return {};
        throw new Error(`Unexpected dependency ${id}`);
      },
    });
    return exports;
  }
  verifier = load("lib/backyard-ai/server/processing-consent.ts");
  return {
    scopes,
    providerCalls: () => providerCalls,
    ledgerReads: () => ledgerReads,
    async run(route: "round-setup" | "scorecard") {
      const scope = route === "scorecard" ? privacy.AI_IMAGE_PROCESSING_CONSENT : privacy.AI_PROVIDER_PROCESSING_CONSENT;
      const request = new Request(`https://preview.invalid/api/backyard-ai/${route}`, {
        method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ ...(route === "scorecard" ? { photos: [] } : { input: "Jugamos Said" }), consent: privacy.backyardAiProviderConsent(scope) }),
      });
      return await load(`app/api/backyard-ai/${route}/route.ts`).POST(request) as Response;
    },
  };
}

for (const route of ["round-setup", "scorecard"] as const) {
  for (const outcome of ["missing", "declined", "revoked", "migration_missing", "database_500", "environment_unavailable"] as const) {
    test(`application access cannot authorize ${route}: ${outcome} denies provider server-side`, async () => {
      const boundary = providerBoundary(outcome);
      const response = await boundary.run(route);
      const unavailable = ["migration_missing", "database_500", "environment_unavailable"].includes(outcome);
      assert.equal(response.status, unavailable ? 503 : 403);
      const body = await response.json();
      assert.equal(body.code, outcome === "environment_unavailable" ? "consent_environment_blocked" : unavailable ? "consent_store_unavailable" : "consent_required");
      assert.equal(boundary.providerCalls(), 0);
      assert.equal(boundary.ledgerReads(), outcome === "environment_unavailable" ? 0 : 1);
      if (outcome !== "environment_unavailable") assert.deepEqual(boundary.scopes, [route === "scorecard" ? privacy.AI_IMAGE_PROCESSING_CONSENT : privacy.AI_PROVIDER_PROCESSING_CONSENT]);
    });
  }
}

test("positive control: current stored consent reaches the round provider exactly once", async () => {
  const boundary = providerBoundary("accepted");
  const response = await boundary.run("round-setup");
  assert.equal(response.status, 200);
  assert.equal(boundary.providerCalls(), 1);
  assert.equal(boundary.ledgerReads(), 1);
});

for (const scope of [privacy.AI_PROVIDER_PROCESSING_CONSENT, privacy.AI_IMAGE_PROCESSING_CONSENT]) {
  for (const failure of ["http_500", "missing_migration", "network"] as const) {
    test(`prior browser acceptance never enables ${scope} after ${failure}`, async () => {
      const values = new Map<string, string>();
      const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
      assert.equal(acceptAiProcessingConsent(storage, OWNER, scope, WHEN).ok, true);
      assert.equal(hasActiveAiProcessingConsent(storage, OWNER, scope), true);
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(String(url), `/api/backyard-ai/consent?scope=${scope}`);
        assert.equal(init?.cache, "no-store");
        if (failure === "network") throw new TypeError("Network unavailable");
        return Response.json({ code: "consent_store_unavailable", error: "Unavailable" }, { status: failure === "http_500" ? 500 : 503 });
      };
      try {
        await assert.rejects(resolveAuthoritativeAiProcessingConsent({ accessToken: TOKEN, userId: OWNER, scope, storage }));
        assert.equal(calls, 1, "authoritative lookup runs despite an old accepted browser cache");
      } finally { globalThis.fetch = originalFetch; }
    });
  }
}
