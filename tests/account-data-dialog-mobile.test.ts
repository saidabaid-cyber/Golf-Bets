import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ts from "typescript";

type Element = { type: unknown; props: { children?: unknown; [key: string]: unknown } };
type Props = { confirmation: string; policy: string | null; busy: boolean; syncBusy: boolean; error: string; onPolicy: (value: string) => void; onConfirmation: (value: string) => void; onClose: () => void; onConfirm: () => void };
const source = readFileSync("app/components/profile-data-dialogs.tsx", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return typeof value === "string" ? value : "";
}
function fixture(overrides: Partial<Props> = {}) {
  let confirming = false;
  let confirms = 0;
  let closes = 0;
  const props: Props = { confirmation: "", policy: null, busy: false, syncBusy: false, error: "", onPolicy: value => { props.policy = value; props.confirmation = ""; }, onConfirmation: value => { props.confirmation = value; }, onClose: () => { closes++; }, onConfirm: () => { confirms++; }, ...overrides };
  const compiledModule = { exports: {} as { AccountDataDialog: (value: Props) => Element; StatisticsResetDialog: (value: Props) => Element } };
  // Run the actual component and event handlers. Hooks/portal are isolated;
  // network and lifecycle behavior are covered by the existing deletion suites.
  const load = (name: string): unknown => {
    if (name === "react") return { useState: () => [confirming, (value: boolean) => { confirming = value; }], useRef: () => ({ current: null }), useEffect: () => {} };
    if (name === "react-dom") return { createPortal: (value: unknown) => value };
    if (name === "./modal-shell") return { ModalCloseButton: () => null };
    if (name.endsWith(".css")) return { default: {} };
    if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Element["props"]) => ({ type, props }), jsxs: (type: unknown, props: Element["props"]) => ({ type, props }) };
    throw new Error(`Unexpected module ${name}`);
  };
  new Function("require", "module", "exports", compiled)(load, compiledModule, compiledModule.exports);
  const render = () => compiledModule.exports.AccountDataDialog(props);
  const button = (label: string) => nodes(render()).find(node => node.type === "button" && text(node) === label);
  return { props, render, button, stats: () => compiledModule.exports.StatisticsResetDialog(props), confirms: () => confirms, closes: () => closes };
}

test("account choice hides internal legal state and never offers unapproved recovery", () => {
  const f = fixture();
  assert.match(text(f.render()), /¿Qué quieres hacer\?/);
  assert.doesNotMatch(text(f.render()), /LEGAL_REVIEW_REQUIRED|Escribe ELIMINAR/);
  assert.equal(f.button("Eliminar cuenta"), undefined);
  assert.equal(f.button("Desactivar mi cuenta y conservar mi historial"), undefined);
  assert.ok(nodes(f.render()).some(node => node.props["aria-disabled"] === "true" && text(node).includes("Esta opción todavía no está disponible")));
  assert.equal(nodes(f.render()).filter(node => node.type === "input").length, 0);
});

test("choice arms the existing deletion contract but only second confirmation executes", () => {
  const f = fixture();
  const choose = nodes(f.render()).find(node => node.type === "button" && text(node).startsWith("Eliminar mi cuenta y mis datos"))!;
  (choose.props.onClick as () => void)();
  assert.equal(f.props.policy, "delete_golf_data");
  assert.equal(f.props.confirmation, "ELIMINAR");
  assert.equal(f.confirms(), 0);
  assert.match(text(f.render()), /¿Seguro que quieres eliminar tu cuenta\?/);
  assert.match(text(f.render()), /Esta acción no se puede deshacer/);
  assert.equal(f.button("Eliminar cuenta")?.props.disabled, false);
  (f.button("Eliminar cuenta")!.props.onClick as () => void)();
  assert.equal(f.confirms(), 1);
});

test("cancel closes without deletion in either step", () => {
  for (const confirming of [false, true]) {
    const f = fixture();
    if (confirming) (nodes(f.render()).find(node => node.type === "button" && text(node).startsWith("Eliminar mi cuenta"))!.props.onClick as () => void)();
    (f.button("Cancelar")!.props.onClick as () => void)();
    assert.equal(f.closes(), 1);
    assert.equal(f.confirms(), 0);
  }
});

test("sync and in-flight deletion prevent advancing and disable final actions", () => {
  for (const overrides of [{ busy: true }, { syncBusy: true }]) {
    const f = fixture(overrides);
    (nodes(f.render()).find(node => node.type === "button" && text(node).startsWith("Eliminar mi cuenta"))!.props.onClick as () => void)();
    assert.equal(f.props.confirmation, "");
    assert.equal(f.confirms(), 0);
  }
  const f = fixture();
  (nodes(f.render()).find(node => node.type === "button" && text(node).startsWith("Eliminar mi cuenta"))!.props.onClick as () => void)();
  f.props.busy = true;
  assert.equal(f.button("Eliminando…")!.props.disabled, true);
  assert.equal(f.button("Cancelar")!.props.disabled, true);
  assert.ok(nodes(f.render()).some(node => node.props.role === "status"));
  f.props.busy = false;
  f.props.policy = "retain_history";
  assert.equal(f.button("Eliminar cuenta")!.props.disabled, true);
});

test("statistics reset keeps its typed confirmation and preserved-rounds contract", () => {
  const f = fixture();
  assert.match(text(f.stats()), /Tu histórico se conserva/);
  const action = () => nodes(f.stats()).find(node => node.type === "button" && text(node) === "Eliminar estadísticas")!;
  assert.equal(action().props.disabled, true);
  f.props.confirmation = "ELIMINAR";
  assert.equal(action().props.disabled, false);
});
