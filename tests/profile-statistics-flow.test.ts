import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as statistics from "../lib/statistics-reset";

// Production Profile handlers + production HTTP reset client. The HTTP boundary
// is synthetic: these tests do not replace isolated Supabase Preview QA.
type Element = { type: unknown; props: Record<string, unknown> };
function harness() {
  const slots: unknown[] = [], dependencies: unknown[][] = [];
  let cursor = 0, tree: unknown, pending: (() => void)[] = [];
  let responseStatus = 200, release: (() => void) | undefined, hold = false;
  const calls: Record<string, unknown>[] = [], applied: statistics.StatisticsResetRecord[] = [];
  const identity = { mode: "authenticated", userId: "qa-self", accessToken: "qa-token", displayName: "QA", providers: ["email"], profileVisibility: "friends" };
  const account = { identity, acceptances: [], cloudIssues: [], cloudStatus: "synced", cloudLinked: true };
  const exports: Record<string, unknown> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const effect = (callback: () => void, deps: unknown[]) => {
    const index = cursor++;
    if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) {
      dependencies[index] = deps; pending.push(callback);
    }
  };
  const fetcher = async (_url: unknown, options: RequestInit) => {
    if (options?.method !== "DELETE") return new Response(JSON.stringify({ visibility: "friends" }), { status: 200 });
    const body = JSON.parse(String(options.body)); calls.push(body);
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    return new Response(JSON.stringify(responseStatus === 200
      ? { resetAt: "2026-09-16T12:00:00.000Z", strategy: "RESET_FROM_DATE", requestId: body.requestId }
      : { error: "No se confirmó el reinicio. Reintenta." }), { status: responseStatus });
  };
  runInNewContext(ts.transpileModule(readFileSync("app/components/profile-account-panel.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, Error, fetch: fetcher, crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" }, AbortController, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id === "react") return {
      useState: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next: unknown) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef: (initial: unknown) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
      useEffect: effect, useLayoutEffect: effect,
    };
    if (id.endsWith("statistics-reset")) return statistics;
    if (id.endsWith("account-provider")) return { useBackyardAccount: () => account };
    if (id.endsWith("legal-config")) return { LEGAL_DOCUMENT_VERSIONS: {}, legalConfig: {} };
    if (id.endsWith("profile-geography")) return { normalizeProfileLocation: () => ({}), validateProfileLocation: () => ({ valid: true }) };
    if (id.endsWith("handicap-source")) return { selectedHandicapIndex: () => ({ source: null, value: undefined }) };
    if (id.endsWith("profile-data-dialogs")) return { StatisticsResetDialog: "StatisticsResetDialog", AccountDataDialog: "AccountDataDialog" };
    if (id.endsWith("profile-visibility")) return { readProfileVisibility: async () => "friends" };
    return new Proxy({}, { get: (_target, key) => key === "__esModule" ? true : () => undefined });
  } });
  const props = { view: "account", history: [], indexControl: { preference: null, ready: true }, highContrast: false,
    notificationsEnabled: true, onStatisticsReset: (value: statistics.StatisticsResetRecord) => applied.push(value) };
  function render() { cursor = 0; tree = (exports.ProfileAccountPanel as (props: unknown) => unknown)(props); const work = pending; pending = []; work.forEach((callback) => callback()); }
  function nodes(value = tree): Element[] { if (Array.isArray(value)) return value.flatMap((item) => nodes(item ?? null)); if (!value || typeof value !== "object" || !("props" in value)) return []; const item = value as Element; return [item, ...nodes(item.props.children ?? null)]; }
  function text(value: unknown = tree): string { if (Array.isArray(value)) return value.map((item) => text(item ?? null)).join(" "); if (!value || typeof value === "boolean") return ""; return typeof value === "object" ? text((value as Element).props?.children ?? null) : String(value); }
  const dialog = () => nodes().find((node) => node.type === "StatisticsResetDialog");
  const settle = async () => { for (let i = 0; i < 4; i++) { render(); await new Promise<void>((resolve) => setImmediate(resolve)); } };
  render();
  return { calls, applied, text, dialog, settle, switchAccount: () => { account.identity = { ...identity, userId: "different-user" }; },
    open: () => { const button = nodes().find((node) => node.type === "button" && text(node) === "Eliminar estadísticas")!; (button.props.onClick as () => void)(); render(); },
    confirm: (value: string) => { (dialog()!.props.onConfirmation as (value: string) => void)(value); render(); },
    submit: () => { (dialog()!.props.onConfirm as () => void)(); render(); },
    cancel: () => { (dialog()!.props.onClose as () => void)(); render(); },
    fail: () => { responseStatus = 503; }, recover: () => { responseStatus = 200; },
    hold: () => { hold = true; }, release: () => { hold = false; release?.(); },
  };
}

test("Profile reset: ELIMINAR posts once, closes modal and announces confirmed reset (including empty account)", async () => {
  const h = harness(); h.open(); h.confirm("ELIMINAR"); h.submit(); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].confirmation, "ELIMINAR");
  assert.equal(h.dialog(), undefined); assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].resetAt, "2026-09-16T12:00:00.000Z");
  assert.match(h.text(), /Tus estadísticas se reiniciaron/);
});

test("Profile reset: lowercase confirmation and cancel never submit", async () => {
  const h = harness(); h.open(); h.confirm("eliminar"); h.submit(); await h.settle();
  assert.equal(h.calls.length, 0); h.cancel(); assert.equal(h.dialog(), undefined); assert.equal(h.applied.length, 0);
});

test("Profile reset: busy/double submit is guarded, not just disabled markup", async () => {
  const h = harness(); h.open(); h.confirm("ELIMINAR"); h.hold(); h.submit(); h.submit();
  assert.equal(h.calls.length, 1); assert.equal(h.dialog()!.props.busy, true);
  h.release(); await h.settle(); assert.equal(h.applied.length, 1); assert.equal(h.dialog(), undefined);
});

test("Profile reset: failure retains modal and same idempotency key for retry", async () => {
  const h = harness(); h.open(); h.confirm("ELIMINAR"); h.fail(); h.submit(); await h.settle();
  assert.match(String(h.dialog()!.props.error), /No se confirmó/); assert.equal(h.applied.length, 0);
  h.recover(); h.submit(); await h.settle();
  assert.equal(h.calls[0].requestId, h.calls[1].requestId); assert.equal(h.applied.length, 1); assert.equal(h.dialog(), undefined);
});

test("Profile reset: late response cannot reset the newly selected account", async () => {
  const h = harness(); h.open(); h.confirm("ELIMINAR"); h.hold(); h.submit();
  h.switchAccount(); await h.settle(); h.release(); await h.settle();
  assert.equal(h.applied.length, 0); assert.doesNotMatch(h.text(), /Tus estadísticas se reiniciaron/);
});
