import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AuthSessionRecoveryError } from "../lib/auth-flow";
import { consumeGpsPilotReturn, rememberGpsPilotReturn, GPS_PILOT_PATH, GPS_PILOT_RETURN_KEY } from "../lib/gps-pilot-la-vista-1/auth-return";
import { watchGpsPilotSession, type PilotSessionState } from "../lib/gps-pilot-la-vista-1/session";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const host = "dev.thebackyard.com.mx";
test("pilot login destination survives storage reload and is consumed once", () => {
  const store = storage(); rememberGpsPilotReturn(store, host, 1000);
  const reloaded = { ...store };
  assert.equal(consumeGpsPilotReturn(reloaded, host, 2000), GPS_PILOT_PATH);
  assert.equal(consumeGpsPilotReturn(reloaded, host, 2001), null);
});
test("normal login keeps its normal destination without a pending pilot intent", () => {
  assert.equal(consumeGpsPilotReturn(storage(), host), null);
});
test("pilot return rejects external, encoded, protocol-relative and arbitrary paths", () => {
  for (const path of ["https://evil.example", "//evil.example", "/%2f%2fevil", "/manage", `${GPS_PILOT_PATH}?next=evil`]) {
    const store = storage(); store.setItem(GPS_PILOT_RETURN_KEY, JSON.stringify({ path, createdAt: 1000 }));
    assert.equal(consumeGpsPilotReturn(store, host, 1001), null);
  }
});
test("pilot login intent is expired after one hour and cannot be future-dated", () => {
  for (const now of [999, 3601001]) {
    const store = storage(); rememberGpsPilotReturn(store, host, 1000);
    assert.equal(consumeGpsPilotReturn(store, host, now), null);
  }
});
test("pilot return is confined to DEV and tolerates disabled storage", () => {
  for (const domain of ["app.thebackyard.com.mx", "beta.thebackyard.com.mx", "other.vercel.app"]) {
    const store = storage(); rememberGpsPilotReturn(store, domain, 1000); assert.equal(store.getItem(GPS_PILOT_RETURN_KEY), null);
    rememberGpsPilotReturn(store, host, 1000); assert.equal(consumeGpsPilotReturn(store, domain, 1001), null);
  }
  const blocked = { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("disabled"); }, removeItem: () => { throw new Error("disabled"); } };
  assert.doesNotThrow(() => rememberGpsPilotReturn(blocked, host)); assert.equal(consumeGpsPilotReturn(blocked, host), null);
});

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
const session = (token: string) => ({ access_token: token } as Session);
function authFixture() {
  let event: ((event: AuthChangeEvent, value: Session | null) => void) | null = null; let unsubscribed = false;
  const auth = { onAuthStateChange: (callback: typeof event) => { event = callback; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; } } as Parameters<typeof watchGpsPilotSession>[0];
  return { auth, emit: (name: AuthChangeEvent) => event?.(name, null), unsubscribed: () => unsubscribed };
}
test("pilot waits for session validation before showing an authenticated state", async () => {
  const mock = authFixture(), states: PilotSessionState[] = [];
  let resolve!: (value: Session | null) => void;
  const stop = watchGpsPilotSession(mock.auth, state => states.push(state), () => new Promise(done => { resolve = done; }));
  try { await tick(); assert.equal(states.at(-1)?.status, "checking"); resolve(session("valid")); await tick(); assert.equal(states.at(-1)?.token, "valid"); }
  finally { stop(); }
});
test("a slow initial session read cannot overwrite a later sign-in", async () => {
  const mock = authFixture(), states: PilotSessionState[] = [], pending: Array<(value: Session | null) => void> = [];
  const stop = watchGpsPilotSession(mock.auth, state => states.push(state), () => new Promise(done => pending.push(done)));
  try {
    await tick(); mock.emit("SIGNED_IN"); await tick(); pending[1](session("new")); await tick();
    pending[0](null); await tick(); assert.equal(states.at(-1)?.token, "new");
  } finally { stop(); }
});
test("sign-out invalidates in-flight permission/session work", async () => {
  const mock = authFixture(), states: PilotSessionState[] = [];
  let resolve!: (value: Session | null) => void;
  const stop = watchGpsPilotSession(mock.auth, state => states.push(state), () => new Promise(done => { resolve = done; }));
  try { await tick(); mock.emit("SIGNED_OUT"); resolve(session("old")); await tick(); assert.equal(states.at(-1)?.status, "anonymous"); }
  finally { stop(); }
});
test("transient session failures stay retryable, not permission denials", async () => {
  const mock = authFixture(), states: PilotSessionState[] = [];
  const stop = watchGpsPilotSession(mock.auth, state => states.push(state), async () => { throw new AuthSessionRecoveryError("transient", new Error("network")); });
  try { await tick(); assert.equal(states.at(-1)?.status, "error"); } finally { stop(); }
});
test("definitive session expiration offers login without a false permission denial", async () => {
  const mock = authFixture(), states: PilotSessionState[] = [];
  const stop = watchGpsPilotSession(mock.auth, state => states.push(state), async () => { throw new AuthSessionRecoveryError("invalid", new Error("expired")); });
  try { await tick(); assert.equal(states.at(-1)?.status, "anonymous"); } finally { stop(); }
});
test("leaving pilot unsubscribes and ignores late session completion", async () => {
  const mock = authFixture(), states: PilotSessionState[] = [];
  let resolve!: (value: Session | null) => void;
  const stop = watchGpsPilotSession(mock.auth, state => states.push(state), () => new Promise(done => { resolve = done; }));
  await tick(); const count = states.length; stop(); resolve(session("old")); await tick();
  assert.equal(mock.unsubscribed(), true); assert.equal(states.length, count);
});

function runPilotLogin(identity: { mode: string; accessToken: string | null }) {
  const store = storage(), effects: Array<() => void> = [], redirects: string[] = [], components: Array<() => unknown> = [];
  const exports: any = {};
  const source = ts.transpileModule(readFileSync("app/components/gps-pilot-login.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, { exports, window: { location: { host, replace: (path: string) => redirects.push(path) } }, require: (name: string) => {
    if (name === "react") return { useEffect: (fn: () => void) => effects.push(fn) };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown) => { if (typeof type === "function") components.push(type as () => unknown); return null; } };
    if (name.endsWith("account-provider")) return { AccountProvider: () => null, useBackyardAccount: () => ({ identity }) };
    if (name.endsWith("auth-return")) return { consumeGpsPilotReturn, rememberGpsPilotReturn, GPS_PILOT_PATH, gpsReturnStorage: () => store };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  exports.GpsPilotLogin();
  for (const component of components.filter(component => component.name === "ReturnToPilot")) component();
  for (const effect of effects) effect();
  return { redirects, pending: store.getItem(GPS_PILOT_RETURN_KEY) };
}
test("existing login provider returns its authenticated child to GPS, not Home", () => {
  const result = runPilotLogin({ mode: "authenticated", accessToken: "verified-test-token" });
  assert.deepEqual(result.redirects, [GPS_PILOT_PATH]); assert.equal(result.pending, null);
});
test("pilot login never navigates while the existing provider is resolving session", () => {
  const result = runPilotLogin({ mode: "authenticated", accessToken: null });
  assert.deepEqual(result.redirects, []); assert.ok(result.pending);
});
