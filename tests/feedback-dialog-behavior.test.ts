import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

type Node = { type: unknown; props: Record<string, unknown> };

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object") return text((value as Node).props?.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

test("a contextual request event opens the dialog with its category and course name prefilled", () => {
  const slots: unknown[] = [];
  const pendingEffects: Array<() => void> = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let cursor = 0;
  let tree: Node | null = null;
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const browser = {
    location: { pathname: "/onboarding" },
    addEventListener(type: string, listener: (event: unknown) => void) {
      const current = listeners.get(type) || new Set<(event: unknown) => void>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event: { type: string }) { for (const listener of listeners.get(event.type) || []) listener(event); return true; },
  };
  class FakeCustomEvent<T> {
    type: string;
    detail: T;
    constructor(type: string, init: { detail: T }) { this.type = type; this.detail = init.detail; }
  }
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === "function" ? type(props) : { type, props };
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const index = cursor++;
      const prior = slots[index] as { dependencies: unknown[]; cleanup?: () => void } | undefined;
      const changed = !prior || dependencies.length !== prior.dependencies.length || dependencies.some((value, position) => !Object.is(value, prior.dependencies[position]));
      if (!changed) return;
      const next = { dependencies, cleanup: prior?.cleanup };
      slots[index] = next;
      pendingEffects.push(() => {
        next.cleanup?.();
        const cleanup = effect();
        next.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    },
  };
  const source = ts.transpileModule(readFileSync("app/components/feedback-dialog.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    exports,
    window: browser,
    document: { body: {} },
    CustomEvent: FakeCustomEvent,
    crypto: { randomUUID: () => "request-id" },
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "react-dom") return { createPortal: (content: Node) => content };
      if (name.endsWith("/feedback")) return {
        COURSE_SCORECARD_REQUIRED_MESSAGE: "Adjunta tarjeta",
        FEEDBACK_CATEGORIES: { COURSE: "COURSE", TEE: "TEE", CLUB: "CLUB", BALL: "BALL", SHAFT: "SHAFT", BET: "BET", BUG: "BUG", GENERAL: "GENERAL" },
        FEEDBACK_SHORT_LABELS: { COURSE: "Campo", TEE: "Tee", CLUB: "Bastón", BALL: "Bola", SHAFT: "Varilla", BET: "Apuesta", BUG: "Error", GENERAL: "General" },
        feedbackAttachmentRequired: (category: string) => category === "COURSE",
        validateFeedback: () => ({ ok: false, error: "not-used" }),
      };
      if (name.endsWith("/feedback-image.client")) return { prepareFeedbackImage: async () => null, feedbackImageErrorMessage: () => "No pudimos preparar la imagen." };
      if (name === "./modal-shell") return { ModalShell: (props: Record<string, unknown>) => ({ type: "modal-shell", props }) };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      throw new Error(name);
    },
  });

  function render() {
    cursor = 0;
    tree = exports.FeedbackDialog({ token: "token", email: "qa@example.com", screen: "onboarding" }) as Node | null;
    pendingEffects.splice(0).forEach((effect) => effect());
  }

  render();
  assert.equal(tree, null);
  (exports.requestFeedback as (category: string, prefill: { name: string }) => void)("COURSE", { name: "Campo QA" });
  render();

  assert.ok(nodes(tree).some((node) => node.type === "modal-shell"));
  const courseButton = nodes(tree).find((node) => node.type === "button" && text(node.props.children).includes("Campo"));
  assert.ok(courseButton);
  assert.equal(courseButton.props["aria-pressed"], true);
  const nameInput = nodes(tree).find((node) => node.type === "input" && node.props.value === "Campo QA");
  assert.ok(nameInput, "course request name is prefilled");
});
