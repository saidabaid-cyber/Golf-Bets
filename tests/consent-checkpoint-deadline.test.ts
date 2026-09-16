import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONSENT_CHECKPOINT_TIMEOUT_MS,
  readRemoteAiConsentDecisions,
  saveRemoteAiConsentDecisions,
  RemoteAiProcessingConsentError,
} from "../lib/backyard-ai/consent-client";
import { AI_PROCESSING_CONSENT_SCOPES } from "../lib/backyard-ai/consent-record";
import { BACKYARD_AI_PROVIDER_CONSENT_VERSION } from "../lib/backyard-ai/privacy";

const missing = () => ({
  resolved: false, policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
  decisions: AI_PROCESSING_CONSENT_SCOPES.map((scope) => ({ scope,
    policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION, status: "missing", active: false,
    source: null, decidedAt: null, acceptedAt: null, revokedAt: null,
  })),
});
const timeout = (error: unknown) => error instanceof RemoteAiProcessingConsentError
  && error.status === 504 && error.code === "consent_timeout";

for (const method of ["GET", "POST"] as const) {
  test(`checkpoint ${method} settles after 8 seconds even when transport ignores abort`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = t.mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit) => {
      assert.equal(init?.method, method); requestSignal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const request = method === "GET" ? readRemoteAiConsentDecisions("qa-token")
      : saveRemoteAiConsentDecisions("qa-token", "qa-user", [{ scope: AI_PROCESSING_CONSENT_SCOPES[0], accepted: true }], "account_update");
    const rejected = assert.rejects(request, timeout);
    await Promise.resolve(); assert.equal(fetchMock.mock.callCount(), 1);
    t.mock.timers.tick(AI_CONSENT_CHECKPOINT_TIMEOUT_MS - 1);
    assert.equal(requestSignal?.aborted, false);
    t.mock.timers.tick(1); await rejected;
    assert.equal(requestSignal?.aborted, true);
  });
}

test("checkpoint deadline includes reading a stalled JSON response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200,
    json: () => new Promise<unknown>(() => {}),
  } as Response));
  const rejected = assert.rejects(readRemoteAiConsentDecisions("qa-token"), timeout);
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(AI_CONSENT_CHECKPOINT_TIMEOUT_MS); await rejected;
});

test("checkpoint cancellation on unmount settles and aborts transport without granting consent", async (t) => {
  const controller = new AbortController(); let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_url: unknown, init?: RequestInit) => {
    requestSignal = init?.signal; return new Promise<Response>(() => {});
  });
  const rejected = assert.rejects(readRemoteAiConsentDecisions("qa-token", controller.signal),
    (error: unknown) => error instanceof RemoteAiProcessingConsentError && error.code === "consent_cancelled");
  await Promise.resolve(); controller.abort(); await rejected;
  assert.equal(requestSignal?.aborted, true);
});

test("an already aborted checkpoint never sends a server request", async (t) => {
  const controller = new AbortController(); controller.abort();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json(missing()));
  await assert.rejects(readRemoteAiConsentDecisions("qa-token", controller.signal), RemoteAiProcessingConsentError);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("successful authoritative read clears its deadline and returns real missing choices", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    requestSignal = init?.signal; return Response.json(missing());
  });
  const result = await readRemoteAiConsentDecisions("qa-token");
  assert.equal(result.resolved, false); assert.ok(result.decisions.every((decision) => !decision.active));
  t.mock.timers.tick(AI_CONSENT_CHECKPOINT_TIMEOUT_MS * 2);
  assert.equal(requestSignal?.aborted, false, "settled requests must not leave a timer behind");
});

test("late response after deadline cannot turn the rejected lookup into acceptance", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish: ((response: Response) => void) | undefined;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
  const pending = readRemoteAiConsentDecisions("qa-token");
  const rejected = assert.rejects(pending, timeout); await Promise.resolve();
  t.mock.timers.tick(AI_CONSENT_CHECKPOINT_TIMEOUT_MS); await rejected;
  finish?.(Response.json(missing())); await Promise.resolve();
  await assert.rejects(pending, timeout);
});
