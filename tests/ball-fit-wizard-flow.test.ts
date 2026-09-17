import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as fitting from "../lib/ball-fitting";
import * as handicap from "../lib/ball-fit-handicap";
import * as api from "../lib/ball-fitting-api";
import * as draft from "../lib/ball-fitting-storage";
import { golfBallCatalog } from "../lib/golf-equipment-catalog";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children)]; }
function text(value: unknown): string { if (Array.isArray(value)) return value.map(text).join(" "); if (value && typeof value === "object") return text((value as Node).props?.children); return typeof value === "string" || typeof value === "number" ? String(value) : ""; }

function wizard(profileIndex: number | null = null, profileSource: handicap.BallFitHandicapSource | null = null) {
  const slots: unknown[] = []; let cursor = 0; const effects: (() => void)[] = [];
  const storageValues = new Map<string, string>();
  const storage = { getItem: (key: string) => storageValues.get(key) ?? null, setItem: (key: string, value: string) => { storageValues.set(key, value); }, removeItem: (key: string) => { storageValues.delete(key); } };
  const sent: fitting.BallFitInput[] = [], saved: fitting.BallFitInput[] = [];
  const exports: Record<string, (props: unknown) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === "function" ? type(props) : { type, props };
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(fn: () => unknown) { return fn(); },
    useEffect(fn: () => void, dependencies: unknown[]) { const index = cursor++; const prior = slots[index] as unknown[] | undefined; if (!prior || dependencies.some((value, n) => !Object.is(value, prior[n]))) effects.push(fn); slots[index] = dependencies; },
  };
  const compiled = ts.transpileModule(readFileSync("app/components/ball-fit-wizard.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, { exports, AbortController, localStorage: storage, fetch: async (_url: string, init: { body: string }) => {
    const input = api.normalizeBallFitTransportInput(JSON.parse(init.body).input); assert.ok(input); sent.push(input);
    const result = fitting.runBackyardBallFit(golfBallCatalog, input);
    const catalog = golfBallCatalog.filter((ball) => result.recommendations.some((item) => item.catalogBallId === ball.id));
    return { ok: true, json: async () => ({ provider: "internal-fixture", scope: { complete: true, activeCandidateCount: 1, evaluatedCandidateCount: 1, maximumCandidates: 2000 }, result, catalog }) };
  }, require: (name: string) => {
    if (name === "react") return react;
    if (name === "./use-view-scroll-reset") return { useViewScrollReset() {} };
    if (name === "./numeric-capture-input") return { NumericCaptureInput: (props: Record<string, unknown>) => ({ type: "input", props }) };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name.endsWith("/ball-fitting")) return fitting;
    if (name.endsWith("/ball-fitting-api")) return api;
    if (name.endsWith("/ball-fitting-storage")) return draft;
    if (name.endsWith("/ball-fit-handicap")) return handicap;
    if (name.endsWith("/launch-monitor-capture")) return { LaunchMonitorCapture: "launch-capture" };
    if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
    throw new Error(name);
  } });
  const props = { userId: "flow-owner", defaultHandicap: profileIndex, defaultHandicapSource: profileSource,
    profileDefaults: { trajectoryPreference: "MID", priorities: ["WEDGE_SPIN"] }, currentBall: null, catalog: golfBallCatalog,
    onCancel() {}, onComplete(_result: fitting.BallFitResult, input: fitting.BallFitInput) { saved.push(input); } };
  let tree: Node;
  function render() { cursor = 0; tree = exports.BallFitWizard(props); effects.splice(0).forEach((effect) => effect()); return tree; }
  render(); render();
  return { sent, saved, render, text: () => text(tree), async click(label: string) {
    const button = nodes(tree).find((node) => node.type === "button" && text(node.props.children) === label); assert.ok(button, `button ${label}`);
    assert.notEqual(button.props.disabled, true); await (button.props.onClick as () => unknown)(); render();
  }, changeNumber(value: string) {
    const field = nodes(tree).find((node) => node.type === "input" && node.props.min === -20); assert.ok(field);
    (field.props.onValueChange as (value: number) => void)(Number(value)); render();
  } };
}

for (const mode of ["MANUAL", "UNKNOWN", "BACKYARD"] as const) test(`wizard actual handlers complete ${mode} fitting without overwriting profile or inventing zero`, async () => {
  const h = wizard(mode === "BACKYARD" ? 7.2 : null, mode === "BACKYARD" ? "BACKYARD" : null);
  if (mode === "MANUAL") {
    await h.click("Capturar HCP manual"); await h.click("Siguiente →");
    assert.match(h.text(), /Captura tu HCP entre/); h.changeNumber("21.3");
  }
  if (mode === "UNKNOWN") { await h.click("No conozco mi hándicap / Estoy empezando"); await h.click("Estoy empezando"); }
  for (let index = 0; index < 5; index++) await h.click("Siguiente →");
  await h.click("Ver mi Top 3");
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].handicapSource, mode);
  assert.equal(h.sent[0].handicap, mode === "MANUAL" ? 21.3 : mode === "BACKYARD" ? 7.2 : null);
  await h.click("Guardar resultado");
  assert.equal(h.saved[0].handicapSource, mode); assert.equal(h.saved[0].userId, "flow-owner");
});
