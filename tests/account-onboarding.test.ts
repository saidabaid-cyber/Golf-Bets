import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as checkpoint from "../lib/onboarding-checkpoint";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const KEY = checkpoint.ONBOARDING_CHECKPOINT_KEY;
const NOW = "2026-09-22T06:00:00.000Z";

function progress(userId = OWNER, step = "welcome") {
  return {
    version: 1,
    userId,
    status: "in_progress",
    step,
    completedSteps: [],
    skippedSteps: [],
    startedAt: NOW,
    updatedAt: NOW,
  };
}

type HarnessOptions = {
  unauthorized?: boolean;
  writeStatus?: number;
  readbackMismatch?: boolean;
  initialMetadata?: Record<string, unknown>;
};

function routeHarness(options: HarnessOptions = {}) {
  let metadata: Record<string, unknown> = {
    provider: "google",
    full_name: "QA Golfer",
    favorite_color: "green",
    ...options.initialMetadata,
  };
  const writes: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const client = {
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: {
            id: OWNER,
            user_metadata: options.readbackMismatch
              ? { ...metadata, [KEY]: progress(OWNER, "ghin") }
              : metadata,
          },
        },
        error: token === "valid-session" ? null : { message: "invalid" },
      }),
    },
  };
  const authFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body || "{}")) as Record<string, unknown>;
    writes.push({ url: String(input), init, body });
    if (options.writeStatus && options.writeStatus !== 200) return Response.json({ error: "unavailable" }, { status: options.writeStatus });
    const patch = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
    metadata = { ...metadata, ...patch };
    return Response.json({ user: { id: OWNER, user_metadata: metadata } });
  };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const source = ts.transpileModule(readFileSync("app/api/account/onboarding/route.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports,
    URL,
    AbortSignal,
    Response,
    fetch: authFetch,
    process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://qa-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_qa_only",
      // Deliberately no service-role/admin secret.
    } },
    require: (name: string) => {
      if (name.endsWith("/social-http.server")) return { socialBody: (request: Request) => request.json() };
      if (name.endsWith("/server-auth")) return { authenticatedRequest: async (request: Request) => {
        const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        if (options.unauthorized || token !== "valid-session") return { ok: false, status: 401, error: "Inicia sesión para continuar." };
        return { ok: true, userId: OWNER, token, client, userMetadata: metadata };
      } };
      if (name.endsWith("/http-security")) return { isCrossSiteRequest: (request: Request) => request.headers.get("sec-fetch-site") === "cross-site" };
      if (name.endsWith("/onboarding-checkpoint")) return checkpoint;
      if (name === "next/server") return {};
      throw new Error(name);
    },
  });
  return {
    writes,
    metadata: () => metadata,
    run: (body: unknown = progress(), query = "", bearer = "valid-session") => exports.PUT(new Request(`https://preview.invalid/api/account/onboarding${query}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })),
  };
}

test("authenticated owner saves onboarding with JWT and gets verified readback", async () => {
  const h = routeHarness();
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).progress, progress());
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, "https://qa-project.supabase.co/auth/v1/user");
  assert.equal(new Headers(h.writes[0].init.headers).get("authorization"), "Bearer valid-session");
  assert.equal(h.writes[0].init.cache, "no-store");
});

test("onboarding save succeeds with no admin or service-role secret", async () => {
  const response = await routeHarness().run();
  assert.equal(response.status, 200);
});

test("invalid bearer remains 401 and never reaches Auth metadata write", async () => {
  const h = routeHarness({ unauthorized: true });
  const response = await h.run(progress(), "", "invalid-bearer");
  assert.equal(response.status, 401);
  assert.equal(h.writes.length, 0);
});

test("another user cannot be targeted by checkpoint body or query selector", async () => {
  const bodyTarget = routeHarness();
  assert.equal((await bodyTarget.run(progress(OTHER))).status, 400);
  assert.equal(bodyTarget.writes.length, 0);

  const queryTarget = routeHarness();
  const response = await queryTarget.run(progress(), `?userId=${OTHER}`);
  assert.equal(response.status, 400);
  assert.equal(queryTarget.writes.length, 0);
});

test("invalid checkpoint version fails closed before metadata write", async () => {
  const h = routeHarness();
  const response = await h.run({ ...progress(), version: 999 });
  assert.equal(response.status, 400);
  assert.equal(h.writes.length, 0);
});

test("one-key patch preserves unrelated Google user metadata", async () => {
  const h = routeHarness();
  assert.equal((await h.run()).status, 200);
  assert.deepEqual(Object.keys(h.writes[0].body), ["data"]);
  assert.deepEqual(Object.keys(h.writes[0].body.data as Record<string, unknown>), [KEY]);
  assert.equal(h.metadata().provider, "google");
  assert.equal(h.metadata().full_name, "QA Golfer");
  assert.equal(h.metadata().favorite_color, "green");
});

test("retrying the same checkpoint is idempotent", async () => {
  const h = routeHarness();
  const first = await h.run();
  const second = await h.run();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
  assert.deepEqual(h.metadata()[KEY], progress());
});

test("new Google user checkpoint survives save and becomes the canonical resume state", async () => {
  const h = routeHarness({ initialMetadata: { email_verified: true, provider: "google" } });
  const next = progress(OWNER, "course");
  assert.equal((await h.run(next)).status, 200);
  assert.equal(h.metadata().provider, "google");
  assert.deepEqual(checkpoint.onboardingCheckpoint(h.metadata()[KEY], OWNER), next);
});

test("reload resumes the exact saved next onboarding step", async () => {
  const h = routeHarness();
  const next = { ...progress(OWNER, "ghin"), completedSteps: ["welcome", "course"] };
  assert.equal((await h.run(next)).status, 200);
  const reloaded = checkpoint.onboardingCheckpoint(h.metadata()[KEY], OWNER);
  assert.equal(reloaded?.step, "ghin");
  assert.deepEqual(reloaded?.completedSteps, ["welcome", "course"]);
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /if \(mapping\.onboardingProgress\) persistBetaOnboardingProgress\(localStorage, mapping\.onboardingProgress\)/);
  assert.match(provider, /setBetaOnboardingRequired\(mapping\.onboardingProgress\?\.status === ['"]in_progress['"]\)/);
});

test("production credentials and service-role APIs are not required by the onboarding route", () => {
  const source = readFileSync("app/api/account/onboarding/route.ts", "utf8");
  assert.doesNotMatch(source, /getSupabaseAdmin|updateUserById|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role/);
  assert.match(source, /Authorization: `Bearer \$\{ctx\.token\}`/);
  assert.match(source, /client\.auth\.getUser\(ctx\.token\)/);
});

test("readback mismatch fails closed instead of acknowledging unsaved progress", async () => {
  const h = routeHarness({ readbackMismatch: true });
  assert.equal((await h.run()).status, 503);
});
