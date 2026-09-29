import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { createBetaOnboardingProgress, persistBetaOnboardingProgress, readBetaOnboardingProgress } from "../lib/beta-onboarding";

type Node = { type: unknown; props: Record<string, unknown>; key?: unknown };
type EntryMode = "quick" | "complete";

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

function welcomeHarness() {
  const exports: Record<string, (...args: never[]) => unknown> = {};
  const jsx = (type: unknown, props: Record<string, unknown>, key?: unknown) => {
    const rendered = typeof type === "function" ? (type as (value: Record<string, unknown>) => Node)(props) : { type, props };
    if (rendered && typeof rendered === "object" && key !== undefined) rendered.key = key;
    return rendered;
  };
  const component = ts.transpileModule(readFileSync("app/components/beta-onboarding-flow.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(component, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "./account-consent-checkpoint") return {
        InitialOnboardingConsents: (props: Record<string, unknown>) => ({ type: "initial-consents", props }),
      };
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
      return new Proxy({}, { get: () => () => undefined });
    },
  });
  const Welcome = exports.OnboardingWelcomeStep as unknown as (props: Record<string, unknown>) => Node;
  const withMode = exports.withBetaOnboardingMode as unknown as (progress: ReturnType<typeof createBetaOnboardingProgress>, mode: EntryMode, now: string) => ReturnType<typeof createBetaOnboardingProgress>;
  const consentRef = { current: null };
  const onAcceptRequiredConsents = async () => undefined;

  function render(entryMode: EntryMode | null, onSelectEntryMode: (mode: EntryMode) => void = () => {}, onContinue = () => {}) {
    return Welcome({
      profileUserId: "owner",
      accessToken: "token",
      legalConsentRequired: false,
      entryMode,
      consentSectionRef: consentRef,
      onSelectEntryMode,
      onAcceptRequiredConsents,
      onContinue,
    });
  }

  return { render, withMode };
}

test("welcome renders only the mode decision before Rápida or Completa is selected", () => {
  const view = welcomeHarness().render(null);
  assert.ok(nodes(view).some((node) => node.type === "button" && /Rápida/.test(text(node.props.children))));
  assert.ok(nodes(view).some((node) => node.type === "button" && /Completa/.test(text(node.props.children))));
  assert.ok(!nodes(view).some((node) => node.type === "initial-consents"));
  assert.doesNotMatch(text(view), /Consentimientos de cuenta|CONTINUAR/);
});

test("Rápida and Completa each reveal consents and expose the active selection", () => {
  const harness = welcomeHarness();
  for (const [mode, label] of [["quick", "Rápida"], ["complete", "Completa"]] as const) {
    const view = harness.render(mode);
    const selected = nodes(view).find((node) => node.type === "button" && new RegExp(label).test(text(node.props.children)));
    assert.equal(selected?.props["aria-pressed"], true);
    const consent = nodes(view).find((node) => node.type === "initial-consents");
    assert.ok(consent);
    assert.equal(consent.props.canContinue, true);
  }
});

test("changing Rápida to Completa persists the last mode without remounting consent state", () => {
  const harness = welcomeHarness();
  const quick = harness.render("quick", () => {}, () => {});
  const complete = harness.render("complete", () => {}, () => {});
  const quickConsent = nodes(quick).find((node) => node.type === "initial-consents");
  const completeConsent = nodes(complete).find((node) => node.type === "initial-consents");
  assert.equal(quickConsent?.key, "owner");
  assert.equal(completeConsent?.key, "owner");
  assert.equal(quickConsent?.props.userId, completeConsent?.props.userId);
  assert.equal(quickConsent?.props.onAcceptRequired, completeConsent?.props.onAcceptRequired);

  const initial = createBetaOnboardingProgress("owner", "2026-09-29T10:00:00.000Z");
  const quickProgress = harness.withMode(initial, "quick", "2026-09-29T10:01:00.000Z");
  const completeProgress = harness.withMode(quickProgress, "complete", "2026-09-29T10:02:00.000Z");
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  persistBetaOnboardingProgress(storage, completeProgress);
  assert.equal(readBetaOnboardingProgress(storage, "owner")?.mode, "complete");
});

test("continue is unreachable without a mode and is forwarded after the consent checkpoint resolves", () => {
  const harness = welcomeHarness();
  let continued = 0;
  assert.ok(!nodes(harness.render(null, () => {}, () => { continued += 1; })).some((node) => node.type === "initial-consents"));
  assert.equal(continued, 0);

  const selected = harness.render("quick", () => {}, () => { continued += 1; });
  const consent = nodes(selected).find((node) => node.type === "initial-consents");
  assert.ok(consent);
  (consent.props.onContinue as () => void)();
  assert.equal(continued, 1);
});

test("the implementation mounts consents conditionally and scrolls smoothly after mode selection", () => {
  const source = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  assert.match(source, /\{entryMode && <div ref=\{consentSectionRef\} data-onboarding-consents-revealed="true">/);
  assert.match(source, /persistBetaOnboardingProgress\(localStorage, next\)/);
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "nearest" \}\)/);
  assert.doesNotMatch(source, /display:\s*none[^\n]*InitialOnboardingConsents/);
});
