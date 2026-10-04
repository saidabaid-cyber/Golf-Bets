import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as catalog from "../lib/rules-catalog";
import * as navigation from "../lib/rules-navigation";
import * as documents from "../lib/rules-documents";
import * as local from "../lib/local-rules";
import * as speech from "../lib/speech-dictation";
import { searchRulesCorpus } from "../lib/rules-search";

type Node = { type: unknown; props: Record<string, unknown> };
const jsx = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value == null || typeof value === "boolean") return "";
  if (typeof value !== "object") return String(value);
  const node = value as Node;
  return typeof node.type === "function" ? text(node.type(node.props)) : text(node.props?.children);
}
function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (props: Record<string, unknown>) => unknown> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, AbortController, DOMException, console, fetch: dependencies.fetch, window: dependencies.window, document: { getElementById: () => ({ focus() {}, scrollIntoView() {} }) }, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  } });
  return exports;
}

function harness({ courseName = "La Vista", deferredSearch = false } = {}) {
  let cursor = 0;
  let tree: unknown;
  const values: unknown[] = [], deps: unknown[][] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const timers = new Map<number, () => Promise<void>>();
  const listeners = new Set<() => void>();
  const history: unknown[] = [{}];
  const searchRequests: { query: string; signal?: AbortSignal }[] = [];
  const aiRequests: { endpoint: string; body: Record<string, unknown> }[] = [];
  let timerId = 0;
  const react = {
    useState: (initial: unknown) => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect: (effect: () => (() => void) | void, nextDeps: unknown[]) => { const index = cursor++; if (!deps[index] || nextDeps.some((value, n) => !Object.is(value, deps[index][n]))) { deps[index] = nextDeps; effects.push(() => { cleanups[index]?.(); const cleanup = effect(); if (cleanup) cleanups[index] = cleanup; }); } },
    useMemo: (calculate: () => unknown) => calculate(),
    useCallback: (callback: unknown) => callback,
  };
  const browser = {
    scrollTo() {}, isSecureContext: true,
    requestAnimationFrame: (callback: () => void) => callback(),
    setTimeout: (callback: () => Promise<void>) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    history: { get state() { return history.at(-1); }, pushState: (next: unknown) => history.push(next), back: () => { if (history.length > 1) history.pop(); listeners.forEach(listener => listener()); } },
  };
  const secondary = load("app/components/use-secondary-view.ts", { react, window: browser, "./use-view-scroll-reset": { useViewScrollReset() {} } });
  const fetcher = async (url: string, options?: RequestInit) => {
    if (url === "/api/rules/ask") return Response.json({ state: "ready" });
    const query = new URL(url, "https://dev.thebackyard.com.mx").searchParams.get("q") || "";
    const signal = options?.signal as AbortSignal | undefined;
    searchRequests.push({ query, signal });
    if (deferredSearch) await new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    return Response.json({ results: searchRulesCorpus(query) });
  };
  const panel = load("app/components/rules-panel.tsx", {
    react, fetch: fetcher, window: browser,
    "../../lib/rules-catalog": catalog, "../../lib/rules-navigation": navigation, "../../lib/rules-documents": documents,
    "../../lib/local-rules": local, "../../lib/speech-dictation": speech,
    "../../lib/gentlemen-code": { GENTLEMEN_CODE: [], GENTLEMEN_CODE_DISCLAIMER: "No oficial", GENTLEMEN_CODE_FINAL_QUOTE: "" },
    "../../lib/backyard-ai/client-api": { requestBackyardAi: async (endpoint: string, body: Record<string, unknown>) => { aiRequests.push({ endpoint, body }); return { answer: "Respuesta de prueba", evidence: [] }; } },
    "../../lib/backyard-ai/consent-client": { resolveAuthoritativeAiProcessingConsent: async () => ({ active: true }) },
    "../../lib/backyard-ai/processing-consent": { browserAiProcessingConsentStorage: () => null, hasActiveAiProcessingConsent: () => true },
    "../../lib/backyard-ai/privacy": { AI_PROVIDER_PROCESSING_CONSENT: "ai-provider", backyardAiProviderConsent: (scope: string) => ({ scope }) },
    "./account-provider": { useBackyardAccount: () => ({ identity: { accessToken: "qa-token", userId: "qa", mode: "authenticated" } }) },
    "./backyard-ai/ai-processing-consent": { AiProcessingConsentPrompt: () => null, AiProcessingConsentRequired: () => null },
    "./internal-pdf-viewer": { InternalPdfViewer: (props: Record<string, unknown>) => jsx("pdf-viewer", props) },
    "./use-secondary-view": secondary,
    "./backyard-icon": { BackyardIcon: () => jsx("svg", {}) },
    "./bottom-back-action": { BottomBackAction: ({ label, onBack }: Record<string, unknown>) => jsx("button", { onClick: onBack, children: label }) },
  });
  const render = () => { cursor = 0; tree = panel.RulesPanel({ courseName, onBack() {} }); effects.splice(0).forEach(effect => effect()); };
  const button = (label: string) => { const match = nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node).replace(/[▲▼]/g, "").replace(/\s+/g, " ").trim() === label)); assert.ok(match, `Missing button: ${label}`); return match; };
  const click = (label: string) => { (button(label).props.onClick as () => void)(); render(); };
  const change = (id: string, value: string) => { const input = nodes(tree).find(node => node.props.id === id)!; (input.props.onChange as (event: unknown) => void)({ target: { value } }); render(); };
  render();
  return { render, click, change, button, tree: () => tree, nodes: () => nodes(tree), text: () => text(tree).replace(/\s+/g, " ").trim(), history, searchRequests, aiRequests,
    state: () => ({ query: values[0], results: Array.from(values[1] as unknown[]), searching: values[2] }),
    runTimers: async () => { const pending = [...timers.values()]; timers.clear(); await Promise.all(pending.map(callback => callback())); render(); },
    settle: async () => { for (let i = 0; i < 3; i++) { await new Promise<void>(resolve => setImmediate(resolve)); render(); } },
  };
}

test("empty search renders the reference Home with five topics, seven situations and no search microphone", () => {
  const h = harness();
  assert.match(h.text(), /Temas principales/); assert.match(h.text(), /Situaciones comunes/);
  for (const label of ["Bolas", "Alivio", "Búnker", "Fuera de límites", "Penalidades"]) h.button(label);
  assert.equal(h.nodes().filter(node => node.props.className === "situationCard").length, 7);
  assert.ok(h.nodes().every(node => node.props["aria-label"] !== "Limpiar búsqueda" && !/mic|dictation/i.test(String(node.props.className))));
  assert.match(h.text(), /Más recursos/); assert.doesNotMatch(h.text(), /Reglamento navegable/);
});

test("bunker topic opens an internal situation, videos precede the related rule, and both Back paths restore Home", () => {
  const h = harness(); h.click("Búnker");
  assert.match(h.text(), /La bola en un búnker/);
  assert.ok(h.text().indexOf("Videos") < h.text().indexOf("Regla relacionada"));
  assert.match(h.text(), /Regla 12.2/);
  h.click("Abrir referencia ↗"); assert.ok(h.nodes().some(node => node.props.id === "rule-detail-title"));
  h.click("← Búnker"); assert.match(h.text(), /Situación común/);
  h.click("← Búnker"); assert.match(h.text(), /Temas principales/); assert.equal(h.history.length, 1);
});

test("every situation uses existing subrules and verified official-playlist videos", () => {
  const expected = [["bunker", ["12.2"]], ["out_of_bounds", ["18.2"]], ["lost_ball", ["18.2"]], ["free_relief", ["16.1"]], ["penalty_area", ["17.1"]], ["obstructions", ["15.2", "16.1"]], ["drop", ["14.3"]]];
  assert.deepEqual(catalog.RULES_COMMON_SITUATIONS.map(entry => [entry.id, entry.references]), expected);
  for (const situation of catalog.RULES_COMMON_SITUATIONS) {
    for (const reference of situation.references) assert.ok(navigation.findNavigableRule(reference)?.section, reference);
    const h = harness(); const card = h.nodes().find(node => node.props.className === "situationCard" && text(node).includes(situation.title))!;
    (card.props.onClick as () => void)(); h.render();
    const videos = h.nodes().filter(node => node.type === "a");
    assert.deepEqual(videos.map(node => node.props.href), catalog.RULE_SITUATION_VIDEOS[situation.id].map(video => `https://www.youtube.com/shorts/${video.id}`));
    assert.ok(h.text().indexOf("Videos") < h.text().indexOf("Regla relacionada"));
  }
});

test("video metadata matches the IDs and titles captured from the official playlist, with no invented durations", () => {
  const verified = new Map([
    ["fc0yMbViP4Q", "Water in the bunker? Here's how to handle | USGA Rules of Golf"],
    ["AnnGid9b-Ms", "Unplayable ball in a bunker? Here's all 4️⃣ options to know! #golf"],
    ["8hqhJDFwVNg", "Putt into a bunker? Remember: stroke-and-distance relief is always an option — even from the green."],
    ["JdeUClv-nMY", "Blast one OB? Use stroke and distance to your advantage! | USGA Rules of Golf"],
    ["5iUHimssIcM", "Can you use a leaf blower to help find your ball? | USGA Rules of Golf"],
    ["V-fwJ24Bv_4", "If your ball gets moved while searching for it, what's the ruling? Here's what you need to know 🔍"],
    ["PHazBcxF1BE", "Ground Under Repair in Golf. It doesn’t have to be marked! | USGA Rules of Golf"],
    ["LKpWHNQ8kh4", "Can you get free relief if your stance is impacted by ground under repair? 🤔 #golf"],
    ["kybhVYoXVNU", "So you've hit it into a penalty area... What next? Here's your options for relief #golf"],
    ["Br6WklZdIuo", "Know the difference between red and yellow penalty areas 🔴🟡"],
    ["1E72iqJqu6Y", "Movable Obstruction vs. Immovable Obstruction | USGA Rules of Golf"],
    ["7neAG_Xni8I", "What's the difference between loose impediments and movable obstrucitons?"],
    ["CHJ3ZOs-DxA", "Here’s the right way to drop a ball in golf | USGA Rules of Golf"],
  ]);
  const videos = Object.values(catalog.RULE_SITUATION_VIDEOS).flat();
  assert.equal(videos.length, verified.size);
  for (const video of videos) { assert.equal(video.title, verified.get(video.id)); assert.ok(!("duration" in video)); }
  assert.match(catalog.OFFICIAL_RULES_VIDEOS_URL, /PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA/);
});

test("Ver todos shows only actual catalog categories and a selected topic uses the current search", async () => {
  const h = harness(); h.click("Ver todos ›");
  for (const topic of catalog.golfRulesCatalog) assert.ok(h.text().includes(topic.title));
  const topic = catalog.golfRulesCatalog.find(entry => entry.rule === "12")!;
  const button = h.nodes().find(node => node.type === "button" && text(node).includes(topic.title))!;
  (button.props.onClick as () => void)(); h.render(); await h.runTimers();
  assert.equal(h.state().query, "Regla 12"); assert.ok(h.text().includes("Resultados"));
  assert.equal(h.searchRequests[0].query, "Regla 12");
});

test("typing Bola keeps the current local search, shows X and compact results, and one tap immediately restores Home", async () => {
  const h = harness(); h.change("rules-search", "Bola"); await h.runTimers();
  assert.equal(h.searchRequests[0].query, "Bola"); assert.match(h.text(), /Resultados/); assert.doesNotMatch(h.text(), /Situaciones comunes/);
  assert.equal(h.nodes().filter(node => node.props.className === "ruleResult").length, 20);
  h.click("Limpiar búsqueda");
  assert.deepEqual(h.state(), { query: "", results: [], searching: false });
  assert.match(h.text(), /Temas principales/); assert.match(h.text(), /Situaciones comunes/);
  assert.equal(h.nodes().filter(node => node.props.className === "ruleResult").length, 0);
});

test("X cancels the existing in-flight search and late abort handling cannot replace the cleared Home", async () => {
  const h = harness({ deferredSearch: true }); h.change("rules-search", "Bola");
  const pending = h.runTimers(); h.render(); assert.equal(h.state().searching, true);
  h.click("Limpiar búsqueda"); assert.equal(h.searchRequests[0].signal?.aborted, true);
  await pending; await h.settle();
  assert.deepEqual(h.state(), { query: "", results: [], searching: false }); assert.match(h.text(), /Situaciones comunes/);
});

test("whitespace does not create an active search or an X", () => {
  const h = harness(); h.change("rules-search", "  ");
  assert.match(h.text(), /Situaciones comunes/);
  assert.ok(h.nodes().every(node => node.props["aria-label"] !== "Limpiar búsqueda"));
});

test("Más recursos preserves AI, local rules, documents, PDF wiring and the original playlist embed", async () => {
  const h = harness(); await h.settle(); h.click("Más recursos");
  for (const title of ["Preguntar a la IA", "Reglamento navegable", "⛳ Reglas Locales · La Vista", "Código de Caballeros", "Documentos oficiales"]) h.button(title);
  assert.ok(h.nodes().some(node => node.type === "iframe" && node.props.src === catalog.OFFICIAL_RULES_VIDEOS_EMBED_URL));
  h.click("Abrir Procedimientos oficiales");
  const pdf = h.nodes().find(node => node.type === "pdf-viewer")!;
  assert.equal((pdf.props.document as { id: string }).id, documents.OFFICIAL_RULES_DOCUMENTS[1].id);
  (pdf.props.onBack as () => void)(); h.render();
  h.click("Preguntar a la IA"); h.change("rules-question", "Mi bola está en un camino de carritos");
  const form = h.nodes().find(node => node.type === "form")!;
  await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); await h.settle();
  assert.equal(h.aiRequests[0].endpoint, "/api/rules/ask"); assert.equal(h.aiRequests[0].body.courseName, "La Vista"); assert.match(h.text(), /Respuesta de prueba/);
  const other = harness({ courseName: "Club Campestre" }); other.click("Más recursos"); assert.doesNotMatch(other.text(), /Reglas Locales · La Vista/);
});
