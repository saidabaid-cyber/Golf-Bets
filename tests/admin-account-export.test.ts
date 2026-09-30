import assert from "node:assert/strict";
import * as cryptoModule from "node:crypto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

import * as accountExportModule from "../lib/account-data-export";
import * as securityModule from "../lib/backyard-ai/server/http-security";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function accountAuditFingerprint(accountId: string) {
  return createHash("sha256")
    .update(`the-backyard:account-privacy-export:v1:${accountId.toLocaleLowerCase("en-US")}`, "utf8")
    .digest("hex");
}

type RouteExports = {
  GET?: (request: Request) => Promise<Response>;
  POST?: (request: Request) => Promise<Response>;
};

function loadRoute(file: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: RouteExports = {};
  runInNewContext(compiled, {
    exports,
    Request,
    Response,
    Headers,
    AbortSignal,
    TextDecoder,
    URL,
    Date,
    Buffer,
    setTimeout,
    clearTimeout,
    console,
    process: { env: { NODE_ENV: "test" } },
    require: (id: string) => {
      if (id === "server-only") return {};
      if (id === "node:crypto") return cryptoModule;
      if (id === "next/server") return { NextResponse: Response };
      if (id.endsWith("/account-data-export")) return accountExportModule;
      if (id.endsWith("/backyard-ai/server/http-security")) return securityModule;
      if (id.endsWith("/runtime-environment")) return { resolveCanonicalDataEnvironment: () => "test" };
      if (id in dependencies) return dependencies[id];
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  return exports;
}

function membershipClient(rows: unknown[], error: unknown = null) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select() { return query; },
    eq(field: string, value: unknown) { filters.push([field, value]); return query; },
    is(field: string, value: unknown) { filters.push([field, value]); return query; },
    limit: async () => ({ data: rows, error }),
  };
  return {
    filters,
    client: { from: (table: string) => {
      assert.equal(table, "admin_memberships");
      return query;
    } },
  };
}

function serviceClient(options: { failRead?: string; failSuccessAudit?: boolean; missingProfile?: boolean } = {}) {
  const filters: Array<[string, string, unknown]> = [];
  const audits: Array<Record<string, unknown>> = [];
  const rows: Record<string, unknown> = {
    profiles: options.missingProfile ? null : { display_name: "Persona objetivo", username: "objetivo", access_token: "never-export" },
    social_profiles: { privacy: "PUBLIC", username: "objetivo", access_token: "never-export" },
    user_preferences: { locale: "es-MX", high_contrast: true, refresh_token: "never-export" },
    social_activity_preferences_v3: { share_rounds: true, share_achievements: true, secret: "never-export" },
    legal_acceptances: [{ type: "terms", version: "v2" }],
    legal_evidence_events: [{ environment: "test", purpose_key: "terms", action: "accepted" }],
    ai_processing_consents: [{ scope: "AI_PROVIDER_PROCESSING_CONSENT", decision_status: "accepted" }],
    optional_authorization_events: [{ scope: "PERSONAL_MEMORY", decision_status: "accepted", policy_version: "ai-first-phase1-v1" }],
    optional_authorization_bundle_receipts: [{
      bundle_version: "optional-features-2026-09-30-v1",
      action: "authorize_all",
      feature_set: {
        scopes: [
          { scope: "AI_PROVIDER_PROCESSING_CONSENT", policyVersion: "2026-09-08-v2", secret: "never-export" },
          { scope: "AI_IMAGE_PROCESSING_CONSENT", policyVersion: "2026-09-08-v2" },
          { scope: "AI_LAUNCH_MONITOR_PROCESSING_CONSENT", policyVersion: "2026-09-08-v2" },
          { scope: "PERSONAL_MEMORY", policyVersion: "ai-first-phase1-v1" },
          { scope: "GLOBAL_LEARNING", policyVersion: "ai-first-phase1-v1" },
          { scope: "LOCATION_INTERNAL", policyVersion: "optional-features-2026-09-30-v1" },
          { scope: "NOTIFICATION_INTERNAL", policyVersion: "optional-features-2026-09-30-v1" },
        ],
        excluded: ["MARKETING", "FINANCIAL_PATRIMONIAL"],
        projections: {
          profileVisibility: "public",
          socialPrivacy: "FRIENDS",
          socialProfilePrivacy: "PUBLIC",
          sharing: {
            enabledForFriends: true,
            rounds: true,
            achievements: true,
            equipment: true,
            courses: true,
          },
          notifications: {
            internal: true,
            master: true,
            push: true,
            email: true,
            rounds: true,
            reminders: true,
          },
        },
        secret: "never-export",
      },
      private_note: "never-export",
    }],
  };
  const client = { from: (table: string) => {
    if (table === "admin_audit_log") {
      return { insert: async (value: Record<string, unknown>) => {
        audits.push(value);
        const failed = options.failSuccessAudit && value.action === "ACCOUNT_DATA_EXPORT_SUCCESS";
        return { data: null, error: failed ? { code: "AUDIT_DOWN" } : null };
      } };
    }
    assert.ok(Object.hasOwn(rows, table), `unexpected privileged table ${table}`);
    const result = () => ({ data: rows[table], error: options.failRead === table ? { code: "READ_DOWN" } : null });
    const query = {
      select() { return query; },
      eq(field: string, value: unknown) { filters.push([table, field, value]); return query; },
      order() { return query; },
      limit: async () => result(),
      maybeSingle: async () => result(),
    };
    return query;
  } };
  return { client, filters, audits };
}

function adminRequest(body: unknown, origin = "https://dev.thebackyard.com.mx") {
  return new Request("https://dev.thebackyard.com.mx/api/admin/account-export", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-token",
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

test("retired owner endpoint keeps 401 for no session and returns 403 without account-data reads", async () => {
  let tableReads = 0;
  const route = loadRoute("app/api/account/export/route.ts", {
    "../../../../lib/server-auth": {
      authenticatedRequest: async (request: Request) => request.headers.has("authorization")
        ? { ok: true, userId: TARGET_ID, client: { from: () => { tableReads++; throw new Error("must not read"); } } }
        : { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Inicia sesión." },
    },
  });
  const missing = await route.GET!(new Request("https://dev.thebackyard.com.mx/api/account/export"));
  assert.equal(missing.status, 401);
  const authenticated = await route.GET!(new Request("https://dev.thebackyard.com.mx/api/account/export", { headers: { authorization: "Bearer owner-token" } }));
  assert.equal(authenticated.status, 403);
  assert.equal((await authenticated.json()).code, "SELF_SERVICE_EXPORT_DISABLED");
  assert.equal(tableReads, 0);
});

test("admin export rejects cross-site, unknown fields, and a normal membership before privileged reads", async () => {
  let authCalls = 0;
  let privilegedClients = 0;
  const membership = membershipClient([]);
  const route = loadRoute("app/api/admin/account-export/route.ts", {
    "../../../../lib/server-auth": { authenticatedRequest: async () => { authCalls++; return { ok: true, userId: ADMIN_ID, client: membership.client }; } },
    "../../../../lib/supabase/server": { getSupabaseAdmin: () => { privilegedClients++; throw new Error("must not run"); } },
  });
  const crossSite = await route.POST!(adminRequest({ targetUserId: TARGET_ID, reason: "Solicitud ARCO" }, "https://evil.invalid"));
  assert.equal(crossSite.status, 403);
  assert.equal(authCalls, 0);
  const invalid = await route.POST!(adminRequest({ targetUserId: TARGET_ID, reason: "Solicitud ARCO", userId: TARGET_ID }));
  assert.equal(invalid.status, 400);
  const forbidden = await route.POST!(adminRequest({ targetUserId: TARGET_ID, reason: "Solicitud ARCO" }));
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "ADMIN_EXPORT_FORBIDDEN");
  assert.equal(privilegedClients, 0);
  assert.deepEqual(membership.filters, [
    ["user_id", ADMIN_ID],
    ["role", "SUPER_ADMIN"],
    ["scope_type", "GLOBAL"],
    ["scope_id", null],
    ["active", true],
  ]);
});

test("global SUPER_ADMIN receives an allowlisted, hashed export only after SUCCESS audit", async () => {
  const membership = membershipClient([{ id: "membership" }]);
  const service = serviceClient();
  const route = loadRoute("app/api/admin/account-export/route.ts", {
    "../../../../lib/server-auth": { authenticatedRequest: async () => ({ ok: true, userId: ADMIN_ID, client: membership.client }) },
    "../../../../lib/supabase/server": { getSupabaseAdmin: () => service.client },
  });
  const response = await route.POST!(adminRequest({
    targetUserId: TARGET_ID,
    reason: "Solicitud de acceso validada por Privacidad",
    ticketReference: "PRIV-2042",
    requestId: REQUEST_ID,
  }));
  assert.equal(response.status, 200);
  const serialized = await response.text();
  const payload = JSON.parse(serialized);
  const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  assert.equal(response.headers.get("x-content-sha256"), sha256);
  assert.equal(payload.account.userId, TARGET_ID);
  assert.doesNotMatch(serialized, /never-export|access_token|refresh_token|admin-token/);
  assert.deepEqual(service.filters.map(([table, field, value]) => [table, field, value]), [
    ["profiles", "id", TARGET_ID],
    ["social_profiles", "user_id", TARGET_ID],
    ["user_preferences", "user_id", TARGET_ID],
    ["social_activity_preferences_v3", "user_id", TARGET_ID],
    ["legal_acceptances", "user_id", TARGET_ID],
    ["legal_evidence_events", "user_id", TARGET_ID],
    ["legal_evidence_events", "environment", "test"],
    ["ai_processing_consents", "user_id", TARGET_ID],
    ["optional_authorization_events", "user_id", TARGET_ID],
    ["optional_authorization_bundle_receipts", "user_id", TARGET_ID],
  ]);
  assert.equal(service.audits.length, 1);
  const audit = service.audits[0];
  assert.equal(audit.action, "ACCOUNT_DATA_EXPORT_SUCCESS");
  assert.equal(audit.actor_id, ADMIN_ID);
  assert.equal(audit.actor_role, "SUPER_ADMIN");
  assert.equal(audit.entity_id, TARGET_ID);
  assert.equal(audit.reason, "Solicitud de acceso validada por Privacidad");
  assert.equal(audit.request_id, REQUEST_ID);
  const after = audit.after_state as Record<string, unknown>;
  assert.equal(after.environment, "test");
  assert.equal(after.ticketReference, "PRIV-2042");
  assert.equal(after.accountFingerprintVersion, "sha256:account-privacy-export:v1");
  assert.equal(after.requesterAccountFingerprint, accountAuditFingerprint(ADMIN_ID));
  assert.equal(after.subjectAccountFingerprint, accountAuditFingerprint(TARGET_ID));
  assert.equal(Object.hasOwn(after, "actorIdSnapshot"), false);
  assert.equal(Object.hasOwn(after, "targetUserIdSnapshot"), false);
  assert.equal(after.sha256, sha256);
  assert.equal(after.result, "SUCCESS");
  assert.equal(payload.data.optionalAuthorizationEvents.records[0]?.scope, "PERSONAL_MEMORY");
  assert.equal(payload.data.optionalAuthorizationReceipts.records[0]?.action, "authorize_all");
  assert.deepEqual(payload.data.optionalAuthorizationReceipts.records[0]?.feature_set, {
    scopes: [
      { scope: "AI_PROVIDER_PROCESSING_CONSENT", policyVersion: "2026-09-08-v2" },
      { scope: "AI_IMAGE_PROCESSING_CONSENT", policyVersion: "2026-09-08-v2" },
      { scope: "AI_LAUNCH_MONITOR_PROCESSING_CONSENT", policyVersion: "2026-09-08-v2" },
      { scope: "PERSONAL_MEMORY", policyVersion: "ai-first-phase1-v1" },
      { scope: "GLOBAL_LEARNING", policyVersion: "ai-first-phase1-v1" },
      { scope: "LOCATION_INTERNAL", policyVersion: "optional-features-2026-09-30-v1" },
      { scope: "NOTIFICATION_INTERNAL", policyVersion: "optional-features-2026-09-30-v1" },
    ],
    excluded: ["MARKETING", "FINANCIAL_PATRIMONIAL"],
    projections: {
      profileVisibility: "public",
      socialPrivacy: "FRIENDS",
      socialProfilePrivacy: "PUBLIC",
      sharing: {
        enabledForFriends: true,
        rounds: true,
        achievements: true,
        equipment: true,
        courses: true,
      },
      notifications: {
        internal: true,
        master: true,
        push: true,
        email: true,
        rounds: true,
        reminders: true,
      },
    },
  });
});

test("a nonexistent target produces an audited 404 instead of an empty export", async () => {
  const membership = membershipClient([{ id: "membership" }]);
  const service = serviceClient({ missingProfile: true });
  const route = loadRoute("app/api/admin/account-export/route.ts", {
    "../../../../lib/server-auth": { authenticatedRequest: async () => ({ ok: true, userId: ADMIN_ID, client: membership.client }) },
    "../../../../lib/supabase/server": { getSupabaseAdmin: () => service.client },
  });
  const response = await route.POST!(adminRequest({ targetUserId: TARGET_ID, reason: "Solicitud ARCO", requestId: REQUEST_ID }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "ADMIN_EXPORT_TARGET_NOT_FOUND");
  assert.equal(service.audits.length, 1);
  assert.equal(service.audits[0]?.action, "ACCOUNT_DATA_EXPORT_FAILED");
  const after = service.audits[0]?.after_state as Record<string, unknown>;
  assert.equal(after.accountFingerprintVersion, "sha256:account-privacy-export:v1");
  assert.equal(after.requesterAccountFingerprint, accountAuditFingerprint(ADMIN_ID));
  assert.equal(after.subjectAccountFingerprint, accountAuditFingerprint(TARGET_ID));
  assert.equal(Object.hasOwn(after, "actorIdSnapshot"), false);
  assert.equal(Object.hasOwn(after, "targetUserIdSnapshot"), false);
  assert.equal(after.failureCode, "ADMIN_EXPORT_TARGET_NOT_FOUND");
});

test("account deletion anonymization preserves audit fingerprints without raw UUID snapshots", async () => {
  const lifecycle = readFileSync("supabase/migrations/20260927045252_account_delete_round_player_tombstones.sql", "utf8");
  const definition = lifecycle.match(
    /create or replace function private\.anonymize_account_json\([\s\S]*?revoke all on function private\.anonymize_account_json\(jsonb,uuid,text\[\]\) from public,anon,authenticated;/,
  )?.[0];
  assert.ok(definition, "latest lifecycle anonymizer definition must be present");

  const db = new PGlite();
  try {
    await db.exec("create schema private; create role anon; create role authenticated;");
    await db.exec(definition);
    const evidence = {
      accountFingerprintVersion: "sha256:account-privacy-export:v1",
      requesterAccountFingerprint: accountAuditFingerprint(ADMIN_ID),
      subjectAccountFingerprint: accountAuditFingerprint(TARGET_ID),
      result: "SUCCESS",
    };
    const requesterScrub = await db.query<{ value: typeof evidence }>(
      "select private.anonymize_account_json($1::jsonb,$2::uuid) as value",
      [JSON.stringify(evidence), ADMIN_ID],
    );
    const subjectScrub = await db.query<{ value: typeof evidence }>(
      "select private.anonymize_account_json($1::jsonb,$2::uuid) as value",
      [JSON.stringify(requesterScrub.rows[0]?.value), TARGET_ID],
    );
    assert.deepEqual(subjectScrub.rows[0]?.value, evidence);
  } finally {
    await db.close();
  }

  const route = readFileSync("app/api/admin/account-export/route.ts", "utf8");
  assert.doesNotMatch(route, /actorIdSnapshot|targetUserIdSnapshot/);
});

test("an export is withheld when the required SUCCESS audit cannot be persisted", async () => {
  const membership = membershipClient([{ id: "membership" }]);
  const service = serviceClient({ failSuccessAudit: true });
  const route = loadRoute("app/api/admin/account-export/route.ts", {
    "../../../../lib/server-auth": { authenticatedRequest: async () => ({ ok: true, userId: ADMIN_ID, client: membership.client }) },
    "../../../../lib/supabase/server": { getSupabaseAdmin: () => service.client },
  });
  const response = await route.POST!(adminRequest({ targetUserId: TARGET_ID, reason: "Solicitud ARCO", requestId: REQUEST_ID }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ADMIN_EXPORT_AUDIT_FAILED");
  assert.deepEqual(service.audits.map((audit) => audit.action), ["ACCOUNT_DATA_EXPORT_SUCCESS", "ACCOUNT_DATA_EXPORT_FAILED"]);
});

test("allowlist read failures produce a sanitized best-effort FAILED audit and no download", async () => {
  const membership = membershipClient([{ id: "membership" }]);
  const service = serviceClient({ failRead: "legal_evidence_events" });
  const route = loadRoute("app/api/admin/account-export/route.ts", {
    "../../../../lib/server-auth": { authenticatedRequest: async () => ({ ok: true, userId: ADMIN_ID, client: membership.client }) },
    "../../../../lib/supabase/server": { getSupabaseAdmin: () => service.client },
  });
  const response = await route.POST!(adminRequest({ targetUserId: TARGET_ID, reason: "Solicitud ARCO", requestId: REQUEST_ID }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ADMIN_EXPORT_READ_FAILED");
  assert.equal(service.audits.length, 1);
  assert.equal(service.audits[0]?.action, "ACCOUNT_DATA_EXPORT_FAILED");
  const after = service.audits[0]?.after_state as Record<string, unknown>;
  assert.equal(after.failureCode, "ADMIN_EXPORT_READ_FAILED");
  assert.doesNotMatch(JSON.stringify(service.audits), /READ_DOWN|never-export/);
});

test("admin export implementation is service-read allowlisted and never trusts editable metadata", () => {
  const route = readFileSync("app/api/admin/account-export/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260930233254_explicit_optional_authorizations.sql", "utf8");
  assert.match(route, /from\("admin_memberships"\)[\s\S]*\.eq\("user_id", account\.userId\)[\s\S]*\.eq\("role", "SUPER_ADMIN"\)[\s\S]*\.eq\("scope_type", "GLOBAL"\)/);
  assert.match(route, /getSupabaseAdmin\("cloud", 9_000\)/);
  assert.match(route, /from\("admin_audit_log"\)\.insert/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.doesNotMatch(route, /userMetadata|user_metadata|\.select\("\*"\)/);
  assert.match(migration, /grant select on table public\.profiles, public\.user_preferences, public\.legal_acceptances\s+to service_role/);
  assert.match(migration, /grant select, insert on table public\.optional_authorization_events to service_role/);
  assert.match(migration, /grant insert on table public\.admin_audit_log to service_role/);
});
