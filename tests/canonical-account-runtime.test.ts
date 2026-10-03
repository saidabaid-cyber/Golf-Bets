import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { EmailOtpRequestError, OtpSendGate, otpRetrySeconds } from "../lib/auth-flow";

const provider = readFileSync("app/components/account-provider.tsx", "utf8");
const panel = readFileSync("app/components/profile-account-panel.tsx", "utf8");
function productionFunction(source: string, name: string) {
  const file = ts.createSourceFile("runtime.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file); assert.equal(found.length, 1, name);
  return ts.transpileModule(`exports.run = ${found[0].getText(file)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element; return [node, ...elements(node.props.children)];
}
function content(value: unknown): string {
  if (Array.isArray(value)) return value.map(content).join("");
  if (value && typeof value === "object") return content((value as Element).props?.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function accessHarness(available = true, failure?: string) {
  const state: unknown[] = [], refs: unknown[] = [], sends: string[] = [];
  let cursor = 0, refCursor = 0;
  const exports: { run?: (props: unknown) => unknown } = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(productionFunction(provider, "AccessScreen"), {
    exports, require: () => ({ jsx, jsxs: jsx, Fragment: "fragment" }),
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in state)) state[index] = index === 10 ? { status: "ready", email: true, google: available } : initial;
      return [state[index], (value: unknown) => { state[index] = value; }];
    },
    useRef: (initial: unknown) => { const i = refCursor++; refs[i] ??= { current: initial }; return refs[i]; },
    useEffect: () => undefined, OtpSendGate, otpRetrySeconds, EmailOtpRequestError,
    Image: "image", Link: "link", BrandLockup: "brand", ModalCloseButton: "close",
    isValidEmail: (email: string) => email.includes("@"), setAuthSessionPersistence: () => undefined,
    rememberAccountEntryIntent: () => undefined, sessionStorage: { setItem: () => undefined }, OTP_COOLDOWN_KEY: "qa-cooldown",
    requestEmailOtp: async (_email: string, intent: string) => {
      sends.push(intent);
      if (failure) throw new EmailOtpRequestError("Human message", failure, failure === "ACCOUNT_ALREADY_EXISTS" ? 409 : 404);
    },
  });
  const render = () => { cursor = refCursor = 0; return elements(exports.run!({ onAuthenticated: () => undefined, sessionError: "" })); };
  const button = (label: string) => {
    const node = render().find(row => row.type === "button" && content(row.props.children) === label);
    assert.ok(node, label); return node;
  };
  const click = (label: string) => (button(label).props.onClick as () => void)();
  const email = () => {
    const input = render().find(row => row.props.id === "access-email"); assert.ok(input);
    (input.props.onChange as (event: unknown) => void)({ target: { value: "qa@example.invalid" } });
  };
  return { render, click, email, sends, state };
}

test("actual AccessScreen renders only the approved entry paths", () => {
  for (const available of [false, true]) {
    const h = accessHarness(available);
    assert.deepEqual(h.render().filter(n => n.type === "button").map(n => content(n.props.children)), ["Crear cuenta", "Iniciar sesión"]);
    h.click("Iniciar sesión");
    const labels = h.render().filter(n => n.type === "button").map(n => content(n.props.children));
    assert.equal(labels.includes("Continuar con Google"), available);
    assert.ok(!labels.some(label => /Apple|invitado|contraseña/i.test(label)));
  }
});

for (const [failure, intent, initial, emailButton, action] of [
  ["ACCOUNT_NOT_FOUND", "login", "Iniciar sesión", "Continuar con correo", "CREAR CUENTA"],
  ["ACCOUNT_ALREADY_EXISTS", "create", "Crear cuenta", "Registro con email", "INICIAR SESIÓN"],
] as const) {
  test(`actual access collision ${failure} waits for explicit opposite intent`, async () => {
    const h = accessHarness(true, failure);
    h.click(initial); h.click(emailButton); h.email(); h.click("Enviar código");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.sends, [intent]);
    assert.equal(h.state[5], false, "no verification UI when the server did not send OTP");
    assert.ok(h.render().find(n => n.type === "button" && content(n.props.children) === action));
    h.click(action); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.sends, [intent, intent === "login" ? "create" : "login"]);
  });
}

test("the page mounts ProfileAccountPanel and wires the current dialogs and canonical onboarding", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const parsed = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mounted: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "ProfileAccountPanel") mounted.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.equal(mounted.length, 2, "profile and account views use the same runtime component");
  for (const node of mounted) assert.match(node.attributes.getText(parsed), /onStatisticsReset=\{applyStatisticsReset\}/);
  assert.doesNotMatch(page, /<AccountPanel\b|import .*\bAccountPanel\b/);
  assert.match(provider, /if \(!identity \|\| Boolean\(identity.mode === "guest"\) \|\| accessRequested\) return <AccessScreen/,
    "cached legacy guest workspaces cannot bypass authenticated access");
  assert.match(panel, /<StatisticsResetDialog[^\n]*onConfirm=\{\(\) => void deleteStatistics\(\)\}/);
  assert.match(panel, /<AccountDataDialog[^\n]*onConfirm=\{\(\) => void deleteAccount\(\)\}/);
  assert.match(panel, /onDeactivate=\{deactivationAvailable[\s\S]*void deactivateAccount\(\)/);
  assert.match(provider, /<OnboardingPrivacyChoices[^>]*userId=\{identity.userId\}/);
  assert.match(provider, /<BetaOnboardingFlow/);
});

for (const word of ["ELIMINAR", "eliminar", " ELIMINAR", ""]) {
  test(`actual ProfileAccountPanel statistics handler exact confirmation '${word}'`, async () => {
    const calls: string[] = []; const exports: { run?: () => Promise<void> } = {};
    const inflight = { current: false };
    runInNewContext(productionFunction(panel, "deleteStatistics"), {
      exports, statsInFlight: inflight, statsRequestId: { current: undefined },
      identity: { mode: "authenticated", userId: "owner", accessToken: "qa-test-token" },
      deleteStatsText: word, isStatisticsDeleteConfirmation: (value: string) => value === "ELIMINAR",
      mounted: { current: true }, liveOwner: { current: "owner" }, crypto: { randomUUID: () => "request" }, fetch: () => undefined,
      requestStatisticsReset: async (token: string, confirmation: string) => { assert.equal(token, "qa-test-token"); assert.equal(confirmation, "ELIMINAR"); calls.push("request"); return { resetAt: "qa-reset" }; },
      onStatisticsReset: () => calls.push("apply"), setDeleteStatsOpen: () => calls.push("close"),
      setDeleteStatsText: () => undefined, setMessageKind: () => undefined,
      setDeletingStatistics: () => undefined, setMessage: () => undefined, setDestructiveError: () => undefined,
    });
    await exports.run!();
    assert.deepEqual(calls, word === "ELIMINAR" ? ["request", "apply", "close"] : []);
    assert.equal(inflight.current, false);
  });
}
