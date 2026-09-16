import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { AI_IMAGE_PROCESSING_CONSENT as IMAGE, AI_PROVIDER_PROCESSING_CONSENT as TEXT, BACKYARD_AI_PROVIDER_CONSENT_VERSION as VERSION } from "../lib/backyard-ai/privacy";

// Executes the production TSX handlers and effects. Browser layout is checked
// separately by qa-account-consent-browser.mjs; this harness does not claim DB QA.
type Decision = { scope: string; status: "missing" | "accepted" | "declined" | "revoked"; active: boolean; policyVersion: string; acceptedAt: string | null; revokedAt: string | null; source: string | null };
type Remote = { decisions: Decision[]; resolved: boolean; policyVersion: string };
type Node = { type: unknown; props: Record<string, unknown> };
const LAUNCH = "AI_LAUNCH_MONITOR_PROCESSING_CONSENT";
function remote(text: Decision["status"] = "missing", image: Decision["status"] = "missing", launch: Decision["status"] = "missing"): Remote {
  const statuses = [text, image, launch];
  return { policyVersion: VERSION, resolved: statuses.every((status) => status !== "missing"), decisions: [TEXT, IMAGE, LAUNCH].map((scope, index) => ({ scope, status: statuses[index], active: statuses[index] === "accepted", policyVersion: VERSION, acceptedAt: null, revokedAt: null, source: null })) };
}
function harness(initial = remote(), onboarding = true, options: { failSave?: boolean; failLegal?: boolean; holdSave?: boolean; failRead?: boolean; holdRefreshRead?: boolean } = {}) {
  const values: unknown[] = []; const effectDeps: unknown[][] = []; const cleanups: (() => void)[] = [];
  let cursor = 0; let effects: (() => void)[] = []; let tree: unknown; let server = initial;
  const calls: { decisions: { scope: string; accepted: boolean }[]; source: string; userId: string; token: string }[] = [];
  const order: string[] = []; let reads = 0; let legalCalls = 0; let release: (() => void) | null = null; let releaseRead: (() => void) | null = null;
  const props = { userId: "qa-user", accessToken: "qa-token", legalRequired: onboarding, onBack: async () => {}, children: { type: "app", props: {} }, onAcceptLegal: async () => { legalCalls++; order.push("legal"); if (options.failLegal) throw new Error("legal failed"); props.legalRequired = false; } };
  const exports: Record<string, unknown> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const code = ts.transpileModule(readFileSync("app/components/account-consent-checkpoint.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, AbortController, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id === "react") return {
      useState: (initialValue: unknown) => { const index = cursor++; if (!(index in values)) values[index] = typeof initialValue === "function" ? initialValue() : initialValue; return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
      useRef: (initialValue: unknown) => { const index = cursor++; if (!(index in values)) values[index] = { current: initialValue }; return values[index]; },
      useEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const index = cursor++; if (!effectDeps[index] || deps.some((value, offset) => !Object.is(value, effectDeps[index][offset]))) { effectDeps[index] = deps; effects.push(() => { cleanups[index]?.(); const cleanup = effect(); if (cleanup) cleanups[index] = cleanup; }); } },
    };
    if (id === "next/link") return { __esModule: true, default: "a" };
    if (id.endsWith("privacy")) return { AI_PROVIDER_PROCESSING_CONSENT: TEXT, AI_IMAGE_PROCESSING_CONSENT: IMAGE, AI_LAUNCH_MONITOR_PROCESSING_CONSENT: LAUNCH };
    if (id.endsWith("consent-client")) return {
      readRemoteAiConsentDecisions: async () => { reads++; const snapshot = server; if (options.holdRefreshRead && reads > 1) await new Promise<void>((resolve) => { releaseRead = resolve; }); if (options.failRead) throw new Error("offline"); return snapshot; },
      saveRemoteAiConsentDecisions: async (token: string, userId: string, decisions: { scope: string; accepted: boolean }[], source: string) => {
        calls.push({ token, userId, decisions, source }); order.push("save");
        if (options.holdSave) await new Promise<void>((resolve) => { release = resolve; });
        if (options.failSave) throw new Error("write failed");
        server = { ...server, resolved: true, decisions: server.decisions.map((decision) => { const next = decisions.find((item) => item.scope === decision.scope); return next ? { ...decision, status: next.accepted ? "accepted" : "declined", active: next.accepted, source } : decision; }) };
        order.push("saved"); return server;
      },
    };
    if (id.endsWith("brand-lockup")) return { BrandLockup: "brand" };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected module: ${id}`);
  } });
  function render() { cursor = 0; tree = (exports.AccountConsentCheckpoint as (props: unknown) => unknown)(props); const pending = effects; effects = []; for (const effect of pending) effect(); return tree; }
  function nodes(value = tree): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children ?? null)]; }
  function text(value: unknown = tree): string { if (Array.isArray(value)) return value.map(text).join(" "); if (!value || typeof value === "boolean") return ""; if (typeof value === "object") return text((value as Node).props?.children ?? null); return String(value); }
  const checkboxes = () => nodes().filter((node) => node.type === "input" && node.props.type === "checkbox");
  const submit = () => nodes().find((node) => node.type === "button" && /CREAR CUENTA Y CONTINUAR|GUARDAR Y CONTINUAR|Guardando/.test(text(node)))!;
  return { props, calls, order, nodes, text, checkboxes, submit, reads: () => reads, legalCalls: () => legalCalls, server: () => server, tree: () => tree,
    settle: async () => { for (let index = 0; index < 4; index++) { render(); await new Promise<void>((resolve) => setImmediate(resolve)); } },
    check: (index: number, checked = true) => { (checkboxes()[index].props.onChange as (event: unknown) => void)({ target: { checked } }); render(); },
    click: () => { (submit().props.onClick as () => void)(); render(); },
    release: () => release?.(), releaseRead: () => releaseRead?.(), unmount: () => { for (const cleanup of cleanups) cleanup?.(); },
  };
}

test("onboarding starts with every legal/AI checkbox unselected and legal checks required", async () => {
  const h = harness(); await h.settle();
  assert.match(h.text(), /ANTES DE EMPEZAR/); assert.equal(h.checkboxes().length, 7);
  assert.ok(h.checkboxes().every((node) => node.props.checked === false)); assert.equal(h.submit().props.disabled, true);
  h.check(0); h.check(1); h.check(2); assert.equal(h.submit().props.disabled, false);
  assert.equal(h.calls.length, 0);
});

test("affirmative choices persist as onboarding before legal completion and app entry", async () => {
  const h = harness(); await h.settle(); for (const index of [0, 1, 2, 4, 5, 6]) h.check(index);
  h.click(); await h.settle(); assert.equal((h.tree() as Node).type, "app");
  assert.deepEqual(h.order, ["save", "saved", "legal"]); assert.equal(h.calls[0].source, "onboarding");
  assert.equal(h.calls[0].userId, "qa-user"); assert.equal(h.calls[0].token, "qa-token");
  assert.ok(h.calls[0].decisions.every((decision) => decision.accepted));
});

test("accept text and decline image is an explicit persisted choice, not missing consent", async () => {
  const h = harness(); await h.settle(); for (const index of [0, 1, 2, 4]) h.check(index);
  h.click(); await h.settle(); assert.equal(h.server().resolved, true);
  assert.deepEqual(h.server().decisions.map((decision) => decision.status), ["accepted", "declined", "declined"]);
  const reloaded = harness(h.server(), false); await reloaded.settle();
  assert.equal((reloaded.tree() as Node).type, "app"); assert.equal(reloaded.calls.length, 0); assert.equal(reloaded.reads(), 1);
});

test("all optional AI choices can be declined without blocking account completion", async () => {
  const h = harness(); await h.settle(); for (const index of [0, 1, 2]) h.check(index);
  h.click(); await h.settle(); assert.equal((h.tree() as Node).type, "app"); assert.ok(h.calls[0].decisions.every((decision) => !decision.accepted));
});

test("existing account sees only missing purpose, and stores source account_update", async () => {
  const h = harness(remote("accepted", "missing", "declined"), false); await h.settle();
  assert.match(h.text(), /ACTUALIZAMOS TUS PREFERENCIAS/); assert.equal(h.checkboxes().length, 1);
  assert.doesNotMatch(h.text(), /texto o dictado/); h.check(0); h.click(); await h.settle();
  assert.equal(h.calls[0].source, "account_update"); assert.equal(h.calls[0].decisions.length, 1); assert.equal(h.calls[0].decisions[0].scope, IMAGE); assert.equal(h.legalCalls(), 0);
});

test("declined and revoked choices already resolved on server never reopen onboarding", async () => {
  for (const state of [remote("declined", "revoked", "declined"), remote("accepted", "accepted", "accepted")]) { const h = harness(state, false); await h.settle(); assert.equal((h.tree() as Node).type, "app"); assert.equal(h.checkboxes().length, 0); }
});

test("failed server save stays in checkpoint, preserves selection, never accepts legal or enters app", async () => {
  const h = harness(remote(), true, { failSave: true }); await h.settle(); for (const index of [0, 1, 2, 4]) h.check(index);
  h.click(); await h.settle(); assert.notEqual((h.tree() as Node).type, "app"); assert.equal(h.legalCalls(), 0);
  assert.match(h.text(), /No pudimos guardar todas/); assert.equal(h.checkboxes()[4].props.checked, true); assert.equal(h.submit().props.disabled, false);
});

test("rapid double submit creates one server mutation and disables controls while pending", async () => {
  const h = harness(remote(), false, { holdSave: true }); await h.settle(); h.click(); h.click();
  assert.equal(h.calls.length, 1); assert.equal(h.submit().props.disabled, true); assert.equal(h.nodes().find((node) => node.type === "fieldset")?.props.disabled, true);
  h.release(); await h.settle(); assert.equal((h.tree() as Node).type, "app");
});

test("legal save failure does not enter app; remote decisions remain durable for retry", async () => {
  const h = harness(remote(), true, { failLegal: true }); await h.settle(); for (const index of [0, 1, 2]) h.check(index);
  h.click(); await h.settle(); assert.notEqual((h.tree() as Node).type, "app"); assert.equal(h.server().resolved, true); assert.match(h.text(), /No pudimos guardar todas/);
});

test("failed authoritative read never infers consent from a browser flag", async () => {
  const h = harness(remote(), false, { failRead: true }); await h.settle(); assert.match(h.text(), /No pudimos consultar tus preferencias/);
  assert.equal(h.checkboxes().length, 0); assert.equal(h.calls.length, 0); assert.notEqual((h.tree() as Node).type, "app");
});

test("account remount discards prior checked choices and provider keys checkpoint by user", async () => {
  const first = harness(); await first.settle(); first.check(4); first.unmount();
  const second = harness(); await second.settle(); assert.ok(second.checkboxes().every((node) => node.props.checked === false));
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.ok(/AccountConsentCheckpoint[\s\S]{0,160}key=\{identity\.userId\}/.test(provider), "checkpoint must remount on account change");
});

test("stale token-refresh GET cannot replace successful POST decisions with missing choices", async () => {
  const h = harness(remote(), false, { holdRefreshRead: true }); await h.settle();
  h.props.accessToken = "qa-refreshed-token"; await h.settle(); assert.equal(h.reads(), 2);
  h.check(0); h.check(1); h.click(); await h.settle(); assert.equal((h.tree() as Node).type, "app");
  h.releaseRead(); await h.settle(); assert.equal((h.tree() as Node).type, "app"); assert.equal(h.checkboxes().length, 0);
});

test("unmount during save never executes the next account's legal callback", async () => {
  const h = harness(remote(), true, { holdSave: true }); await h.settle(); for (const index of [0, 1, 2]) h.check(index);
  h.click(); h.unmount(); h.release(); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.legalCalls(), 0);
});
