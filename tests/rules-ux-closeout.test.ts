import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  if (node.props?.["aria-hidden"]) return "";
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
    "next/image": (props: Record<string, unknown>) => jsx("img", props),
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
  h.click("Abrir referencia →"); assert.ok(h.nodes().some(node => node.props.id === "rule-detail-title"));
  h.click("← Búnker"); assert.match(h.text(), /Resumen de la situación/);
  h.click("← Reglas"); assert.match(h.text(), /Temas principales/); assert.equal(h.history.length, 1);
});

test("every situation uses existing subrules and verified official-playlist videos", () => {
  const expected = [["bunker", ["12.2"]], ["out_of_bounds", ["18.2"]], ["lost_ball", ["18.2"]], ["free_relief", ["16.1"]], ["penalty_area", ["17.1"]], ["obstructions", ["15.2", "16.1"]], ["drop", ["14.3"]]];
  assert.deepEqual(catalog.RULES_COMMON_SITUATIONS.map(entry => [entry.id, entry.references]), expected);
  for (const situation of catalog.RULES_COMMON_SITUATIONS) {
    for (const reference of situation.references) assert.ok(navigation.findNavigableRule(reference)?.section, reference);
    const h = harness(); const card = h.nodes().find(node => node.props.className === "situationCard" && text(node).includes(situation.title))!;
    (card.props.onClick as () => void)(); h.render();
    const videos = h.nodes().filter(node => node.type === "a");
    assert.deepEqual(videos.map(node => node.props.href).sort(), catalog.RULE_SITUATION_VIDEOS[situation.id].map(video => `https://www.youtube.com/shorts/${video.id}`).sort(), "Each catalog video appears exactly once");
    assert.ok(h.text().indexOf("Videos") < h.text().indexOf("Resumen de la situación"));
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
  const durations = new Map([["fc0yMbViP4Q", "0:53"], ["AnnGid9b-Ms", "0:35"], ["8hqhJDFwVNg", "0:48"]]);
  for (const video of videos) { assert.equal(video.title, verified.get(video.id)); assert.equal(video.duration, durations.get(video.id)); }
  assert.match(catalog.OFFICIAL_RULES_VIDEOS_URL, /PLnU5qUEfww3dYQwcnZ5qoGAlwzGRtghdA/);
});

test("premium Home has the requested AI copy, disclaimer and exclusive local photography", () => {
  const h = harness();
  assert.match(h.text(), /REGLAS DE GOLF, MÁS CLARAS/);
  assert.match(h.text(), /Pregúntale al juez de Reglas Backyard IA/);
  assert.match(h.text(), /Resuelve dudas de reglas y situaciones del campo en segundos\./);
  assert.match(h.text(), /La IA puede equivocarse\. Verifica la regla oficial\./);
  assert.ok(h.text().indexOf("Pregúntale al juez") < h.text().indexOf("Temas principales"));
  for (const node of h.nodes().filter(node => node.props.className === "situationThumb")) {
    assert.match((node.props.style as { backgroundImage: string }).backgroundImage, /^url\(\/rules\/(?!ai-hero)/);
  }
  const css = readFileSync("app/components/rules-panel.module.css", "utf8");
  assert.equal(css.match(/url\('\/rules\/ai-hero.webp'\)/g)?.length, 2, "Only hero and Bolas use the branded photo");
  for (const name of ["ai-hero", "bunker", "bounds", "penalty", "relief", "obstruction", "lost-ball", "drop"]) assert.ok(readFileSync(`public/rules/${name}.webp`).length > 0);
});

test("premium bunker retains its photograph, recommended video, two remaining clips and official reference", () => {
  const h = harness(); h.click("Búnker");
  assert.equal(h.nodes().filter(node => node.props.className === "recommendedVideo").length, 1);
  const clips = h.nodes().find(node => node.props.className === "miniClips")!;
  assert.equal(nodes(clips).filter(node => node.type === "a").length, 2);
  assert.match(h.text(), /VIDEO RECOMENDADO/); assert.match(h.text(), /Bola injugable en el búnker/);
  assert.ok(h.nodes().some(node => node.type === "img" && node.props.src === "/rules/bunker.webp"));
  for (const duration of ["0:53", "0:35", "0:48"]) assert.ok(h.text().includes(duration));
  for (const label of ["Qué significa", "Qué puedes hacer", "Qué debes evitar", "Penalidad / qué ocurre después"]) assert.ok(h.text().includes(label));
  assert.match(h.text(), /La infracción a las restricciones de 12.2 puede implicar penalidad general/);
  assert.match(h.text(), /Retirar impedimentos sueltos y obstrucciones movibles/);
  assert.doesNotMatch(h.text(), /No puedes tocar la arena con la mano o el palo antes de golpear/);
  h.click("Abrir referencia →"); assert.ok(h.nodes().some(node => node.props.id === "rule-detail-title"));
});

const situationPhotos: Record<string, string> = { bunker: "bunker", out_of_bounds: "bounds", lost_ball: "lost-ball", free_relief: "relief", penalty_area: "penalty", obstructions: "obstruction", drop: "drop" };
const situationPrompts: Record<string, string> = {
  bunker: "Quiero una explicación más simple sobre qué puedo hacer en un búnker y cuándo hay penalidad.",
  out_of_bounds: "Explícame de forma sencilla qué debo hacer cuando mi bola está fuera de límites.",
  lost_ball: "Explícame de forma sencilla qué debo hacer si no encuentro mi bola y cuándo se considera perdida.",
  free_relief: "Explícame cuándo tengo alivio sin penalidad y cómo debo proceder.",
  penalty_area: "Explícame mis opciones cuando mi bola entra en un área de penalidad.",
  obstructions: "Ayúdame a distinguir una obstrucción movible de una inamovible y qué alivio permite la regla.",
  drop: "Explícame paso a paso cómo debo dropar correctamente una bola.",
};
function openSituation(h: ReturnType<typeof harness>, situation: catalog.RuleSituation) {
  const card = h.nodes().find(node => node.props.className === "situationCard" && text(node).includes(situation.title))!;
  assert.ok(card, situation.id); (card.props.onClick as () => void)(); h.render();
}

for (const situation of catalog.RULES_COMMON_SITUATIONS) {
  test(`${situation.id}: shared premium detail, exact catalog content, no duplicate videos or unverified durations`, () => {
    const h = harness(); openSituation(h, situation);
    assert.equal(h.nodes()[0].props.className, "scope situationDetail");
    const heading = h.nodes().find(node => node.props.className === "situationHeading")!;
    assert.equal(text(nodes(heading).find(node => node.type === "h2")), situation.title);
    assert.equal(text(nodes(heading).find(node => node.type === "p")), situation.description);
    const photo = h.nodes().find(node => node.type === "img")!;
    assert.equal(photo.props.src, `/rules/${situationPhotos[situation.id]}.webp`);
    assert.equal(photo.props.fill, true); assert.equal(photo.props.alt, situation.title);
    const videos = catalog.RULE_SITUATION_VIDEOS[situation.id];
    const recommended = h.nodes().filter(node => node.props.className === "recommendedVideo");
    assert.equal(recommended.length, 1);
    const expectedRecommended = videos[situation.id === "bunker" ? 1 : 0];
    assert.equal(recommended[0].props.href, `https://www.youtube.com/shorts/${expectedRecommended.id}`);
    assert.ok(text(recommended[0]).includes(expectedRecommended.displayTitle));
    assert.ok(text(recommended[0]).includes(expectedRecommended.description));
    assert.ok(text(recommended[0]).includes("YouTube | Reglas de Golf · USGA"));
    const clips = h.nodes().find(node => node.props.className === "miniClips");
    assert.equal(Boolean(clips), videos.length > 1, "Single-video screens have no empty clip container");
    assert.equal(clips ? nodes(clips).filter(node => node.type === "a").length : 0, videos.length - 1);
    const durationBadges = h.nodes().filter(node => node.props.className === "duration");
    assert.deepEqual(durationBadges.map(text).sort(), videos.flatMap(video => video.duration ? [video.duration] : []).sort());
    for (const video of h.nodes().filter(node => node.type === "a")) {
      const id = String(video.props.href).split("/").at(-1);
      const source = videos.find(entry => entry.id === id)!; assert.ok(source, "USGA video source integrity");
      assert.equal(video.props.title, source.title);
      const thumb = nodes(video).find(node => /Thumb$/.test(String(node.props.className)))!;
      assert.equal((thumb.props.style as { backgroundImage: string }).backgroundImage, `url(https://i.ytimg.com/vi/${source.id}/hqdefault.jpg)`);
    }
    const summary = h.nodes().find(node => node.props.className === "situationSummary")!;
    assert.equal(nodes(summary).filter(node => node.props.className === "summaryRow").length, 4);
    for (const reference of situation.references) {
      const { chapter, section } = navigation.findNavigableRule(reference)!;
      for (const source of [section?.summary || chapter.summary, chapter.allows, chapter.forbids, section?.penalty || "La consecuencia depende de los hechos y de la modalidad. Confírmala en la fuente oficial antes de aplicarla."]) assert.ok(text(summary).includes(source), `${reference}: summary uses indexed source verbatim`);
    }
    const references = h.nodes().filter(node => node.props.className === "situationReference");
    assert.equal(references.length, situation.references.length);
    for (const [index, reference] of situation.references.entries()) {
      assert.ok(text(references[index]).replace(/\s+/g, " ").includes(`Regla ${reference}`));
      assert.ok(text(references[index]).includes(navigation.findNavigableRule(reference)!.section!.title));
    }
    const rendered = h.text();
    assert.ok(rendered.indexOf("Videos") < rendered.indexOf("Resumen de la situación"));
    assert.ok(rendered.indexOf("Resumen de la situación") < rendered.indexOf("Reglas de golf".toUpperCase()));
    assert.ok(rendered.lastIndexOf("Texto oficial, aclaraciones y diagramas.") < rendered.indexOf("¿Quieres una explicación más simple?"));
    h.click("← Reglas"); assert.match(h.text(), /Temas principales/); assert.equal(h.history.length, 1);
  });

  test(`${situation.id}: official reference buttons and contextual AI reuse current Rules navigation`, async () => {
    const h = harness(); await h.settle(); openSituation(h, situation);
    for (const reference of situation.references) {
      const card = h.nodes().find(node => node.props.className === "situationReference" && text(node).replace(/\s+/g, " ").includes(`Regla ${reference}`))!;
      const button = nodes(card).find(node => node.type === "button")!;
      (button.props.onClick as () => void)(); h.render();
      const heading = h.nodes().find(node => node.props.id === "rule-detail-title")!;
      assert.ok(text(heading).includes(navigation.findNavigableRule(reference)!.section!.title));
      h.click(situation.id === "bunker" ? "← Búnker" : "← Situación");
      assert.equal(h.nodes()[0].props.className, "scope situationDetail");
    }
    h.click("Preguntar ahora"); await h.settle();
    assert.equal(h.nodes().find(node => node.props.id === "rules-question")!.props.value, situationPrompts[situation.id]);
    assert.equal(h.history.length, 1); assert.equal(h.aiRequests.length, 0);
    assert.match(h.text(), /La IA puede equivocarse y no sustituye la regla oficial/);
    assert.match(h.text(), /Comité o árbitro oficial tiene la decisión final/);
  });
}

test("approved Rules Home and Más recursos render code is unchanged from base 60467ee", () => {
  const source = readFileSync("app/components/rules-panel.tsx", "utf8").replace(/\r\n/g, "\n");
  const home = source.slice(source.lastIndexOf('  return <div className={`rulesHome'));
  assert.equal(createHash("sha256").update(home).digest("hex"), "23b1ac2f5b1fbdd2c552d6abf1925b49dc55b32d0eee592348aebab704aa7083");
});

test("hero and bunker AI CTAs open the same Rules form without sending a question automatically", async () => {
  const h = harness(); await h.settle(); h.click("Preguntar a la IA");
  assert.ok(h.nodes().some(node => node.props.id === "rules-question"));
  assert.match(h.text(), /La IA puede equivocarse y no sustituye la regla oficial/);
  assert.equal(h.aiRequests.length, 0);
  const detail = harness(); await detail.settle(); detail.click("Búnker"); detail.click("Preguntar ahora"); await detail.settle();
  assert.ok(detail.nodes().some(node => node.props.id === "rules-question"));
  assert.equal(detail.history.length, 1);
  assert.equal(detail.aiRequests.length, 0);
  detail.change("rules-question", "¿Qué puedo hacer antes del golpe en el búnker?");
  const form = detail.nodes().find(node => node.type === "form")!;
  await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); await detail.settle();
  assert.equal(detail.aiRequests[0].endpoint, "/api/rules/ask");
  assert.equal(detail.aiRequests[0].body.courseName, "La Vista");
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
