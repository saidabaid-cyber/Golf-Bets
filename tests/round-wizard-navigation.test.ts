import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as wizardLogic from "../lib/round-setup-wizard";
import type { RoundSetupPreflightIssue } from "../lib/round-setup-preflight";

type Tree = { type: unknown; props: Record<string, unknown> };
type Context = { current: unknown; context: true };
type Component = (props: Record<string, unknown>) => Tree;

/** Execute the actual component event handlers with persistent hook slots.
 * This is deliberately not a DOM/visual substitute; deployed-browser QA covers
 * layout and focus. It makes state, guards and callback wiring testable without
 * adding a second React renderer or any production dependency. */
function harness(savedStep = "1") {
  const storage = new Map([["wizard-test", savedStep]]);
  const slots = new Map<string, unknown[]>();
  const cache = new Map<string, Record<string, Component | Context>>();
  let current: unknown[] = []; let cursor = 0;
  const react = {
    createContext: (initial: unknown): Context => ({ current: initial, context: true }),
    useContext: (context: Context) => context.current,
    useState: (initial: unknown) => {
      const index = cursor++;
      const owner = current;
      if (!(index in owner)) owner[index] = typeof initial === "function" ? initial() : initial;
      return [owner[index], (next: unknown) => { owner[index] = typeof next === "function" ? next(owner[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!(index in current)) current[index] = { current: initial };
      return current[index];
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>): Tree => ({ type, props });
  const scrollTargets: string[] = [];
  function load(name: string): Record<string, Component | Context> {
    const cached = cache.get(name); if (cached) return cached;
    const exports: Record<string, Component | Context> = {};
    cache.set(name, exports);
    const source = ts.transpileModule(readFileSync(`app/components/${name}.tsx`, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(source, {
      exports,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      document: { getElementById: (id: string) => ({
        scrollIntoView: () => scrollTargets.push(id), querySelector: () => ({ focus: () => {} }),
      }) },
      require: (dependency: string) => {
        if (dependency === "react") return react;
        if (dependency === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
        if (dependency.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
        if (dependency.endsWith("/round-setup-wizard")) return wizardLogic;
        if (dependency === "./round-wizard-context") return load("round-wizard-context");
        if (dependency === "./use-view-scroll-reset") return { useViewScrollReset() {} };
        throw new Error(`Unexpected component dependency ${dependency}`);
      },
    });
    return exports;
  }
  function render(module: string, component: string, props: Record<string, unknown>, instance = component) {
    current = slots.get(instance) ?? []; slots.set(instance, current); cursor = 0;
    const result = (load(module)[component] as Component)(props);
    const context = result.type as Context;
    if (context?.context) context.current = result.props.value;
    return result;
  }
  const props = {
    storageKey: "wizard-test", issues: [] as RoundSetupPreflightIssue[],
    onStart: async () => true, onSave: (): boolean => true, onExit: () => {}, children: "mounted editors",
  };
  return { props, storage, scrollTargets, render, wizard: () => render("round-setup-wizard", "RoundSetupWizard", props) };
}

function nodes(tree: unknown): Tree[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const node = tree as Tree;
  return [node, ...nodes(node.props.children)];
}
function content(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (tree && typeof tree === "object" && "props" in tree) return content((tree as Tree).props.children);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
function button(tree: Tree, prefix: string) {
  const node = nodes(tree).find((node) => node.type === "button" && content(node).startsWith(prefix));
  assert.ok(node, `Button ${prefix} exists`);
  return node;
}
function click(node: Tree) {
  assert.notEqual(node.props.disabled, true, `Button ${content(node)} is enabled`);
  (node.props.onClick as () => void)();
}
function step(tree: Tree): number { return (tree.props.value as { step: number }).step; }
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const issue = (targetId: string): RoundSetupPreflightIssue => ({ id: targetId, targetId, kind: "bets", label: "Precio", detail: "Corrige el precio" });

test("wizard component navigates all steps, back and review edit without reconstructing draft children", () => {
  const h = harness(); const draft = { players: ["a", "b"], amount: 500 };
  h.props.children = draft as unknown as string;
  for (let current = 1; current < 5; current += 1) {
    const tree = h.wizard(); assert.equal(step(tree), current);
    click(button(tree, current === 4 ? "Revisar y jugar" : "Continuar"));
  }
  assert.equal(step(h.wizard()), 5); assert.equal(h.storage.get("wizard-test"), "5");
  const review = h.render("round-setup-wizard", "WizardReviewBlock", { step: 2, title: "Jugadores", children: draft });
  click(button(review, "Editar jugadores"));
  assert.equal(step(h.wizard()), 2);
  click(button(h.wizard(), "← Atrás")); assert.equal(step(h.wizard()), 1);
  click(button(h.wizard(), "Volver al resumen")); assert.equal(step(h.wizard()), 5);
  assert.strictEqual(h.props.children, draft);
  assert.deepEqual(draft, { players: ["a", "b"], amount: 500 });
});

test("wizard blocks advancing across invalid configuration and opens its existing editor", () => {
  const h = harness("3"); h.props.issues = [issue("result-section-setup-skins")];
  assert.equal(button(h.wizard(), "Continuar").props.disabled, true);
  const forward = nodes(h.wizard()).find((node) => node.props["aria-label"] === "4 Personales · pendiente");
  assert.ok(forward); click(forward);
  const tree = h.wizard(); assert.equal(step(tree), 3);
  assert.equal((tree.props.value as { target: { id: string } }).target.id, "setup-skins");
  assert.equal(h.scrollTargets.at(-1), "result-section-setup-skins");
});

test("failed draft flush cannot advance, exit, or start; next successful flush permits retry", async () => {
  const h = harness("5"); let starts = 0; let exits = 0;
  h.props.onSave = () => false; h.props.onExit = () => { exits++; };
  h.props.onStart = async () => { starts++; return true; };
  click(button(h.wizard(), "← Atrás")); assert.equal(step(h.wizard()), 5);
  click(button(h.wizard(), "Guardar y salir")); assert.equal(exits, 0);
  click(button(h.wizard(), "Iniciar ronda")); await flush(); assert.equal(starts, 0);
  assert.match(content(h.wizard()), /No pudimos guardar el borrador/);
  h.props.onSave = () => true;
  click(button(h.wizard(), "Iniciar ronda")); await flush(); assert.equal(starts, 1);
});

test("double tap calls existing round creator only once and keeps guard closed through successful navigation", async () => {
  const h = harness("5"); let starts = 0; let finish: ((result: boolean) => void) | undefined;
  h.props.onStart = () => { starts++; return new Promise<boolean>((resolve) => { finish = resolve; }); };
  const startButton = button(h.wizard(), "Iniciar ronda");
  const handler = startButton.props.onClick as () => void;
  handler(); handler();
  assert.equal(starts, 1);
  assert.equal(button(h.wizard(), "Iniciando").props.disabled, true);
  assert.ok(finish); finish(true); await flush();
  handler(); assert.equal(starts, 1); assert.equal(h.storage.has("wizard-test"), false);
});

test("creator false (cancelled authorization) releases start guard without losing review/draft", async () => {
  const h = harness("5"); let starts = 0;
  h.props.onStart = async () => ++starts > 1;
  click(button(h.wizard(), "Iniciar ronda")); await flush();
  assert.equal(step(h.wizard()), 5); assert.equal(h.storage.get("wizard-test"), "5");
  click(button(h.wizard(), "Iniciar ronda")); await flush(); assert.equal(starts, 2);
});

test("creator exception shows recoverable error and permits a single retry", async () => {
  const h = harness("5"); let starts = 0;
  h.props.onStart = async () => { if (++starts === 1) throw new Error("temporary failure"); return true; };
  click(button(h.wizard(), "Iniciar ronda")); await flush();
  assert.match(content(h.wizard()), /Tu configuración se conserva/);
  assert.equal(h.storage.get("wizard-test"), "5");
  click(button(h.wizard(), "Iniciar ronda")); await flush(); assert.equal(starts, 2);
});

test("saved wizard step reloads and inactive panels keep their same editor children mounted", () => {
  const h = harness("4"); assert.equal(step(h.wizard()), 4);
  const child = { stableEditor: "saved draft" };
  const renderPanel = () => h.render("round-setup-wizard", "RoundSetupStep", { step: 3, children: child });
  assert.equal(renderPanel().props.hidden, true); assert.strictEqual(renderPanel().props.children, child);
  click(button(h.wizard(), "← Atrás")); h.wizard();
  assert.equal(renderPanel().props.hidden, false); assert.strictEqual(renderPanel().props.children, child);
  assert.equal(step(harness(h.storage.get("wizard-test")).wizard()), 3);
});

test("repeating the same preflight action reopens the invalid editor after choosing another bet", () => {
  const h = harness("3"); h.props.issues = [issue("result-section-setup-skins")];
  const entries = ["skins", "rabbits"].map((id) => ({ id: `setup-${id}`, label: id, enabled: true, summary: "" }));
  const catalog = () => h.render("round-setup-wizard", "WizardBetCatalog", { entries, children: "editors" });
  const selected = () => (catalog().props.value as { selected: string }).selected;
  click(button(h.wizard(), "Precio")); h.wizard(); assert.equal(selected(), "setup-skins");
  click(button(catalog(), "← Elegir otra"));
  click(button(catalog(), "rabbits")); assert.equal(selected(), "setup-rabbits");
  click(button(h.wizard(), "Precio")); h.wizard(); assert.equal(selected(), "setup-skins");
});

test("wizard accordion honors locked/disabled editors and outside-wizard controlled behavior", () => {
  const h = harness("3"); h.wizard();
  const entries = [{ id: "setup-skins", label: "Skins", enabled: true, summary: "" }];
  const catalog = () => h.render("round-setup-wizard", "WizardBetCatalog", { entries });
  click(button(catalog(), "Skins")); catalog();
  const locked = h.render("result-accordion", "ResultAccordion", { id: "setup-skins", title: "Skins", disclosureDisabled: true, children: "private editor" });
  assert.equal(locked.props.hidden, false);
  assert.equal(button(locked, "Skins").props["aria-expanded"], false);
  const open = h.render("result-accordion", "ResultAccordion", { id: "setup-skins", title: "Skins", disclosureDisabled: false, children: "editor" });
  assert.equal(button(open, "Skins").props["aria-expanded"], true);
  const results = h.render("result-accordion", "ResultAccordion", { id: "results-skinned", title: "Results", open: false }, "outside-accordion");
  assert.equal(results.props.hidden, undefined); assert.equal(button(results, "Results").props["aria-expanded"], false);
  const expanded = h.render("result-accordion", "ResultAccordion", { id: "results-skinned", title: "Results", open: true }, "outside-accordion");
  assert.equal(button(expanded, "Results").props["aria-expanded"], true);
});
