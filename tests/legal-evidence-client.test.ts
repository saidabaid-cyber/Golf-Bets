import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GUEST_LEGAL_ACTOR_KEY,
  LEGAL_EVIDENCE_MAX_REMOTE_PAGE_EVENTS,
  LEGAL_EVIDENCE_MAX_REMOTE_PAGES,
  buildLegalEvidenceEvent,
  getOrCreateGuestLegalActor,
  hasCurrentCoreLegalChoices,
  hasCurrentFinancialConsent,
  hasCurrentMarketingConsent,
  hasResolvedFinancialConsent,
  hasResolvedMarketingConsent,
  latestLegalEvidence,
  legalClientEnvironment,
  legalEvidenceRequestBody,
  legalEvidenceStateKey,
  mergeServerLegalEvidence,
  pendingLegalEvidence,
  persistLegalEvidence,
  readLegalEvidence,
  recordLocalLegalEvidenceBatch,
  synchronizeLegalEvidence,
} from "../lib/legal-evidence-client";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];

test("evidence storage isolates environment, account and stable random guest actor", () => {
  const storage = new MemoryStorage();
  const guest = getOrCreateGuestLegalActor(storage as unknown as Storage, () => ids[0]);
  assert.equal(guest, `guest-local:${ids[0]}`);
  assert.equal(getOrCreateGuestLegalActor(storage as unknown as Storage, () => ids[1]), guest);
  assert.equal(storage.getItem(GUEST_LEGAL_ACTOR_KEY), guest);
  assert.equal(legalClientEnvironment("app.thebackyard.com.mx"), "production");
  assert.equal(legalClientEnvironment("dev.thebackyard.com.mx"), "preview");
  assert.equal(legalClientEnvironment("localhost"), "development");

  const accountA = buildLegalEvidenceEvent({ actorKey: "account:a", actorContext: "authenticated", environment: "preview", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", idempotencyKey: ids[1] });
  const accountB = buildLegalEvidenceEvent({ actorKey: "account:b", actorContext: "authenticated", environment: "preview", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", idempotencyKey: ids[2] });
  const productionA = buildLegalEvidenceEvent({ actorKey: "account:a", actorContext: "authenticated", environment: "production", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", idempotencyKey: ids[3] });
  persistLegalEvidence(storage as unknown as Storage, accountA);
  persistLegalEvidence(storage as unknown as Storage, accountB);
  persistLegalEvidence(storage as unknown as Storage, productionA);
  assert.deepEqual(readLegalEvidence(storage as unknown as Storage, "account:a", "preview").map((event) => event.idempotencyKey), [ids[1]]);
  assert.deepEqual(readLegalEvidence(storage as unknown as Storage, "account:b", "preview").map((event) => event.idempotencyKey), [ids[2]]);
  assert.deepEqual(readLegalEvidence(storage as unknown as Storage, "account:a", "production").map((event) => event.idempotencyKey), [ids[3]]);
  assert.notEqual(legalEvidenceStateKey("account:a", "preview"), legalEvidenceStateKey("account:a", "production"));
});

test("core, financial and marketing ceremonies remain separate and same current choice is idempotent", () => {
  const storage = new MemoryStorage();
  let cursor = 0;
  const first = recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "onboarding",
    choices: [
      { subject: "privacy_notice", action: "presented" },
      { subject: "terms", action: "accepted" },
      { subject: "age_declaration", action: "accepted" },
      { subject: "financial_data", action: "rejected" },
    ],
    randomId: () => ids[cursor++],
  });
  assert.equal(first.recorded.length, 4);
  assert.equal(hasCurrentCoreLegalChoices(first.events), true);
  assert.equal(hasCurrentFinancialConsent(first.events), false);
  assert.equal(hasCurrentMarketingConsent(first.events), false);

  const replay = recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "onboarding",
    choices: [{ subject: "terms", action: "accepted" }],
    randomId: () => ids[cursor++],
  });
  assert.equal(replay.recorded.length, 0);
  assert.equal(replay.events.length, 4);

  const marketing = recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test", origin: "account_privacy", choices: [{ subject: "marketing", action: "accepted" }], randomId: () => ids[cursor++],
  });
  const revoked = recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test", origin: "account_privacy", choices: [{ subject: "marketing", action: "revoked" }], randomId: () => ids[cursor++],
  });
  assert.equal(hasCurrentMarketingConsent(marketing.events), true);
  assert.equal(hasCurrentMarketingConsent(revoked.events), false);
  assert.equal(latestLegalEvidence(revoked.events, "marketing")?.action, "revoked");
  assert.equal(revoked.events.filter((event) => event.subject === "marketing").length, 2);
});

test("local persistence failure never fabricates an acceptance", () => {
  const storage = new MemoryStorage();
  const failing = { getItem: storage.getItem.bind(storage), setItem() { throw new Error("quota"); } };
  assert.throws(() => recordLocalLegalEvidenceBatch(failing as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test", origin: "onboarding", choices: [{ subject: "terms", action: "accepted" }], randomId: () => ids[0],
  }), /quota/);
  assert.equal(storage.values.size, 0);
});

test("GET merge and POST retry use the same idempotency key and persist the server receipt", async () => {
  const storage = new MemoryStorage();
  const local = recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test", origin: "financial_gate", choices: [{ subject: "financial_data", action: "accepted" }], randomId: () => ids[0],
  }).events;
  const requests: Array<{ method: string; body: unknown }> = [];
  const request = async (_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method || "GET";
    requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET") return Response.json({ environment: "test", truncated: false, events: [] });
    return Response.json({ receipts: [{ idempotencyKey: ids[0], serverReceivedAt: "2026-09-24T12:05:00.000Z" }] }, { status: 201 });
  };
  const synced = await synchronizeLegalEvidence({ storage: storage as unknown as Storage, userId: "owner", accessToken: "same-token", environment: "test", request });
  assert.deepEqual(requests.map((item) => item.method), ["GET", "POST"]);
  assert.equal((requests[1].body as { events: Array<{ idempotencyKey: string; documentVersion: string; statementHash: string }> }).events[0].idempotencyKey, ids[0]);
  assert.equal((requests[1].body as { events: Array<{ documentVersion: string }> }).events[0].documentVersion, local[0].documentVersion);
  assert.equal((requests[1].body as { events: Array<{ statementHash: string }> }).events[0].statementHash, local[0].statementHash);
  assert.equal(synced[0].syncStatus, "synced");
  assert.equal(synced[0].serverReceivedAt, "2026-09-24T12:05:00.000Z");
});

test("a semantic-dedup receipt removes the redundant local UUID only after its canonical decision is present", async () => {
  const storage = new MemoryStorage();
  const duplicate = buildLegalEvidenceEvent({
    actorKey: "account:owner", actorContext: "authenticated", environment: "test",
    subject: "terms", action: "accepted", origin: "existing_user_update", syncStatus: "pending",
    clientOccurredAt: "2026-09-24T12:05:00.000Z", idempotencyKey: ids[1],
  });
  persistLegalEvidence(storage as unknown as Storage, duplicate);
  const canonical = buildLegalEvidenceEvent({
    actorKey: "account:owner", actorContext: "authenticated", environment: "test",
    subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "synced",
    clientOccurredAt: "2026-09-24T12:00:00.000Z", idempotencyKey: ids[0],
  });
  const canonicalRow = {
    environment: "test" as const,
    document_key: canonical.documentKey,
    purpose_key: canonical.subject,
    document_version: canonical.documentVersion,
    document_hash: canonical.documentHash,
    statement_key: canonical.statementKey,
    statement_text: canonical.statementText,
    statement_hash: canonical.statementHash,
    action: canonical.action,
    locale: canonical.locale,
    origin: canonical.origin,
    client_occurred_at: canonical.clientOccurredAt,
    server_received_at: "2026-09-24T12:00:01.000Z",
    idempotency_key: canonical.idempotencyKey,
  };
  const synced = await synchronizeLegalEvidence({
    storage: storage as unknown as Storage,
    userId: "owner",
    accessToken: "same-token",
    environment: "test",
    request: async (_input, init) => (init?.method || "GET") === "GET"
      ? Response.json({ environment: "test", truncated: false, events: [canonicalRow] })
      : Response.json({ receipts: [{
        idempotencyKey: duplicate.idempotencyKey,
        canonicalIdempotencyKey: canonical.idempotencyKey,
        serverReceivedAt: canonicalRow.server_received_at,
        deduplicated: true,
      }] }),
  });
  assert.deepEqual(synced.map((item) => item.idempotencyKey), [canonical.idempotencyKey]);
  assert.equal(latestLegalEvidence(synced, "terms")?.action, "accepted");
});

test("503 keeps the queue pending and a manual retry works without a token change", async () => {
  const storage = new MemoryStorage();
  recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test", origin: "onboarding", choices: [{ subject: "terms", action: "accepted" }], randomId: () => ids[0],
  });
  let available = false;
  let postCalls = 0;
  const request = async (_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (!available) return Response.json({ error: "ledger pending" }, { status: 503 });
    if (method === "GET") return Response.json({ environment: "test", truncated: false, events: [] });
    postCalls++;
    return Response.json({ receipts: [{ idempotencyKey: ids[0], serverReceivedAt: "2026-09-24T12:06:00.000Z" }] }, { status: 201 });
  };
  await assert.rejects(() => synchronizeLegalEvidence({ storage: storage as unknown as Storage, userId: "owner", accessToken: "unchanged-token", environment: "test", request }), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 503);
    return true;
  });
  assert.equal(readLegalEvidence(storage as unknown as Storage, "account:owner", "test")[0].syncStatus, "pending");
  available = true;
  const synced = await synchronizeLegalEvidence({ storage: storage as unknown as Storage, userId: "owner", accessToken: "unchanged-token", environment: "test", request });
  assert.equal(postCalls, 1);
  assert.equal(synced[0].syncStatus, "synced");
});

test("financial gate has no authorized hydration frame and the latest remote revocation wins", () => {
  assert.equal(hasResolvedFinancialConsent([], true, false), false);
  const accepted = {
    ...buildLegalEvidenceEvent({ actorKey: "account:owner", actorContext: "authenticated", environment: "test", subject: "financial_data", action: "accepted", origin: "financial_gate", syncStatus: "synced", clientOccurredAt: "2026-09-24T12:00:00.000Z", idempotencyKey: ids[0] }),
    serverReceivedAt: "2026-09-24T12:00:01.000Z",
  };
  const revoked = buildLegalEvidenceEvent({ actorKey: "account:owner", actorContext: "authenticated", environment: "test", subject: "financial_data", action: "revoked", origin: "account_privacy", syncStatus: "synced", clientOccurredAt: "2026-09-24T12:05:00.000Z", idempotencyKey: ids[1] });
  const merged = mergeServerLegalEvidence([accepted], [{
    environment: "test",
    document_key: revoked.documentKey,
    purpose_key: revoked.subject,
    document_version: revoked.documentVersion,
    document_hash: revoked.documentHash,
    statement_key: revoked.statementKey,
    statement_text: revoked.statementText,
    statement_hash: revoked.statementHash,
    action: revoked.action,
    locale: revoked.locale,
    origin: revoked.origin,
    client_occurred_at: revoked.clientOccurredAt,
    server_received_at: "2026-09-24T12:05:01.000Z",
    idempotency_key: revoked.idempotencyKey,
  }], "owner", "test");
  assert.equal(latestLegalEvidence(merged, "financial_data")?.action, "revoked");
  assert.equal(hasResolvedFinancialConsent(merged, true, true), false);
  assert.equal(hasResolvedFinancialConsent([accepted], false, true), true);
});

test("a revocation written by another tab closes the financial gate on rehydrate", () => {
  const sharedStorage = new MemoryStorage();
  recordLocalLegalEvidenceBatch(sharedStorage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "financial_gate",
    choices: [{ subject: "financial_data", action: "accepted" }],
    randomId: () => ids[0],
  });
  const tabAInitial = readLegalEvidence(sharedStorage as unknown as Storage, "account:owner", "test");
  assert.equal(hasResolvedFinancialConsent(tabAInitial, false, true), true);
  recordLocalLegalEvidenceBatch(sharedStorage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "account_privacy",
    choices: [{ subject: "financial_data", action: "revoked" }],
    randomId: () => ids[1],
  });
  const tabARehydrated = readLegalEvidence(sharedStorage as unknown as Storage, "account:owner", "test");
  assert.equal(latestLegalEvidence(tabARehydrated, "financial_data")?.action, "revoked");
  assert.equal(hasResolvedFinancialConsent(tabARehydrated, true, false), false);
});

test("remote marketing revocation overrides a locally accepted preference and unresolved state is off", () => {
  const revoked = buildLegalEvidenceEvent({ actorKey: "account:owner", actorContext: "authenticated", environment: "test", subject: "marketing", action: "revoked", origin: "account_privacy", syncStatus: "synced", idempotencyKey: ids[0] });
  assert.equal(hasResolvedMarketingConsent([], true, false), false);
  assert.equal(hasResolvedMarketingConsent([revoked], true, true), false);
  const accepted = buildLegalEvidenceEvent({ actorKey: "account:owner", actorContext: "authenticated", environment: "test", subject: "marketing", action: "accepted", origin: "account_privacy", syncStatus: "synced", idempotencyKey: ids[1] });
  assert.equal(hasResolvedMarketingConsent([accepted], false, true), true);
});

test("a ledger beyond 500 rows is fully paged before resolving the latest revocation", async () => {
  const storage = new MemoryStorage();
  const localAccepted = buildLegalEvidenceEvent({
    actorKey: "account:owner",
    actorContext: "authenticated",
    environment: "test",
    subject: "financial_data",
    action: "accepted",
    origin: "financial_gate",
    syncStatus: "synced",
    clientOccurredAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: ids[0],
  });
  persistLegalEvidence(storage as unknown as Storage, localAccepted);
  const remoteRevoked = buildLegalEvidenceEvent({
    actorKey: "account:owner",
    actorContext: "authenticated",
    environment: "test",
    subject: "financial_data",
    action: "revoked",
    origin: "account_privacy",
    syncStatus: "synced",
    clientOccurredAt: "2026-09-24T12:00:00.000Z",
    idempotencyKey: ids[1],
  });
  const remoteRow = {
    environment: "test" as const,
    document_key: remoteRevoked.documentKey,
    purpose_key: remoteRevoked.subject,
    document_version: remoteRevoked.documentVersion,
    document_hash: remoteRevoked.documentHash,
    statement_key: remoteRevoked.statementKey,
    statement_text: remoteRevoked.statementText,
    statement_hash: remoteRevoked.statementHash,
    action: remoteRevoked.action,
    locale: remoteRevoked.locale,
    origin: remoteRevoked.origin,
    client_occurred_at: remoteRevoked.clientOccurredAt,
    server_received_at: "2026-09-24T12:00:01.000Z",
    idempotency_key: remoteRevoked.idempotencyKey,
  };
  let getCalls = 0;
  const synced = await synchronizeLegalEvidence({
    storage: storage as unknown as Storage,
    userId: "owner",
    accessToken: "same-token",
    environment: "test",
    request: async (input) => {
      getCalls++;
      if (String(input).includes("beforeReceivedAt=")) return Response.json({ environment: "test", truncated: false, nextCursor: null, events: [] });
      return Response.json({
        environment: "test",
        truncated: true,
        nextCursor: { beforeReceivedAt: "2026-09-24T11:00:00.000Z", beforeId: ids[2] },
        events: Array.from({ length: 500 }, () => remoteRow),
      });
    },
  });
  assert.equal(getCalls, 2);
  assert.equal(latestLegalEvidence(synced, "financial_data")?.action, "revoked");
  assert.equal(hasResolvedFinancialConsent(synced, true, true), false);
});

test("remote pagination is bounded and aborts without replacing local evidence", async () => {
  const storage = new MemoryStorage();
  recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "financial_gate",
    choices: [{ subject: "financial_data", action: "revoked" }],
    randomId: () => ids[0],
  });
  const stateKey = legalEvidenceStateKey("account:owner", "test");
  const before = storage.getItem(stateKey);
  let getCalls = 0;
  await assert.rejects(() => synchronizeLegalEvidence({
    storage: storage as unknown as Storage,
    userId: "owner",
    accessToken: "same-token",
    environment: "test",
    request: async () => {
      getCalls++;
      const cursorId = `aaaaaaaa-aaaa-4aaa-8aaa-${getCalls.toString(16).padStart(12, "0")}`;
      return Response.json({
        environment: "test",
        truncated: true,
        nextCursor: { beforeReceivedAt: `2026-09-24T11:${String(getCalls).padStart(2, "0")}:00.000Z`, beforeId: cursorId },
        events: [],
      });
    },
  }), (error: unknown) => {
    assert.equal((error as { message?: string }).message, "legal_evidence_download_limit");
    assert.equal((error as { resolutionBlocked?: boolean }).resolutionBlocked, true);
    return true;
  });
  assert.equal(getCalls, LEGAL_EVIDENCE_MAX_REMOTE_PAGES);
  assert.equal(storage.getItem(stateKey), before);
});

test("an oversized server page is rejected before it can alter the latest local decision", async () => {
  const storage = new MemoryStorage();
  const local = recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "account_privacy",
    choices: [{ subject: "marketing", action: "revoked" }],
    randomId: () => ids[0],
  });
  const remote = buildLegalEvidenceEvent({
    actorKey: "account:owner", actorContext: "authenticated", environment: "test",
    subject: "marketing", action: "accepted", origin: "account_privacy", syncStatus: "synced",
    clientOccurredAt: "2026-09-24T12:00:00.000Z", idempotencyKey: ids[1],
  });
  const row = {
    environment: "test" as const,
    document_key: remote.documentKey,
    purpose_key: remote.subject,
    document_version: remote.documentVersion,
    document_hash: remote.documentHash,
    statement_key: remote.statementKey,
    statement_text: remote.statementText,
    statement_hash: remote.statementHash,
    action: remote.action,
    locale: remote.locale,
    origin: remote.origin,
    client_occurred_at: remote.clientOccurredAt,
    server_received_at: "2026-09-24T12:00:01.000Z",
    idempotency_key: remote.idempotencyKey,
  };
  await assert.rejects(() => synchronizeLegalEvidence({
    storage: storage as unknown as Storage,
    userId: "owner",
    accessToken: "same-token",
    environment: "test",
    request: async () => Response.json({
      environment: "test",
      truncated: false,
      events: Array.from({ length: LEGAL_EVIDENCE_MAX_REMOTE_PAGE_EVENTS + 1 }, () => row),
    }),
  }), /legal_evidence_download_limit/);
  assert.equal(latestLegalEvidence(readLegalEvidence(storage as unknown as Storage, "account:owner", "test"), "marketing")?.action, "revoked");
  assert.equal(local.events.length, 1);
});

test("an event appended while GET is in flight is preserved and synchronized", async () => {
  const storage = new MemoryStorage();
  recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "onboarding",
    choices: [{ subject: "terms", action: "accepted" }],
    randomId: () => ids[0],
  });
  let releaseGet!: (response: Response) => void;
  const getResponse = new Promise<Response>((resolve) => { releaseGet = resolve; });
  const postedIds: string[] = [];
  const syncing = synchronizeLegalEvidence({
    storage: storage as unknown as Storage,
    userId: "owner",
    accessToken: "same-token",
    environment: "test",
    request: async (_input, init) => {
      if ((init?.method || "GET") === "GET") return getResponse;
      const body = JSON.parse(String(init?.body)) as { events: Array<{ idempotencyKey: string }> };
      postedIds.push(...body.events.map((event) => event.idempotencyKey));
      return Response.json({ receipts: body.events.map((event) => ({
        idempotencyKey: event.idempotencyKey,
        serverReceivedAt: "2026-09-24T12:10:00.000Z",
      })) }, { status: 201 });
    },
  });
  recordLocalLegalEvidenceBatch(storage as unknown as Storage, { mode: "authenticated", userId: "owner" }, {
    environment: "test",
    origin: "financial_gate",
    choices: [{ subject: "financial_data", action: "accepted" }],
    randomId: () => ids[1],
  });
  releaseGet(Response.json({ environment: "test", truncated: false, events: [] }));
  const synced = await syncing;
  assert.deepEqual(new Set(synced.map((event) => event.idempotencyKey)), new Set([ids[0], ids[1]]));
  assert.deepEqual(new Set(postedIds), new Set([ids[0], ids[1]]));
  assert.equal(synced.every((event) => event.syncStatus === "synced"), true);
});

test("historical evidence is preserved locally and never upgraded by POST", async () => {
  const storage = new MemoryStorage();
  const current = buildLegalEvidenceEvent({ actorKey: "account:owner", actorContext: "authenticated", environment: "test", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", idempotencyKey: ids[0] });
  const historical = {
    ...current,
    documentVersion: "2026-01-01-v1",
    documentHash: "a".repeat(64),
    statementKey: "terms.accepted.2026-01-01-v1",
    statementText: "Acepté expresamente la versión histórica de los términos.",
    statementHash: "b".repeat(64),
  };
  persistLegalEvidence(storage as unknown as Storage, historical);
  assert.equal(pendingLegalEvidence(readLegalEvidence(storage as unknown as Storage, "account:owner", "test")).length, 0);
  const methods: string[] = [];
  const result = await synchronizeLegalEvidence({
    storage: storage as unknown as Storage,
    userId: "owner",
    accessToken: "same-token",
    environment: "test",
    request: async (_input, init) => {
      methods.push(init?.method || "GET");
      return Response.json({ environment: "test", truncated: false, events: [] });
    },
  });
  assert.deepEqual(methods, ["GET"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].documentVersion, "2026-01-01-v1");
  assert.equal(result[0].statementText, historical.statementText);
  assert.equal(result[0].syncStatus, "pending");
});

test("request envelope carries immutable ceremony material", () => {
  const event = buildLegalEvidenceEvent({ actorKey: "account:owner", actorContext: "authenticated", environment: "test", subject: "terms", action: "accepted", origin: "onboarding", syncStatus: "pending", idempotencyKey: ids[0] });
  assert.deepEqual(legalEvidenceRequestBody(event), {
    subject: event.subject,
    action: event.action,
    documentKey: event.documentKey,
    documentVersion: event.documentVersion,
    documentHash: event.documentHash,
    statementKey: event.statementKey,
    statementText: event.statementText,
    statementHash: event.statementHash,
    locale: event.locale,
    origin: event.origin,
    clientOccurredAt: event.clientOccurredAt,
    idempotencyKey: event.idempotencyKey,
  });
});

test("provider wires explicit ceremonies and retries queues on online/manual triggers", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const manager = readFileSync("app/components/legal-consent-manager.tsx", "utf8");
  const dialog = readFileSync("app/components/betting-consent-dialog.tsx", "utf8");
  assert.match(provider, /subject: "privacy_notice", action: "presented"/);
  assert.match(provider, /subject: "terms", action: "accepted"/);
  assert.match(provider, /subject: "age_declaration", action: "accepted"/);
  assert.match(provider, /subject: "financial_data", action: includeBettingConsent \? "accepted" : "rejected"/);
  assert.match(provider, /hasResolvedFinancialConsent\(legalEvidenceEvents, legacyBettingConsent, financialConsentResolved\)/);
  assert.match(provider, /locallyResolvedLegalSubjects\.includes\("financial_data"\)/);
  assert.match(provider, /locallyResolvedLegalSubjects\.includes\("marketing"\)/);
  assert.match(dialog, /onReject/);
  assert.match(dialog, /No autorizar/);
  assert.match(manager, /recordLegalChoice\("marketing", "accepted"\)/);
  assert.match(manager, /recordLegalChoice\("marketing", "revoked"\)/);
  assert.match(manager, /recordLegalChoice\("financial_data", "revoked"\)/);
  assert.match(provider, /event\.key !== evidenceKey/);
  assert.match(provider, /setLegalEvidenceState\(\{ actorKey, environment: legalEnvironment, events, resolved: mode === "guest", resolvedSubjects: \[\] \}\)/);
  assert.match(provider, /window\.addEventListener\("focus", refreshOnFocus\)/);
  assert.match(provider, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  const online = provider.slice(provider.indexOf("const restoreWhenOnline"), provider.indexOf("window.addEventListener(\"online\""));
  assert.match(online, /setLegalRetryRevision/);
  assert.match(online, /setAccountReloadRevision/);
  const manual = provider.slice(provider.indexOf("const retryAllCloud"), provider.indexOf("const cloudIssues ="));
  assert.match(manual, /identity\?\.mode === "authenticated"[\s\S]*setLegalRetryRevision/);
  assert.match(manual, /identity\?\.mode === "authenticated"[\s\S]*setAccountReloadRevision/);
});
