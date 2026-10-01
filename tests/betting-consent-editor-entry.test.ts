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

function catalog(requestAccess: () => Promise<boolean>) {
  const slots: unknown[] = [];
  let cursor = 0;
  const react = {
    createContext: () => "context",
    useContext: () => ({ target: null }),
    useRef: (initial: unknown) => { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useState: (initial: unknown) => {
      const i = cursor++; slots[i] ??= initial;
      return [slots[i], (value: unknown) => { slots[i] = value; }];
    },
  };
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const code = ts.transpileModule(readFileSync("app/components/round-setup-wizard.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { exports, require: (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id.endsWith("/round-wizard-context")) return { WizardBetEditorContext: "editor-context" };
    if (id.endsWith(".css")) return { default: {} };
    return {};
  } });
  const render = () => {
    cursor = 0;
    return exports.WizardBetCatalog({ entries: [{ id: "rabbits", label: "Conejos", enabled: false }], requestAccess, children: "unchanged editor" });
  };
  const click = () => (nodes(render()).find((n) => n.props["aria-label"] === "Configurar Conejos")!.props.onClick as () => void)();
  const selected = () => (render().props.value as { selected: string | null }).selected;
  return { render, click, selected };
}

test("attempting a financial editor asks consent; rejection leaves the editor and bets untouched", async () => {
  let prompts = 0;
  const h = catalog(async () => { prompts++; return false; });
  h.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prompts, 1);
  assert.equal(h.selected(), null);
  assert.ok(nodes(h.render()).some((n) => n.props["aria-label"] === "Configurar Conejos"));
});

test("consent acceptance opens exactly the requested editor after the confirmed decision", async () => {
  let decide!: (accepted: boolean) => void;
  let prompts = 0;
  const h = catalog(() => { prompts++; return new Promise<boolean>((resolve) => { decide = resolve; }); });
  h.click(); h.click();
  assert.equal(prompts, 1);
  assert.equal(h.selected(), null);
  decide(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.selected(), "rabbits");
});

test("consent failure cannot open an editor and permits a later retry", async () => {
  let prompts = 0;
  const h = catalog(async () => { if (++prompts === 1) throw Error("ledger unavailable"); return true; });
  h.click(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.selected(), null);
  h.click(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.selected(), "rabbits");
});

test("group and personal editor entries share the existing financial evidence gate", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  for (const group of ["group", "personal"]) {
    assert.ok(page.includes(`<WizardBetCatalog entries={wizardBets.${group}} requestAccess={requestBettingConsent}>`));
  }
});
