import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Node = { type: unknown; props: Record<string, unknown> };

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

function component() {
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const source = ts.transpileModule(readFileSync("app/components/bottom-back-action.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.endsWith(".css")) return { default: { container: "bottom-container", button: "bottom-button" } };
      throw new Error(`unexpected_require:${name}`);
    },
  });
  return exports.BottomBackAction;
}

test("BottomBackAction is one full-width secondary button wired to the supplied exit", () => {
  const BottomBackAction = component();
  let calls = 0;
  const onBack = () => { calls += 1; };
  const tree = BottomBackAction({ label: "← Volver", onBack });

  assert.equal(tree.props["data-bottom-back-action"], true);
  const buttons = nodes(tree).filter((node) => node.type === "button");
  assert.equal(buttons.length, 1);
  const button = buttons[0];
  assert.equal(button.props.type, "button");
  assert.equal(button.props.children, "← Volver");
  assert.match(String(button.props.className), /secondary/);
  assert.equal(button.props.disabled, false);
  assert.equal(button.props.onClick, onBack);

  (button.props.onClick as () => void)();
  assert.equal(calls, 1);
});

test("BottomBackAction forwards the disabled guard and keeps a safe mobile target", () => {
  const BottomBackAction = component();
  const tree = BottomBackAction({ label: "Volver", onBack() {}, disabled: true });
  const button = nodes(tree).find((node) => node.type === "button");
  assert.ok(button);
  assert.equal(button.props.disabled, true);

  const css = readFileSync("app/components/bottom-back-action.module.css", "utf8");
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height:\s*48px/);
  assert.match(css, /width:\s*100%/);
});
