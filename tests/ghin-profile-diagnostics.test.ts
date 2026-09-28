import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import test from "node:test";

type DiagnosticsModule = typeof import("../lib/ghin/profile-diagnostics.server");

const moduleLoader = Module as unknown as {
  _load(request: string, parent: NodeModule | null, isMain: boolean): unknown;
};
const originalModuleLoad = moduleLoader._load;
moduleLoader._load = (request, parent, isMain) => request === "server-only"
  ? {}
  : originalModuleLoad.call(moduleLoader, request, parent, isMain);
let diagnostics: DiagnosticsModule;
try {
  diagnostics = moduleLoader._load("../lib/ghin/profile-diagnostics.server", module, false) as DiagnosticsModule;
} finally {
  moduleLoader._load = originalModuleLoad;
}

function capturePreviewLog(run: () => void) {
  const previousEnv = process.env.VERCEL_ENV;
  const originalInfo = console.info;
  const calls: unknown[][] = [];
  process.env.VERCEL_ENV = "preview";
  console.info = (...args: unknown[]) => { calls.push(args); };
  try {
    run();
  } finally {
    console.info = originalInfo;
    if (previousEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
  return calls;
}

test("Preview diagnostic emits only the bounded stage contract and strips identity-bearing query params", () => {
  const calls = capturePreviewLog(() => diagnostics.logGhinProfileStage({
    operation: "authorize",
    stage: "lookup_by_email",
    endpoint: "/golfers/search.json?email=private-owner@example.test&golfer_id=98765432",
    httpStatus: 422,
    code: "invalid_response",
    retryable: false,
    durationMs: 431.2,
    timestamp: "2026-09-28T12:00:00.000Z",
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[ghin-profile]");
  assert.deepEqual(calls[0][1], {
    operation: "authorize",
    stage: "lookup_by_email",
    endpoint: "/golfers/search.json",
    httpStatus: 422,
    code: "invalid_response",
    retryable: false,
    durationMs: 431,
    timestamp: "2026-09-28T12:00:00.000Z",
  });
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /private-owner|example\.test|98765432/i);
});

test("diagnostics never serialize error messages, passwords, bearer or Firebase material", () => {
  const sensitive = [
    "password=NeverLogThis",
    "Authorization: Bearer golfer-secret-token",
    "firebase-auth-token",
    "private-owner@example.test",
    "98765432",
  ].join(" ");
  const failure = diagnostics.diagnosticFailure(new Error(sensitive), `/unexpected/${sensitive}`, sensitive);
  const calls = capturePreviewLog(() => diagnostics.logGhinProfileStage({
    operation: "reauthorize",
    stage: "golfer_login",
    ...failure,
    durationMs: 12,
  }));
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /NeverLogThis|Bearer|golfer-secret-token|firebase-auth-token|example\.test|98765432|Authorization/i);
  assert.match(serialized, /"errorName":"Error"/);
  assert.match(serialized, /"endpoint":"\/unknown"/);
  assert.match(serialized, /"code":"unknown"/);
});

test("diagnostic logging is disabled outside Vercel Preview", () => {
  const previousEnv = process.env.VERCEL_ENV;
  const originalInfo = console.info;
  const calls: unknown[][] = [];
  console.info = (...args: unknown[]) => { calls.push(args); };
  try {
    for (const environment of ["production", "development", undefined]) {
      if (environment === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = environment;
      diagnostics.logGhinProfileStage({
        operation: "scores",
        stage: "scores",
        endpoint: "/scores.json",
        httpStatus: 200,
        code: null,
        retryable: false,
        durationMs: 1,
      });
    }
  } finally {
    console.info = originalInfo;
    if (previousEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }
  assert.equal(calls.length, 0);
});

test("every required profile stage has a distinct sanitized diagnostic event", () => {
  const stages = [
    "firebase_installation",
    "golfer_login",
    "golfer_token_extraction",
    "golfer_identity_from_login",
    "lookup_by_ghin",
    "lookup_by_email",
    "identity_validation",
    "profile_persistence",
    "scores",
  ] as const;
  const calls = capturePreviewLog(() => {
    for (const stage of stages) {
      diagnostics.logGhinProfileStage({
        operation: stage === "scores" ? "scores" : "authorize",
        stage,
        endpoint: stage === "scores" ? "/scores.json" : "/identity",
        httpStatus: stage === "scores" ? 200 : null,
        code: null,
        retryable: false,
        durationMs: 1,
      });
    }
  });
  assert.deepEqual(calls.map((call) => (call[1] as { stage: string }).stage), stages);
});

test("wiring adds diagnostics without changing the demonstrated auth contract or enabling score posting", () => {
  const client = readFileSync("lib/ghin/client.ts", "utf8");
  const session = readFileSync("lib/ghin/user-session.server.ts", "utf8");
  const route = readFileSync("app/api/profile/ghin/route.ts", "utf8");
  const diagnosticsSource = readFileSync("lib/ghin/profile-diagnostics.server.ts", "utf8");

  assert.match(client, /user:\s*\{\s*password:\s*credentials\.password,\s*email_or_ghin:\s*credentials\.login,\s*\}/);
  assert.match(client, /token:\s*installationToken\.accessToken/);
  assert.doesNotMatch(client, /remember_me|source:\s*["']GHINcom/);
  assert.match(session, /logAuthenticationTransport\(operation, client\.getTrace\(\)/);
  assert.match(session, /traceGhinRead\(operation, "lookup_by_email"/);
  assert.match(session, /traceGhinRead\(operation, "lookup_by_ghin"/);
  assert.match(route, /stage:\s*"profile_persistence"/);
  assert.match(route, /traceGhinRead\("scores", "scores"/);
  assert.match(diagnosticsSource, /process\.env\.VERCEL_ENV !== "preview"/);
  assert.doesNotMatch(`${route}\n${session}`, /GHIN_AUTH_FAILURE|GHIN_AUTH_STAGE|responseShape|responseKeys|tokenParsed|golferNumberPresent/);
  assert.doesNotMatch(`${route}\n${session}\n${diagnosticsSource}`, /(?:post|create|update|delete|submit)Score\s*\(/i);
  assert.doesNotMatch(route, /scores\/hbh\.json|method:\s*["']POST["'][\s\S]*scores\.json/i);
});
