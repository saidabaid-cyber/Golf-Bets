import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as privacy from "../lib/backyard-ai/privacy";

type Node = { type: unknown; key?: string; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => Node;
const OWNER = "existing-account";
const jsx = (type: unknown, props: Record<string, unknown>, key?: string): Node => ({ type, key, props });

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (!value || typeof value === "boolean") return "";
  if (typeof value === "object") return text((value as Node).props?.children);
  return String(value);
}

// The production provider's render branches are executed with a restored,
// server-verified identity fixture. Bootstrap/cloud effects are not executed:
// these tests are component integration, not live OAuth or Supabase DB QA.
function providerHarness(options: { existingNotice?: boolean; newAccount?: boolean; mappingPending?: boolean; provider?: "google" | "email" } = {}) {
  const source = readFileSync("app/components/account-provider.tsx", "utf8");
  const providerBody = source.slice(source.indexOf("export function AccountProvider("));
  const stateNames = [...providerBody.matchAll(/const \[(\w+),[^\]]+\] = useState(?:<[^;]+?>)?\(/g)].map((match) => match[1]);
  assert.ok(stateNames.includes("accountEntry") && stateNames.includes("profileChecked"));
  const identity = { mode: "authenticated", userId: OWNER, accessToken: "verified-token", displayName: "Cuenta existente", email: "qa@example.invalid", providers: [options.provider || "google"] };
  const initial: Record<string, unknown> = {
    ready: true, identity, cloudConsentChecked: true, profileChecked: true,
    accountEntry: options.mappingPending ? null : { userId: OWNER, profileExists: true, existingAccount: !options.newAccount },
    existingAccountNotice: Boolean(options.existingNotice), profileSetupRequired: Boolean(options.newAccount),
  };
  const states: unknown[] = []; let stateCursor = 0; let effectCalls = 0;
  const react = {
    Fragment: "fragment", createContext: () => ({ Provider: "account-context" }),
    useContext: () => null, useCallback: (value: unknown) => value,
    useRef: (value: unknown) => ({ current: value }), useEffect: () => { effectCalls++; },
    useState: (value: unknown) => {
      const index = stateCursor++;
      if (!(index in states)) states[index] = stateNames[index] in initial ? initial[stateNames[index]] : typeof value === "function" ? value() : value;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
  };
  const checkpointMarker = function AccountConsentCheckpoint() {};
  const exports: Record<string, unknown> = {};
  const failUnexpected = (name: string) => () => { throw new Error(`Unexpected provider side effect: ${name}`); };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, AbortController, Map, require: (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id.endsWith("account-consent-checkpoint")) return { AccountConsentCheckpoint: checkpointMarker };
    if (id.endsWith("account-state")) return new Proxy({ hasCurrentLegalConsent: () => !options.newAccount, hasCurrentBettingDataConsent: () => false }, { get: (target, key) => key in target ? target[key as keyof typeof target] : failUnexpected(String(key)) });
    return new Proxy({}, { get: (_, key) => failUnexpected(`${id}:${String(key)}`) });
  } });
  const child = jsx("application-routes", { children: "HOME · RONDA MANUAL · PERFIL" });
  const render = () => { stateCursor = 0; return (exports.AccountProvider as Component)({ children: child }); };
  return { render, child, checkpointMarker, identity, effectCalls: () => effectCalls };
}

function checkpointHarness(props: Record<string, unknown>, readError: Error) {
  const states: unknown[] = []; const dependencies: unknown[][] = []; const cleanups: (() => void)[] = [];
  let cursor = 0; let pending: (() => void)[] = []; let tree: Node; let reads = 0; let saves = 0;
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync("app/components/account-consent-checkpoint.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, AbortController, Error, setTimeout, clearTimeout, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id === "react") return {
      useState: (initial: unknown) => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }]; },
      useRef: (initial: unknown) => { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
      useEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const index = cursor++; if (!dependencies[index] || deps.some((value, offset) => !Object.is(value, dependencies[index][offset]))) { dependencies[index] = deps; pending.push(() => { cleanups[index]?.(); const cleanup = effect(); if (cleanup) cleanups[index] = cleanup; }); } },
    };
    if (id.endsWith("privacy")) return privacy;
    if (id.endsWith("consent-client")) return {
      readRemoteAiConsentDecisions: async () => { reads++; throw readError; },
      saveRemoteAiConsentDecisions: async () => { saves++; throw new Error("Must not save implicit consent"); },
    };
    if (id === "next/link") return { __esModule: true, default: "a" };
    if (id.endsWith("brand-lockup")) return { BrandLockup: "brand" };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(`Unexpected checkpoint module: ${id}`);
  } });
  const render = () => { cursor = 0; tree = (exports.AccountConsentCheckpoint as Component)(props); const effects = pending; pending = []; for (const effect of effects) effect(); return tree; };
  return {
    render, reads: () => reads, saves: () => saves, tree: () => tree,
    settle: async () => { for (let turn = 0; turn < 4; turn++) { render(); await new Promise<void>((resolve) => setImmediate(resolve)); } },
    continue: () => {
      const button = nodes(tree).find((node) => node.type === "button" && /CONTINUAR A THE BACKYARD/.test(text(node)));
      assert.ok(button, "recoverable consent failure must provide a main-app continuation");
      assert.notEqual(button.props.disabled, true);
      (button.props.onClick as () => void)();
    },
    dispose: () => { for (const cleanup of cleanups) cleanup?.(); },
  };
}

for (const failure of ["network unavailable", "HTTP 500", "42P01 missing consent table", "PGRST202 missing consent RPC"]) {
  test(`standalone consent checkpoint remains recoverable after ${failure} without mutation`, async () => {
    const child = jsx("application-routes", { children: "HOME · RONDA MANUAL · PERFIL" });
    const h = checkpointHarness({ userId: OWNER, accessToken: "verified-token", legalRequired: false, onAcceptLegal: async () => {}, onBack: () => {}, children: child }, new Error(failure));
    try {
      await h.settle(); assert.notEqual(h.tree(), child); h.continue(); await h.settle();
      assert.equal(h.tree(), child);
      assert.match(text(h.tree()), /HOME · RONDA MANUAL · PERFIL/);
      assert.equal(h.saves(), 0); assert.equal(h.reads(), 1);
      h.render(); assert.equal(h.tree(), child, "ordinary app rerender cannot return user to access loop");
    } finally { h.dispose(); }
  });
}

test("verified existing account with completed onboarding enters the app directly", () => {
  const provider = providerHarness({ existingNotice: true });
  const screen = provider.render();
  assert.equal(screen.type, "account-context");
  assert.ok(nodes(screen).includes(provider.child));
  assert.notEqual(screen.type, provider.checkpointMarker);
  assert.equal(nodes(screen).some(node => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"), false);
});

test("new authenticated account still enters profile onboarding before the consent checkpoint", () => {
  const provider = providerHarness({ newAccount: true }); const screen = provider.render();
  assert.notEqual(screen.type, provider.checkpointMarker);
  assert.ok(nodes(screen).some((node) => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"));
  assert.ok(!nodes(screen).includes(provider.child));
});

for (const authProvider of ["google", "email"] as const) {
  test(`${authProvider}: verified existing signup opens the existing app with an informational notice, not a second sign-in gate`, () => {
    const provider = providerHarness({ existingNotice: true, provider: authProvider });
    const screen = provider.render();
    assert.equal(screen.type, "account-context");
    assert.ok(nodes(screen).includes(provider.child));
    assert.match(text(screen), /Ya tienes una cuenta\. Vamos a iniciar sesión\./);
    assert.equal(nodes(screen).some(node => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"), false);
    const dismiss = nodes(screen).find(node => node.type === "button" && node.props["aria-label"] === "Cerrar aviso de cuenta existente");
    assert.ok(dismiss); (dismiss.props.onClick as () => void)();
    assert.ok(nodes(provider.render()).includes(provider.child), "dismissing optional information does not perform login, create data, or close the app");
  });
}

test("unresolved authenticated mapping cannot display existing-account information or open account creation", () => {
  const provider = providerHarness({ mappingPending: true }); const screen = provider.render();
  assert.match(text(screen), /Verificando tu cuenta/);
  assert.doesNotMatch(text(screen), /Ya tienes una cuenta/);
  assert.ok(!nodes(screen).includes(provider.child));
  assert.equal(nodes(screen).some(node => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"), false);
});
