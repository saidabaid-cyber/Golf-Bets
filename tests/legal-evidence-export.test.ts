import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as accountExportModule from "../lib/account-data-export";
import { ACCOUNT_DATA_EXPORT_LIMIT, buildCombinedAccountExport, buildDownloadableAccountExport, buildLimitedAccountExport, buildLocalAccountExport } from "../lib/account-data-export";
import { ACCOUNT_STORAGE_KEYS } from "../lib/account-state";
import { WORKSPACE_OWNER_KEY } from "../lib/account-workspace";
import { STORAGE_KEYS } from "../lib/round-utils";
import { GUEST_LEGAL_ACTOR_KEY, buildLegalEvidenceEvent, legalEvidenceRequestBody, persistLegalEvidence } from "../lib/legal-evidence-client";
import * as legalEvidenceModule from "../lib/legal-evidence";
import { LEGAL_EVIDENCE_DEFINITIONS, legalEvidenceDefinition } from "../lib/legal-evidence";
import * as securityModule from "../lib/backyard-ai/server/http-security";
import { resolveCanonicalDataEnvironment } from "../lib/runtime-environment";

function loadRoute(file: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(compiled, {
    exports, Request, Response, AbortSignal, TextDecoder, URL, Date, setTimeout, clearTimeout, console,
    process: { env: { NODE_ENV: "test", VERCEL_GIT_COMMIT_SHA: "canonical-sha" } },
    require: (id: string) => {
      if (id === "server-only") return {};
      if (id === "next/server") return { NextResponse: Response };
      if (id.endsWith("/legal-evidence")) return legalEvidenceModule;
      if (id.endsWith("/account-data-export")) return accountExportModule;
      if (id.endsWith("/backyard-ai/server/http-security")) return securityModule;
      if (id.endsWith("/runtime-environment")) return { resolveCanonicalDataEnvironment: () => "test" };
      if (id in dependencies) return dependencies[id];
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  return exports;
}

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("deployed legal/export data cannot be relabelled across environments", () => {
  assert.equal(resolveCanonicalDataEnvironment({ VERCEL_ENV: "preview" }), "preview");
  assert.equal(resolveCanonicalDataEnvironment({ NODE_ENV: "production" }), "production");
  assert.equal(resolveCanonicalDataEnvironment({ NODE_ENV: "test", BACKYARD_LEGAL_ENVIRONMENT: "test" }), "test");
  assert.throws(() => resolveCanonicalDataEnvironment({ VERCEL_ENV: "preview", BACKYARD_LEGAL_ENVIRONMENT: "production" }), /data_environment_mismatch/);
  assert.throws(() => resolveCanonicalDataEnvironment({ VERCEL_ENV: "production", BACKYARD_LEGAL_ENVIRONMENT: "preview" }), /data_environment_mismatch/);
  assert.throws(() => resolveCanonicalDataEnvironment({ BACKYARD_LEGAL_ENVIRONMENT: "arbitrary" }), /invalid_data_environment/);
});

test("canonical legal evidence text is versioned and its SHA-256 is reproducible", () => {
  for (const [subject, definition] of Object.entries(LEGAL_EVIDENCE_DEFINITIONS)) {
    assert.match(definition.documentHash, /^[0-9a-f]{64}$/);
    for (const action of definition.allowedActions) {
      const resolved = legalEvidenceDefinition(subject as keyof typeof LEGAL_EVIDENCE_DEFINITIONS, action);
      assert.ok(resolved);
      assert.equal(createHash("sha256").update(resolved.statement, "utf8").digest("hex"), resolved.statementHash, `${subject}:${action}`);
    }
  }
  assert.equal(legalEvidenceDefinition("privacy_notice", "accepted"), null);
});

test("limited export re-projects fields and never passes tokens, secrets, owner ids or arbitrary columns", () => {
  const dangerous = { access_token: "token", refresh_token: "refresh", service_role: "secret", user_id: "victim", internal_note: "hidden" };
  const payload = buildLimitedAccountExport({
    userId: "verified-owner",
    environment: "preview",
    generatedAt: "2026-09-24T12:00:00.000Z",
    profile: { available: true, data: { ...dangerous, display_name: "Owner", username: "owner" } },
    preferences: { available: true, data: { ...dangerous, locale: "es-MX", high_contrast: true } },
    legalAcceptances: { available: true, data: [{ ...dangerous, type: "terms", version: "v2" }] },
    legalEvidence: { available: true, data: [{ ...dangerous, purpose_key: "terms", action: "accepted" }] },
    aiProcessingConsents: { available: false, data: [{ ...dangerous, scope: "AI_PROVIDER_PROCESSING_CONSENT" }] },
  });
  const serialized = JSON.stringify(payload);
  for (const forbidden of [/"access_token"/, /"refresh_token"/, /"service_role"/, /"internal_note"/, /:"token"/, /:"refresh"/, /:"secret"/, /"victim"/]) assert.doesNotMatch(serialized, forbidden);
  assert.equal(payload.account.userId, "verified-owner");
  assert.equal(payload.scope.completeCloudExport, false);
  assert.equal(payload.data.profile.records[0]?.display_name, "Owner");
  assert.equal(payload.data.aiProcessingConsents.status, "unavailable");
});

test("limited export caps every ledger and marks truncation explicitly", () => {
  const rows = Array.from({ length: ACCOUNT_DATA_EXPORT_LIMIT + 1 }, (_, index) => ({ type: "terms", version: `v${index}` }));
  const empty = { available: true, data: [] };
  const payload = buildLimitedAccountExport({
    userId: "owner", environment: "test", profile: empty, preferences: empty,
    legalAcceptances: { available: true, data: rows }, legalEvidence: empty, aiProcessingConsents: empty,
  });
  assert.equal(payload.data.legalAcceptances.records.length, ACCOUNT_DATA_EXPORT_LIMIT);
  assert.equal(payload.data.legalAcceptances.truncated, true);
});

test("local export includes current owner history, draft and templates without leaking another workspace", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "owner-a");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([
    { id: "round-owned", ownerId: "owner-a", courseName: "La Vista", accessToken: "must-not-export" },
    { id: "shared:foreign", cloudReadOnly: true, ownerId: "owner-b", courseName: "Foreign" },
  ]));
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ roundId: "draft-a", ownerId: "owner-a", startedAt: "2026-09-24T12:00:00.000Z", players: [{ id: "owner-a", name: "Owner" }], refresh_token: "hidden" }));
  storage.setItem(STORAGE_KEYS.frequentPlayers, JSON.stringify([{ id: "player-template", name: "Invitado", updatedAt: "2026-09-24T12:00:00.000Z" }]));
  storage.setItem(STORAGE_KEYS.frequentGroups, JSON.stringify([{ id: "group-template", name: "Sábado", players: [{ name: "Invitado", handicap: 18, memberId: "guest-1", kind: "guest" }], uses: 0, updatedAt: "2026-09-24T12:00:00.000Z" }]));
  storage.setItem(STORAGE_KEYS.rivals, JSON.stringify([{ id: "rival-template", name: "Rival", updatedAt: "2026-09-24T12:00:00.000Z" }]));
  storage.setItem(STORAGE_KEYS.courses, JSON.stringify([{ id: "course-a", name: "Campo propio", updatedAt: "2026-09-24T12:00:00.000Z" }]));
  storage.setItem(STORAGE_KEYS.contrast, "true");
  storage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify([
    { userId: "owner-a", type: "terms", documentVersion: "v2" },
    { userId: "owner-b", type: "terms", documentVersion: "foreign" },
  ]));
  const legal = buildLegalEvidenceEvent({ actorKey: "account:owner-a", actorContext: "authenticated", environment: "test", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", idempotencyKey: "11111111-1111-4111-8111-111111111111" });
  persistLegalEvidence(storage as unknown as Storage, legal);
  const local = buildLocalAccountExport(storage as unknown as Storage, {
    mode: "authenticated", userId: "owner-a", displayName: "Owner A", email: "owner@example.test", defaultHandicap: 10,
  }, "test", "2026-09-24T13:00:00.000Z");
  assert.deepEqual(local.data.roundHistory.records.map((record) => (record as { id: string }).id), ["round-owned"]);
  assert.equal((local.data.activeRoundDraft.record as { roundId?: string })?.roundId, "draft-a");
  assert.equal(local.data.frequentGroups.records.length, 1);
  assert.equal(local.data.opponentTemplates.records.length, 1);
  assert.equal(local.data.courses.records.length, 1);
  assert.equal(local.data.legacyLegalRecords.records.length, 1);
  assert.equal(local.data.legalEvidence.records.length, 1);
  assert.doesNotMatch(JSON.stringify(local), /must-not-export|refresh_token|foreign|owner-b/);
  assert.throws(() => buildLocalAccountExport(storage as unknown as Storage, {
    mode: "authenticated", userId: "owner-b", displayName: "Owner B", email: "b@example.test", defaultHandicap: null,
  }, "test"), /local_export_owner_mismatch/);
});

test("combined export rejects a cloud payload for a different account", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "owner-a");
  const local = buildLocalAccountExport(storage as unknown as Storage, {
    mode: "authenticated", userId: "owner-a", displayName: "Owner A", email: "owner@example.test", defaultHandicap: null,
  }, "test");
  const empty = { available: true, data: [] };
  const foreignCloud = buildLimitedAccountExport({
    userId: "owner-b", environment: "test", profile: empty, preferences: empty,
    legalAcceptances: empty, legalEvidence: empty, aiProcessingConsents: empty,
  });
  assert.throws(() => buildCombinedAccountExport({ local, cloud: foreignCloud }), /account_export_owner_mismatch/);
});

test("guest local export includes the existing guest legal actor without creating a new identity", () => {
  const storage = new MemoryStorage();
  const actorKey = "guest-local:11111111-1111-4111-8111-111111111111";
  storage.setItem(WORKSPACE_OWNER_KEY, "guest");
  storage.setItem(GUEST_LEGAL_ACTOR_KEY, actorKey);
  persistLegalEvidence(storage as unknown as Storage, buildLegalEvidenceEvent({
    actorKey, actorContext: "guest_local", environment: "test", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "local_only", idempotencyKey: "22222222-2222-4222-8222-222222222222",
  }));
  const local = buildLocalAccountExport(storage as unknown as Storage, {
    mode: "guest", userId: "guest", displayName: "Invitado", email: "", defaultHandicap: null,
  }, "test");
  assert.equal(local.data.legalEvidence.records.length, 1);
  assert.equal(storage.getItem(GUEST_LEGAL_ACTOR_KEY), actorKey);
});

test("authenticated local export remains downloadable without token, offline, and on cloud 503", async () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "owner-a");
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ id: "local-round", ownerId: "owner-a" }]));
  const identity = { mode: "authenticated" as const, userId: "owner-a", displayName: "Owner A", email: "owner@example.test", defaultHandicap: null };
  let calls = 0;
  const noToken = await buildDownloadableAccountExport({ storage: storage as unknown as Storage, identity, environment: "test", accessToken: null, online: true, request: async () => { calls++; throw new Error("must not call"); } });
  assert.equal(noToken.cloudStatus, "unavailable_session");
  assert.equal(calls, 0);
  assert.equal(noToken.payload.data.local.data.roundHistory.records.length, 1);
  const offline = await buildDownloadableAccountExport({ storage: storage as unknown as Storage, identity, environment: "test", accessToken: "token", online: false, request: async () => { calls++; throw new Error("must not call"); } });
  assert.equal(offline.cloudStatus, "unavailable_offline");
  assert.equal(calls, 0);
  const unavailable = await buildDownloadableAccountExport({ storage: storage as unknown as Storage, identity, environment: "test", accessToken: "token", online: true, request: async () => { calls++; return Response.json({ error: "ledger unavailable" }, { status: 503 }); } });
  assert.equal(unavailable.cloudStatus, "unavailable_service");
  assert.equal(calls, 1);
  assert.equal(unavailable.payload.data.local.data.roundHistory.records.length, 1);
  assert.doesNotMatch(JSON.stringify(unavailable.payload), /ledger unavailable/);
});

test("local export cuts off deeply nested untrusted objects instead of leaking their raw tail", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORKSPACE_OWNER_KEY, "owner-a");
  let nested: Record<string, unknown> = { accessToken: "deep-secret", image: "data:image/png;base64,AAAA" };
  for (let index = 0; index < 31; index++) nested = { child: nested };
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ id: "deep-round", ownerId: "owner-a", nested }]));
  const local = buildLocalAccountExport(storage as unknown as Storage, {
    mode: "authenticated", userId: "owner-a", displayName: "Owner A", email: "owner@example.test", defaultHandicap: null,
  }, "test");
  assert.doesNotMatch(JSON.stringify(local), /deep-secret|data:image|accessToken/);
});

test("routes require verified owner auth, strict bodies and explicit owner filters", () => {
  const evidence = readFileSync("app/api/legal/evidence/route.ts", "utf8");
  const accountExport = readFileSync("app/api/account/export/route.ts", "utf8");
  for (const route of [evidence, accountExport]) {
    assert.match(route, /authenticatedRequest\(request\)/);
    assert.match(route, /account\.userId/);
    assert.doesNotMatch(route, /getSession\(/);
  }
  assert.match(evidence, /isCrossSiteRequest\(request\)/);
  assert.match(evidence, /readJsonBodyWithLimit\(request, MAX_BODY_BYTES\)/);
  assert.match(evidence, /hasOnlyKeys\(root, \["events"\]\)/);
  assert.match(evidence, /\.eq\("user_id", account\.userId\)/);
  assert.match(evidence, /beforeReceivedAt/);
  assert.match(evidence, /idempotency_key\.lt/);
  assert.match(evidence, /admin\.rpc\("record_legal_evidence_batch"/);
  assert.doesNotMatch(evidence, /admin\.from\("legal_evidence_events"\)\.insert/);
  assert.doesNotMatch(evidence, /input\.userId|root\.userId/);
  assert.match(accountExport, /buildLimitedAccountExport/);
  assert.match(accountExport, /\.eq\("id", account\.userId\)/);
  assert.match(accountExport, /\.eq\("user_id", account\.userId\)/);
  assert.doesNotMatch(accountExport, /\.select\("\*"\)|service_role|SUPABASE_SECRET/);
});

test("evidence POST delegates one owner-bound batch to the transactional RPC and distinguishes replay, semantic deduplication and conflicts", async () => {
  type Input = ReturnType<typeof legalEvidenceRequestBody>;
  type Row = { input: Input; serverReceivedAt: string };
  const rows = new Map<string, Row>();
  let forcedError: { code: string; message: string } | null = null;
  let rpcCalls = 0;
  const semanticKey = (input: Input) => JSON.stringify({
    subject: input.subject,
    action: input.action,
    documentKey: input.documentKey,
    documentVersion: input.documentVersion,
    documentHash: input.documentHash,
    statementKey: input.statementKey,
    statementText: input.statementText,
    statementHash: input.statementHash,
    locale: input.locale,
  });
  const admin = { rpc: async (name: string, params: Record<string, unknown>) => {
    rpcCalls++;
    assert.equal(name, "record_legal_evidence_batch");
    assert.equal(params.p_user_id, "verified-owner");
    assert.equal(params.p_environment, "test");
    assert.equal(params.p_deployment_ref, "canonical-sha");
    if (forcedError) return { data: null, error: forcedError };
    const receipts: Array<Record<string, unknown>> = [];
    for (const input of params.p_events as Input[]) {
      const key = input.idempotencyKey.toLowerCase();
      const prior = rows.get(key);
      if (prior) {
        if (JSON.stringify(prior.input) !== JSON.stringify(input)) {
          return { data: null, error: { code: "P0001", message: "legal_evidence_idempotency_conflict" } };
        }
        receipts.push({ requested_idempotency_key: input.idempotencyKey, canonical_idempotency_key: input.idempotencyKey, server_received_at: prior.serverReceivedAt, replayed: true, deduplicated: false, created: false });
        continue;
      }
      const latest = [...rows].reverse().map(([, row]) => row).find((row) => row.input.subject === input.subject);
      if (latest && semanticKey(latest.input) === semanticKey(input)) {
        receipts.push({ requested_idempotency_key: input.idempotencyKey, canonical_idempotency_key: latest.input.idempotencyKey, server_received_at: latest.serverReceivedAt, replayed: false, deduplicated: true, created: false });
        continue;
      }
      const serverReceivedAt = `2026-09-24T12:00:${String(rows.size + 1).padStart(2, "0")}.000Z`;
      rows.set(key, { input, serverReceivedAt });
      receipts.push({ requested_idempotency_key: input.idempotencyKey, canonical_idempotency_key: input.idempotencyKey, server_received_at: serverReceivedAt, replayed: false, deduplicated: false, created: true });
    }
    return { data: receipts, error: null };
  } };
  let authCalls = 0;
  const route = loadRoute("app/api/legal/evidence/route.ts", {
    "../../../../lib/supabase/server": { getSupabaseAdmin: () => admin },
    "../../../../lib/server-auth": { authenticatedRequest: async () => { authCalls++; return { ok: true, userId: "verified-owner", client: {} }; } },
  });
  const idempotencyKey = "11111111-1111-4111-8111-111111111111";
  const event = buildLegalEvidenceEvent({
    actorKey: "account:verified-owner", actorContext: "authenticated", environment: "test",
    subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending",
    clientOccurredAt: "2026-09-24T12:00:00.000Z", idempotencyKey,
  });
  const body = { events: [legalEvidenceRequestBody(event)] };
  const invoke = (value: unknown, origin?: string) => route.POST(new Request("https://dev.thebackyard.com.mx/api/legal/evidence", {
    method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(value),
  }));
  const created = await invoke(body);
  assert.equal(created.status, 201);
  const stored = rows.get(idempotencyKey)!.input;
  assert.equal(stored.statementText, LEGAL_EVIDENCE_DEFINITIONS.terms.statements.accepted);
  assert.equal(stored.statementHash, LEGAL_EVIDENCE_DEFINITIONS.terms.statementHashes.accepted);
  const replay = await invoke(body);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).receipts[0].replayed, true);
  const duplicateId = "22222222-2222-4222-8222-222222222222";
  const semanticDuplicate = buildLegalEvidenceEvent({
    actorKey: "account:verified-owner", actorContext: "authenticated", environment: "test",
    subject: "terms", action: "accepted", origin: "existing_user_update", syncStatus: "pending",
    clientOccurredAt: "2026-09-24T12:05:00.000Z", idempotencyKey: duplicateId,
  });
  const deduplicated = await invoke({ events: [legalEvidenceRequestBody(semanticDuplicate)] });
  assert.equal(deduplicated.status, 200);
  const deduplicatedPayload = await deduplicated.json();
  assert.equal(deduplicatedPayload.createdCount, 0);
  assert.equal(deduplicatedPayload.receipts[0].deduplicated, true);
  assert.equal(deduplicatedPayload.receipts[0].canonicalIdempotencyKey, idempotencyKey);
  const conflictingEvent = buildLegalEvidenceEvent({
    actorKey: "account:verified-owner", actorContext: "authenticated", environment: "test",
    subject: "terms", action: "rejected", origin: "onboarding", syncStatus: "pending",
    clientOccurredAt: event.clientOccurredAt, idempotencyKey,
  });
  const conflict = await invoke({ events: [legalEvidenceRequestBody(conflictingEvent)] });
  assert.equal(conflict.status, 409);
  assert.equal((await invoke({ events: [{ ...body.events[0], userId: "victim" }] })).status, 400);
  const legacy = await invoke({ events: [{
    ...body.events[0],
    documentVersion: "2026-01-01-v1",
    documentHash: "a".repeat(64),
    statementKey: "terms.accepted.2026-01-01-v1",
    statementText: "Acepté la versión histórica.",
    statementHash: "b".repeat(64),
  }] });
  assert.equal(legacy.status, 400);
  assert.equal(rows.size, 1);
  forcedError = { code: "P0001", message: "legal_evidence_rate_limited" };
  const rateLimitedEvent = buildLegalEvidenceEvent({
    actorKey: "account:verified-owner", actorContext: "authenticated", environment: "test",
    subject: "terms", action: "revoked", origin: "account_privacy", syncStatus: "pending",
    clientOccurredAt: "2026-09-24T12:06:00.000Z", idempotencyKey: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal((await invoke({ events: [legalEvidenceRequestBody(rateLimitedEvent)] })).status, 429);
  forcedError = null;
  const beforeCrossSite = authCalls;
  assert.equal((await invoke(body, "https://evil.invalid")).status, 403);
  assert.equal(authCalls, beforeCrossSite);
  assert.equal(rpcCalls, 5);
});

test("limited export route authenticates first and filters every source to the verified owner", async () => {
  const filters: Array<{ table: string; field: string; value: unknown }> = [];
  const rows: Record<string, unknown> = {
    profiles: { display_name: "Owner", access_token: "must-not-pass" },
    user_preferences: { locale: "es-MX" },
    legal_acceptances: [{ type: "terms", version: "v2" }],
    legal_evidence_events: [{ environment: "test", purpose_key: "terms", action: "accepted" }],
    ai_processing_consents: [{ scope: "AI_PROVIDER_PROCESSING_CONSENT", decision_status: "declined" }],
  };
  const client = { from: (table: string) => {
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters.push({ table, field, value }); return query; },
      order: () => query,
      maybeSingle: async () => ({ data: rows[table], error: null }),
      limit: async () => ({ data: rows[table], error: null }),
    };
    return query;
  } };
  const route = loadRoute("app/api/account/export/route.ts", {
    "../../../../lib/server-auth": { authenticatedRequest: async () => ({ ok: true, userId: "verified-owner", client }) },
  });
  const response = await route.GET(new Request("https://dev.thebackyard.com.mx/api/account/export", { headers: { authorization: "Bearer private-token" } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") || "", /the-backyard-datos-limitados/);
  const payload = await response.json();
  assert.equal(payload.account.userId, "verified-owner");
  assert.equal(payload.scope.completeCloudExport, false);
  assert.doesNotMatch(JSON.stringify(payload), /must-not-pass|private-token/);
  assert.deepEqual(filters.map(({ table, field, value }) => [table, field, value]), [
    ["profiles", "id", "verified-owner"],
    ["user_preferences", "user_id", "verified-owner"],
    ["legal_acceptances", "user_id", "verified-owner"],
    ["legal_evidence_events", "user_id", "verified-owner"],
    ["legal_evidence_events", "environment", "test"],
    ["ai_processing_consents", "user_id", "verified-owner"],
  ]);
});

test("archived or deleting accounts are rejected before legal/export data access", async () => {
  let privilegedAccess = 0;
  const rejected = { ok: false, status: 403, code: "ACCOUNT_ACCESS_RESTRICTED", error: "Cuenta desactivada." };
  const evidence = loadRoute("app/api/legal/evidence/route.ts", {
    "../../../../lib/supabase/server": { getSupabaseAdmin: () => { privilegedAccess++; throw new Error("must not run"); } },
    "../../../../lib/server-auth": { authenticatedRequest: async () => rejected },
  });
  const evidenceResponse = await evidence.POST(new Request("https://dev.thebackyard.com.mx/api/legal/evidence", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [{}] }),
  }));
  assert.equal(evidenceResponse.status, 403);
  const accountExport = loadRoute("app/api/account/export/route.ts", {
    "../../../../lib/server-auth": { authenticatedRequest: async () => rejected },
  });
  assert.equal((await accountExport.GET(new Request("https://dev.thebackyard.com.mx/api/account/export"))).status, 403);
  assert.equal(privilegedAccess, 0);
});

test("canonical SQL remains append-only for clients and records the remote-equivalent reconciliation", () => {
  const migration = readFileSync("supabase/migrations/20260924220041_legal_evidence_events_canonical.sql", "utf8");
  const ingest = readFileSync("supabase/migrations/20260924235930_legal_evidence_transactional_ingest.sql", "utf8");
  assert.match(migration, /remote migration 20260908195537/);
  assert.match(migration, /unique \(user_id, environment, idempotency_key\)/);
  assert.match(migration, /grant select on table public\.legal_evidence_events to authenticated/);
  assert.match(migration, /grant select, insert on table public\.legal_evidence_events to service_role/);
  assert.doesNotMatch(migration, /grant[^;]*(update|delete)[^;]*legal_evidence_events/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(ingest, /security invoker/i);
  assert.match(ingest, /pg_advisory_xact_lock/);
  assert.match(ingest, /legal_evidence_rate_limited/);
  assert.match(ingest, /grant execute on function public\.record_legal_evidence_batch\(uuid, text, text, jsonb\)[\s\S]*to service_role/);
  assert.match(ingest, /revoke execute on function public\.record_legal_evidence_batch\(uuid, text, text, jsonb\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(ingest, /security definer/i);
});

test("legal UI describes the export as limited instead of promising a complete cloud copy", () => {
  const manager = readFileSync("app/components/legal-consent-manager.tsx", "utf8");
  assert.match(manager, /Descargar copia limitada/);
  assert.match(manager, /No incluye tokens, secretos, workspaces de otras cuentas/);
  assert.doesNotMatch(manager, /disabled=\{exporting \|\| \(authenticated && !accessToken\)\}/);
  assert.match(manager, /ni afirma ser una exportación completa/i);
  assert.match(manager, /document\.body\.appendChild\(anchor\)/);
  assert.match(manager, /URL\.revokeObjectURL\(url\), 1_000/);
});
