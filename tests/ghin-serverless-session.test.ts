import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";

type ClientModule = typeof import("../lib/ghin/client");
type SessionModule = typeof import("../lib/ghin/user-session.server");

const moduleLoader = Module as unknown as {
  _load(request: string, parent: NodeModule | null, isMain: boolean): unknown;
};
const originalModuleLoad = moduleLoader._load;
moduleLoader._load = (request, parent, isMain) => request === "server-only"
  ? {}
  : originalModuleLoad.call(moduleLoader, request, parent, isMain);
let clientModule: ClientModule;
let sessionModule: SessionModule;
try {
  clientModule = moduleLoader._load("../lib/ghin/client", module, false) as ClientModule;
  sessionModule = moduleLoader._load("../lib/ghin/user-session.server", module, false) as SessionModule;
} finally {
  moduleLoader._load = originalModuleLoad;
}

const ENV_KEYS = [
  "VERCEL_ENV",
  "NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION",
  "GHIN_READ_ONLY_ENABLED",
  "GHIN_GOLFER_LOOKUP_ENABLED",
  "GHIN_SCORE_POSTING_ENABLED",
  "GHIN_API_BASE_URL",
  "SUPABASE_SECRET_KEY",
] as const;

function withPreviewEnvironment(run: () => void) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION: "true",
    GHIN_READ_ONLY_ENABLED: "true",
    GHIN_GOLFER_LOOKUP_ENABLED: "true",
    GHIN_SCORE_POSTING_ENABLED: "false",
    GHIN_API_BASE_URL: "https://api2.ghin.com/api/v1",
    SUPABASE_SECRET_KEY: "preview-unit-test-secret-with-enough-entropy",
  });
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("the GHIN read session is authenticated-encrypted and survives a stateless invocation", () => {
  withPreviewEnvironment(() => {
    const now = Date.now();
    const client = new clientModule.GhinReadOnlyClient({
      baseUrl: "https://api2.ghin.com/api/v1",
      session: {
        version: 1,
        accessToken: "never-visible-provider-session-token",
        tokenExpiresAt: now + 30 * 60_000,
        authenticatedAt: now - 1_000,
        effectiveExpiresAt: now + 30 * 60_000,
        httpStatus: 200,
        firebaseHttpStatus: 200,
        golferNumber: "90000001",
      },
      now: () => now,
    });
    const issued = sessionModule.sealGhinUserSession({
      ownerId: "00000000-0000-4000-8000-000000000001",
      ghinNumber: "90000001",
      client,
      lastUsedAt: now,
    });

    assert.match(issued.value, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(issued.value, /never-visible|provider|90000001|00000000/);
    sessionModule.clearGhinUserSession("00000000-0000-4000-8000-000000000001");
    const restored = sessionModule.restoreGhinUserSession(
      "00000000-0000-4000-8000-000000000001",
      "90000001",
      issued.value,
    );
    assert.equal(restored?.client.hasUsableSession(), true);
    assert.equal(sessionModule.restoreGhinUserSession("another-owner", "90000001", issued.value), null);
    assert.equal(sessionModule.restoreGhinUserSession(
      "00000000-0000-4000-8000-000000000001",
      "90000002",
      issued.value,
    ), null);
    const tampered = issued.value.split(".");
    tampered[2] = `${tampered[2][0] === "A" ? "B" : "A"}${tampered[2].slice(1)}`;
    assert.equal(sessionModule.restoreGhinUserSession(
      "00000000-0000-4000-8000-000000000001",
      "90000001",
      tampered.join("."),
    ), null);
  });
});

test("the route keeps the session server-only, scoped and fail-closed", () => {
  const route = readFileSync("app/api/profile/ghin/route.ts", "utf8");
  const session = readFileSync("lib/ghin/user-session.server.ts", "utf8");
  assert.match(route, /httpOnly:\s*true/);
  assert.match(route, /secure:\s*true/);
  assert.match(route, /sameSite:\s*"strict"/);
  assert.match(route, /path:\s*GHIN_SESSION_COOKIE_PATH/);
  assert.match(route, /request\.cookies\.get\(GHIN_SESSION_COOKIE_NAME\)/);
  assert.match(route, /withoutGhinSessionCookie[\s\S]*operation === "unlink"|operation === "unlink"[\s\S]*withoutGhinSessionCookie/);
  assert.match(session, /createCipheriv\("aes-256-gcm"/);
  assert.match(session, /createDecipheriv\("aes-256-gcm"/);
  assert.match(session, /payload\.ownerId !== ownerId/);
  assert.doesNotMatch(`${route}\n${session}`, /console\.(?:log|info|warn|error)\([^\n]*(?:accessToken|password|cookie)/i);
});
