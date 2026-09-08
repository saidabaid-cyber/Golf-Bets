import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const ORIGIN = "https://beta.example.test";
const workerSource = readFileSync("public/sw.js", "utf8");

type WorkerListener = (event: Record<string, unknown>) => void;

function requestUrl(request: unknown) {
  if (typeof request === "string") return new URL(request, ORIGIN).href;
  if (request instanceof URL) return request.href;
  if (request && typeof request === "object" && "url" in request && typeof request.url === "string") return request.url;
  throw new Error("unknown request");
}

function createWorkerHarness(respond: (request: Request) => Promise<Response>) {
  const listeners = new Map<string, WorkerListener>();
  const entries = new Map<string, Response>();
  const seen: Request[] = [];
  const hooks: {
    put?: (request: Request, response: Response, commit: () => void) => Promise<void>;
    delete?: () => void;
  } = {};
  const cache = {
    put: async (request: Request, response: Response) => {
      const commit = () => { entries.set(requestUrl(request), response.clone()); };
      if (hooks.put) return hooks.put(request, response, commit);
      commit();
    },
    match: async (request: Request) => entries.get(requestUrl(request))?.clone(),
  };
  const cacheStorage = {
    open: async () => cache,
    keys: async () => ["the-backyard-shell-v6"],
    delete: async () => {
      hooks.delete?.();
      entries.clear();
      return true;
    },
  };
  const fetcher = async (request: Request) => { seen.push(request); return respond(request); };
  const scope = {
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener),
  };
  runInNewContext(workerSource, { self: scope, caches: cacheStorage, fetch: fetcher, Request, Response, URL, Promise, Set, Error });
  return { listeners, entries, seen, hooks };
}

function runInstall(listeners: Map<string, WorkerListener>) {
  let pending: Promise<unknown> | undefined;
  listeners.get("install")?.({ waitUntil: (value: Promise<unknown>) => { pending = value; } } as unknown as Record<string, unknown>);
  assert.ok(pending, "install must register waitUntil");
  return pending;
}

function requiredShellResponse(request: Request, failedPath = "") {
  const path = new URL(request.url).pathname;
  if (path === failedPath) return Promise.resolve(new Response("unavailable", { status: 503 }));
  if (path === "/") return Promise.resolve(new Response('<!doctype html><script src="/_next/static/app.js"></script>', { status: 200 }));
  if (path === "/offline.html") return Promise.resolve(new Response("offline-shell", { status: 200 }));
  if (path === "/_next/static/app.js") return Promise.resolve(new Response("app-shell", { status: 200 }));
  return Promise.resolve(new Response("optional", { status: 404 }));
}

test("instalación PWA rechaza root o chunks incompletos antes de publicar un cache parcial", async () => {
  for (const failedPath of ["/", "/_next/static/app.js"]) {
    const harness = createWorkerHarness((request) => requiredShellResponse(request, failedPath));
    await assert.rejects(runInstall(harness.listeners));
    assert.equal(harness.entries.size, 0, failedPath);
  }
});

test("instalación PWA confirma root, offline y chunks con requests sin credenciales", async () => {
  const harness = createWorkerHarness((request) => requiredShellResponse(request));
  await runInstall(harness.listeners);
  for (const path of ["/", "/offline.html", "/_next/static/app.js"]) {
    assert.equal(harness.entries.has(new URL(path, ORIGIN).href), true, path);
  }
  assert.equal(harness.seen.every((request) => request.credentials === "omit" && request.redirect === "error"), true);
});

test("instalación PWA espera todos los writes fallidos antes de borrar el cache", async () => {
  const harness = createWorkerHarness((request) => requiredShellResponse(request));
  const events: string[] = [];
  harness.hooks.put = async (request, _response, commit) => {
    const path = new URL(request.url).pathname;
    if (path === "/") {
      events.push("root-rejected");
      throw new Error("quota exceeded");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    commit();
    events.push(`${path}-settled`);
  };
  harness.hooks.delete = () => { events.push("cache-deleted"); };

  await assert.rejects(runInstall(harness.listeners), /quota exceeded/);
  assert.equal(events.at(-1), "cache-deleted");
  assert.equal(harness.entries.size, 0);
});

test("navegaciones privadas nunca se cachean y usan la página offline dedicada", async () => {
  let offline = false;
  const harness = createWorkerHarness(async (request) => {
    if (offline) throw new Error("offline");
    const path = new URL(request.url).pathname;
    if (path === "/auth/callback") return new Response("callback", { status: 200 });
    return requiredShellResponse(request);
  });
  await runInstall(harness.listeners);
  const before = harness.entries.size;
  const dispatchNavigation = (url: string) => {
    const captured: { value?: Promise<Response> } = {};
    harness.listeners.get("fetch")?.({
      request: { method: "GET", mode: "navigate", url },
      respondWith: (value: Promise<Response>) => { captured.value = value; },
    } as unknown as Record<string, unknown>);
    assert.ok(captured.value, "navigation must use respondWith");
    return captured.value;
  };
  assert.equal(await (await dispatchNavigation(`${ORIGIN}/auth/callback?code=secret`)).text(), "callback");
  assert.equal(harness.entries.size, before);
  assert.equal(harness.entries.has(`${ORIGIN}/auth/callback?code=secret`), false);
  offline = true;
  assert.equal(await (await dispatchNavigation(`${ORIGIN}/polla/private-code`)).text(), "offline-shell");
});
