import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

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

// Executes the production provider's render branches with a server-verified
// identity. Bootstrap effects are intentionally not live OAuth/DB QA.
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
  const states: unknown[] = []; let stateCursor = 0;
  const react = {
    Fragment: "fragment", createContext: () => ({ Provider: "account-context" }),
    useContext: () => null, useCallback: (value: unknown) => value,
    useRef: (value: unknown) => ({ current: value }), useEffect: () => undefined,
    useState: (value: unknown) => {
      const index = stateCursor++;
      if (!(index in states)) states[index] = stateNames[index] in initial ? initial[stateNames[index]] : typeof value === "function" ? value() : value;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
  };
  const exports: Record<string, unknown> = {};
  const failUnexpected = (name: string) => () => { throw new Error(`Unexpected provider side effect: ${name}`); };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, AbortController, Map, require: (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id.endsWith("account-state")) return new Proxy({ hasCurrentLegalConsent: () => !options.newAccount, hasCurrentBettingDataConsent: () => false }, { get: (target, key) => key in target ? target[key as keyof typeof target] : failUnexpected(String(key)) });
    return new Proxy({}, { get: (_, key) => failUnexpected(`${id}:${String(key)}`) });
  } });
  const child = jsx("application-routes", { children: "HOME · RONDA MANUAL · PERFIL" });
  const render = () => { stateCursor = 0; return (exports.AccountProvider as Component)({ children: child }); };
  return { render, child };
}

test("verified existing account with completed onboarding enters the app directly", () => {
  const provider = providerHarness({ existingNotice: true });
  const screen = provider.render();
  assert.equal(screen.type, "account-context");
  assert.ok(nodes(screen).includes(provider.child));
  assert.equal(nodes(screen).some(node => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"), false);
  assert.doesNotMatch(text(screen), /Autorizaciones iniciales|Permisos de este dispositivo/);
});

test("new authenticated account enters the single profile/onboarding flow before the app", () => {
  const provider = providerHarness({ newAccount: true }); const screen = provider.render();
  assert.ok(nodes(screen).some((node) => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"));
  assert.ok(!nodes(screen).includes(provider.child));
});

for (const authProvider of ["google", "email"] as const) {
  test(`${authProvider}: verified existing signup opens the app with an informational notice, not a second gate`, () => {
    const provider = providerHarness({ existingNotice: true, provider: authProvider });
    const screen = provider.render();
    assert.equal(screen.type, "account-context");
    assert.ok(nodes(screen).includes(provider.child));
    assert.match(text(screen), /Ya tienes una cuenta\. Vamos a iniciar sesión\./);
    assert.equal(nodes(screen).some(node => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"), false);
  });
}

test("unresolved authenticated mapping cannot display account information or create a profile", () => {
  const provider = providerHarness({ mappingPending: true }); const screen = provider.render();
  assert.match(text(screen), /Verificando tu cuenta/);
  assert.doesNotMatch(text(screen), /Ya tienes una cuenta/);
  assert.ok(!nodes(screen).includes(provider.child));
  assert.equal(nodes(screen).some(node => typeof node.type === "function" && node.type.name === "ProfileSetupScreen"), false);
});
