import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as fitting from "../lib/ball-fitting";
import * as handicap from "../lib/ball-fit-handicap";
import * as api from "../lib/ball-fitting-api";
import * as draft from "../lib/ball-fitting-storage";
import * as equipment from "../lib/golf-equipment";
import { summarizeLaunchMonitorSession, type LaunchMonitorSession } from "../lib/golf-equipment";
import { golfBallCatalog } from "../lib/golf-equipment-catalog";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children)]; }
function text(value: unknown): string { if (Array.isArray(value)) return value.map(text).join(" "); if (value && typeof value === "object") return text((value as Node).props?.children); return typeof value === "string" || typeof value === "number" ? String(value) : ""; }

function wizard(profileIndex: number | null = null, profileSource: handicap.BallFitHandicapSource | null = null, savedInput?: fitting.BallFitInput, persistedDraft?: { input: fitting.BallFitInput; step: number }, currentBall: equipment.PlayerBall | null = null) {
  const slots: unknown[] = []; let cursor = 0; const effects: (() => void)[] = [];
  const scrollResetKeys: string[] = [];
  const storageValues = new Map<string, string>();
  const storageWrites: string[] = [];
  const storage = { getItem: (key: string) => storageValues.get(key) ?? null, setItem: (key: string, value: string) => { storageValues.set(key, value); storageWrites.push(value); }, removeItem: (key: string) => { storageValues.delete(key); } };
  if (persistedDraft) draft.saveBallFitDraft(storage, persistedDraft.input, persistedDraft.step, "2026-09-28T12:30:00.000Z");
  const sent: fitting.BallFitInput[] = [], saved: fitting.BallFitInput[] = [];
  const currentSelections: equipment.GolfBallCatalog[] = [];
  const savedChoices: unknown[] = [];
  let cancelCount = 0;
  const exports: Record<string, (props: unknown) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === "function" ? type(props) : { type, props };
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(fn: () => unknown) { return fn(); },
    useEffect(fn: () => void, dependencies: unknown[]) { const index = cursor++; const prior = slots[index] as unknown[] | undefined; if (!prior || dependencies.some((value, n) => !Object.is(value, prior[n]))) effects.push(fn); slots[index] = dependencies; },
  };
  const compiled = ts.transpileModule(readFileSync("app/components/ball-fit-wizard.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, { exports, AbortController, structuredClone, localStorage: storage, fetch: async (_url: string, init: { body: string }) => {
    const input = api.normalizeBallFitTransportInput(JSON.parse(init.body).input); assert.ok(input); sent.push(input);
    const result = fitting.runBackyardBallFit(golfBallCatalog, input);
    const catalog = golfBallCatalog.filter((ball) => result.recommendations.some((item) => item.catalogBallId === ball.id));
    return { ok: true, json: async () => ({ provider: "internal-fixture", scope: { complete: true, activeCandidateCount: 1, evaluatedCandidateCount: 1, maximumCandidates: 2000 }, result, catalog }) };
  }, require: (name: string) => {
    if (name === "react") return react;
    if (name === "./use-view-scroll-reset") return { useViewScrollReset(key: unknown) { react.useEffect(() => { scrollResetKeys.push(String(key)); }, [key]); } };
    if (name === "./numeric-capture-input") return { NumericCaptureInput: (props: Record<string, unknown>) => ({ type: "input", props }) };
    if (name === "./anchored-search") return {
      AnchoredSearch: (props: Record<string, unknown>) => ({ type: "anchored-search", props }),
      AnchoredSearchOption: (props: Record<string, unknown>) => ({ type: "button", props }),
    };
    if (name === "./feedback-dialog") return { FeedbackLink: (props: Record<string, unknown>) => ({ type: "button", props }) };
    if (name === "./use-equipment-catalog-search") return { useEquipmentCatalogSearch: () => ({ items: golfBallCatalog, status: "ready", hasMore: false, loadMore: async () => {} }) };
    // Presentation children do not own the fitting state exercised by this harness.
    if (name === "./catalog-product-media") return { CatalogProductMedia: (props: Record<string, unknown>) => ({ type: "catalog-media", props }) };
    if (name === "./backyard-icon") return { BackyardIcon: (props: Record<string, unknown>) => ({ type: "svg", props }) };
    if (name === "./equipment-visuals") return { BallFitBallVisual: (props: Record<string, unknown>) => ({ type: "ball-fit-ball", props }) };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name.endsWith("/ball-fitting")) return fitting;
    if (name.endsWith("/ball-fitting-api")) return api;
    if (name.endsWith("/ball-fitting-storage")) return draft;
    if (name.endsWith("/ball-fit-handicap")) return handicap;
    if (name.endsWith("/golf-equipment")) return { summarizeLaunchMonitorSession };
    if (name.endsWith("/launch-monitor-capture")) return { LaunchMonitorCapture: "launch-capture" };
    if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
    throw new Error(name);
  } });
  let props = { userId: "flow-owner", defaultHandicap: profileIndex, defaultHandicapSource: profileSource, savedInput,
    profileDefaults: { trajectoryPreference: "MID", priorities: ["WEDGE_SPIN"] }, currentBall, catalog: golfBallCatalog,
    onCancel() { cancelCount += 1; }, onCurrentBallSelect(ball: equipment.GolfBallCatalog) { currentSelections.push(ball); }, onComplete(_result: fitting.BallFitResult, input: fitting.BallFitInput, choice: unknown) { saved.push(input); savedChoices.push(choice); } };
  let tree: Node;
  function render() { cursor = 0; tree = exports.BallFitWizard(props); effects.splice(0).forEach((effect) => effect()); return tree; }
  render(); render();
  return { sent, saved, savedChoices, currentSelections, scrollResetKeys, render, text: () => text(tree), cancelCount: () => cancelCount,
    classCount(className: string) { return nodes(tree).filter((node) => String(node.props.className || "").split(/\s+/).includes(className)).length; },
    ballVisualCount: () => nodes(tree).filter((node) => node.type === "ball-fit-ball").length,
    progress() {
      const track = nodes(tree).find((node) => node.props.className === "progressTrack"); assert.ok(track, "progress track");
      return { label: track.props["aria-label"], active: nodes(track).filter((node) => node.type === "span" && node.props["data-active"] === true).length };
    },
    buttonProps(label: string) {
      const button = nodes(tree).find((node) => node.type === "button" && text(node.props.children).trim().startsWith(label)); assert.ok(button, `button ${label}`);
      return button.props;
    },
    clearStorageWrites() { storageWrites.length = 0; },
    lastDraftWrite() {
      const serialized = storageWrites.at(-1);
      return serialized ? draft.normalizeBallFitDraft(JSON.parse(serialized), "flow-owner") : null;
    },
    draftStep: () => draft.loadBallFitDraft(storage, "flow-owner")?.step ?? null,
    applyLaunchSession(session: LaunchMonitorSession | null) {
    let capture = nodes(tree).find((node) => node.type === "launch-capture"); assert.ok(capture, "launch capture");
    (capture.props.onChange as (value: LaunchMonitorSession | null) => void)(session); render();
    capture = nodes(tree).find((node) => node.type === "launch-capture"); assert.ok(capture, "launch capture after change");
    (capture.props.onDone as () => void)(); render();
  }, search: () => {
    const search = nodes(tree).find((node) => node.type === "anchored-search"); assert.ok(search); return search.props;
  }, focusSearch() {
    const search = nodes(tree).find((node) => node.type === "anchored-search"); assert.ok(search);
    (search.props.onFocus as () => void)(); render();
  }, selectCatalogBall(label: string) {
    const option = nodes(tree).find((node) => node.type === "button" && node.props.label === label); assert.ok(option, label);
    (option.props.onSelect as () => void)(); render();
  }, catalogOptionCount(label: string) {
    return nodes(tree).filter((node) => node.type === "button" && node.props.label === label).length;
  }, updateAccountIndex(value: number | null, source: handicap.BallFitHandicapSource | null) {
    props = { ...props, defaultHandicap: value, defaultHandicapSource: source };
    render();
  }, selectRadio(label: string) {
    const radio = nodes(tree).find((node) => node.type === "input" && node.props.type === "radio" && node.props["aria-label"] === label); assert.ok(radio, label);
    (radio.props.onChange as () => void)(); render();
  }, checkedRadios() {
    return nodes(tree).filter((node) => node.type === "input" && node.props.type === "radio" && node.props.checked === true).map((node) => node.props["aria-label"]);
  }, radioLabels() {
    return nodes(tree).filter((node) => node.type === "input" && node.props.type === "radio").map((node) => String(node.props["aria-label"]));
  }, async click(label: string) {
    const button = nodes(tree).find((node) => node.type === "button" && text(node.props.children).trim().startsWith(label)); assert.ok(button, `button ${label}`);
    assert.notEqual(button.props.disabled, true); await (button.props.onClick as () => unknown)(); render();
  }, number(min: number) { return nodes(tree).find((node) => node.type === "input" && node.props.min === min)?.props.value; }, changeNumber(value: string, min = -20) {
    const field = nodes(tree).find((node) => node.type === "input" && node.props.min === min); assert.ok(field);
    (field.props.onValueChange as (value: number) => void)(Number(value)); render();
  } };
}

const BALL_FIT_INTRO_COPY = /Encuentra la pelota ideal para tu juego|Balance en cada golpe|Llega más lejos|Juega con precisión|Siente la diferencia/;

test("Ball Fit keeps the full hero on Step 1 and progressively discloses Steps 2 through 6", async () => {
  const h = wizard(null, null);
  const steps = [
    { title: "Tu juego actual", progress: "17% del fitting" },
    { title: "¿Cómo quieres continuar?", progress: "33% del fitting" },
    { title: "Feel y vuelo", progress: "50% del fitting" },
    { title: "Approach y green", progress: "67% del fitting" },
    { title: "¿Qué quieres mejorar?", progress: "83% del fitting" },
    { title: "Precio y color", progress: "100% del fitting" },
  ];

  for (const [index, expected] of steps.entries()) {
    const copy = h.text();
    assert.match(copy, new RegExp(`Paso ${index + 1} de 6`));
    assert.match(copy, new RegExp(expected.title.replace(/[?]/g, "\\?")));
    for (const [otherIndex, other] of steps.entries()) {
      if (otherIndex !== index) assert.doesNotMatch(copy, new RegExp(other.title.replace(/[?]/g, "\\?")));
    }
    assert.match(copy, /Guardar y regresar/);
    assert.deepEqual(h.progress(), { label: expected.progress, active: index + 1 });
    assert.equal(h.classCount("ballFitLead"), index === 0 ? 1 : 0);
    assert.equal(h.classCount("ballFitHero"), index === 0 ? 1 : 0);
    assert.equal(h.classCount("fitPillars"), index === 0 ? 1 : 0);
    if (index === 0) assert.equal(h.ballVisualCount(), 1);
    if (index === 0) assert.match(copy, BALL_FIT_INTRO_COPY);
    else assert.doesNotMatch(copy, BALL_FIT_INTRO_COPY);

    if (index < steps.length - 1) {
      assert.notEqual(h.buttonProps("Siguiente →").disabled, true);
      await h.click("Siguiente →");
      assert.equal(h.scrollResetKeys.at(-1), `${index + 1}:false:true:false`);
    } else {
      assert.match(copy, /Ver mi Top 3/);
      assert.doesNotMatch(copy, /Siguiente →/);
    }
  }

  await h.click("Ver mi Top 3");
  assert.equal(h.scrollResetKeys.at(-1), "6:false:true:false");
  assert.match(h.text(), /Tu mejor grupo de bolas/);
  assert.doesNotMatch(h.text(), /Paso 7 de 6/);
  assert.doesNotMatch(h.text(), BALL_FIT_INTRO_COPY);
  assert.deepEqual(h.progress(), { label: "100% del fitting", active: 6 });

  await h.click("← Anterior");
  assert.equal(h.scrollResetKeys.at(-1), "5:false:true:false");
  assert.match(h.text(), /Paso 6 de 6[\s\S]*Precio y color/);
  assert.doesNotMatch(h.text(), BALL_FIT_INTRO_COPY);
  for (let index = 4; index >= 0; index -= 1) {
    await h.click("← Anterior");
    assert.equal(h.scrollResetKeys.at(-1), `${index}:false:true:false`);
    assert.match(h.text(), new RegExp(`Paso ${index + 1} de 6`));
    assert.match(h.text(), new RegExp(steps[index].title.replace(/[?]/g, "\\?")));
  }
  assert.match(h.text(), BALL_FIT_INTRO_COPY);
  assert.equal(h.buttonProps("← Anterior").disabled, true);
});

test("Ball Fit keeps save-and-return and resets scroll only when the displayed step changes", async () => {
  const h = wizard(null, null);
  const initialResetCount = h.scrollResetKeys.length;
  await h.click("No conozco mi hándicap / Estoy empezando");
  assert.equal(h.scrollResetKeys.length, initialResetCount, "answer edits must not reset the view");

  await h.click("Siguiente →");
  assert.equal(h.scrollResetKeys.at(-1), "1:false:true:false");
  await h.click("Siguiente →");
  await h.click("Siguiente →");
  assert.equal(h.scrollResetKeys.at(-1), "3:false:true:false");
  assert.match(h.text(), /Paso 4 de 6[\s\S]*Approach y green/);

  await h.click("← Anterior");
  assert.equal(h.scrollResetKeys.at(-1), "2:false:true:false");
  assert.match(h.text(), /Paso 3 de 6[\s\S]*Feel y vuelo/);
  await h.click("Siguiente →");
  assert.equal(h.scrollResetKeys.at(-1), "3:false:true:false");

  h.clearStorageWrites();
  await h.click("Guardar y regresar");
  assert.equal(h.cancelCount(), 1);
  assert.equal(h.draftStep(), 3);
  assert.equal(h.lastDraftWrite()?.step, 3);
  assert.equal(h.lastDraftWrite()?.input.handicapSource, "UNKNOWN");
});

test("a persisted result sentinel resumes at compact Step 6 instead of showing Step 7", async () => {
  const input = fitting.normalizeBallFitInput({ userId: "flow-owner", handicapSource: "UNKNOWN" });
  assert.ok(input);
  const h = wizard(null, null, undefined, { input, step: 6 });
  assert.match(h.text(), /Tienes un fitting en progreso/);
  await h.click("Reanudar fitting");
  assert.match(h.text(), /Paso 6 de 6[\s\S]*Precio y color/);
  assert.doesNotMatch(h.text(), /Paso 7 de 6/);
  assert.doesNotMatch(h.text(), BALL_FIT_INTRO_COPY);
});

test("resuming a legacy draft reconciles its selected comparison ball into Equipment", async () => {
  const selected = golfBallCatalog.find((ball) => ball.active)!;
  const input = fitting.normalizeBallFitInput({
    userId: "flow-owner",
    handicapSource: "UNKNOWN",
    currentBallId: selected.id,
  });
  assert.ok(input);
  const h = wizard(null, null, undefined, { input, step: 5 });

  await h.click("Reanudar fitting");

  assert.equal(h.currentSelections.length, 1);
  assert.equal(h.currentSelections[0].id, selected.id);
  assert.match(h.text(), /Paso 6 de 6[\s\S]*Precio y color/);
});

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
  await h.click("Guardar elección y terminar");
  assert.equal(h.saved[0].handicapSource, mode); assert.equal(h.saved[0].userId, "flow-owner");
});

test("Actualizar fit restores saved answers, edits them independently, and preserves the saved snapshot", async () => {
  const previous = fitting.normalizeBallFitInput({ userId: "flow-owner", handicap: 18, handicapSource: "MANUAL", typicalScore: 82, driverDistanceYards: 245, swingSpeedBand: "UNKNOWN", feelPreference: "SOFT", trajectoryPreference: "MID", priorities: ["WEDGE_SPIN"] })!;
  const h = wizard(null, null, previous);
  assert.equal(h.number(40), 82); assert.equal(h.number(-20), 18);
  h.changeNumber("95", 40); await h.click("Siguiente →");
  assert.equal(h.number(50), 245);
  for (let index = 0; index < 4; index++) await h.click("Siguiente →");
  await h.click("Ver mi Top 3"); await h.click("Guardar elección y terminar");
  assert.equal(h.saved[0].typicalScore, 95); assert.equal(h.saved[0].driverDistanceYards, 245);
  assert.equal(h.saved[0].swingSpeedBand, "UNKNOWN"); assert.equal(h.saved[0].handicapSource, "MANUAL");
  assert.equal(previous.typicalScore, 82);
});

test("a newly available canonical GHIN index replaces MANUAL data from a prior completed fit", async () => {
  const previous = fitting.normalizeBallFitInput({ userId: "flow-owner", handicap: 18, handicapSource: "MANUAL", typicalScore: 82, driverDistanceYards: 245, feelPreference: "SOFT", trajectoryPreference: "MID", priorities: ["WEDGE_SPIN"] })!;
  const h = wizard(7.9, "GHIN", previous);
  assert.match(h.text(), /Handicap Index\s+GHIN · 7\.9/);
  assert.doesNotMatch(h.text(), /Capturar HCP manual|No conozco mi hándicap/);
  for (let index = 0; index < 5; index++) await h.click("Siguiente →");
  await h.click("Ver mi Top 3");
  assert.equal(h.sent[0].handicapSource, "GHIN");
  assert.equal(h.sent[0].handicap, 7.9);
  assert.equal(previous.handicapSource, "MANUAL", "the historical snapshot remains immutable");
});

test("a manual value typed in the current fitting survives a later canonical-index refresh", async () => {
  const h = wizard(null, null);
  await h.click("Capturar HCP manual");
  h.changeNumber("21.3");
  h.updateAccountIndex(7.9, "GHIN");
  assert.equal(h.number(-20), 21.3);
  for (let index = 0; index < 5; index++) await h.click("Siguiente →");
  await h.click("Ver mi Top 3");
  assert.equal(h.sent[0].handicapSource, "MANUAL");
  assert.equal(h.sent[0].handicap, 21.3);
});

test("saved fitting from another account cannot seed the editing form", () => {
  const foreign = fitting.normalizeBallFitInput({ userId: "another-owner", typicalScore: 72, driverDistanceYards: 300 })!;
  const h = wizard(null, null, foreign);
  assert.equal(h.number(40), null);
});

test("verified GHIN and calculated Backyard values enter Ball Fit automatically with their canonical labels", () => {
  const ghin = wizard(7.9, "GHIN");
  assert.match(ghin.text(), /Handicap Index\s+GHIN · 7\.9/);
  assert.doesNotMatch(ghin.text(), /Capturar HCP manual|No conozco mi hándicap/);
  assert.doesNotMatch(ghin.text(), /todavía no disponible|continuar sin GHIN/);

  const backyard = wizard(8.4, "BACKYARD");
  assert.match(backyard.text(), /Backyard Index · 8\.4/);
  assert.doesNotMatch(backyard.text(), /Capturar HCP manual|No conozco mi hándicap/);

  const pending = wizard(null, "BACKYARD");
  assert.match(pending.text(), /Tu Backyard Index todavía no está disponible/);
  assert.match(pending.text(), /Capturar HCP manual/);
  assert.match(pending.text(), /No conozco mi hándicap \/ Estoy empezando/);
});

test("launch monitor choice precedes the manual driver questionnaire", async () => {
  const h = wizard(null, null);
  await h.click("No conozco mi hándicap / Estoy empezando");
  await h.click("Siguiente →");
  const copy = h.text();
  const currentGame = copy.indexOf("TU JUEGO ACTUAL");
  const choice = copy.indexOf("¿Cómo quieres continuar?");
  const launch = copy.indexOf("Agregar mediciones de launch monitor");
  const separator = copy.indexOf("O CONTINÚA MANUALMENTE");
  const manual = copy.indexOf("Tu juego con driver");
  assert.ok(currentGame >= 0 && currentGame < choice && choice < launch && launch < separator && separator < manual);
  assert.match(copy, /TrackMan, FlightScope, Garmin, GCQuad, Rapsodo u otro/);
  assert.doesNotMatch(h.text(), /Selecciona tu palo/);
  await h.click("Agregar mediciones de launch monitor");
  assert.match(h.text(), /Captura y analiza tus golpes/);
  assert.match(h.text(), /Sube fotos de tu monitor de lanzamiento/);
});

test("the active GHIN value is shown before choosing launch monitor or manual entry", async () => {
  const h = wizard(7.9, "GHIN");
  await h.click("Siguiente →");
  assert.match(h.text(), /TU JUEGO ACTUAL\s*GHIN INDEX 7\.9/);
});

function capturedDriverSession(metrics: { carryYards?: number; clubSpeedMph?: number }): LaunchMonitorSession {
  return {
    id: `launch-${metrics.carryYards ?? "none"}-${metrics.clubSpeedMph ?? "none"}`,
    userId: "flow-owner",
    source: "Launch monitor",
    startedAt: "2026-09-28T12:00:00.000Z",
    completedAt: null,
    shots: [{
      id: "shot-1",
      club: "DRIVER",
      excluded: false,
      capturedAt: "2026-09-28T12:01:00.000Z",
      note: null,
      clubSpeedMph: metrics.clubSpeedMph ?? null,
      ballSpeedMph: null,
      launchAngleDegrees: null,
      spinRpm: null,
      carryYards: metrics.carryYards ?? null,
      totalYards: null,
      peakHeightYards: null,
      landingAngleDegrees: null,
    }],
  };
}

function capturedIronSession(): LaunchMonitorSession {
  return {
    ...capturedDriverSession({}),
    id: "launch-iron",
    shots: [{
      ...capturedDriverSession({}).shots[0],
      id: "iron-shot-1",
      club: "IRON_7",
      carryYards: 165,
    }],
  };
}

test("saving launch metrics advances when carry and club speed are both known", async () => {
  const h = wizard(null, null);
  await h.click("No conozco mi hándicap / Estoy empezando");
  await h.click("Siguiente →");
  await h.click("Agregar mediciones de launch monitor");
  h.applyLaunchSession(capturedDriverSession({ carryYards: 330, clubSpeedMph: 121 }));
  assert.match(h.text(), /Feel y vuelo/);
  assert.doesNotMatch(h.text(), /¿Cuánto pegas aproximadamente con driver\?|Velocidad de swing con driver/);
});

test("saving only carry returns to exactly the missing club-speed question", async () => {
  const h = wizard(null, null);
  await h.click("No conozco mi hándicap / Estoy empezando");
  await h.click("Siguiente →");
  await h.click("Agregar mediciones de launch monitor");
  h.applyLaunchSession(capturedDriverSession({ carryYards: 330 }));
  assert.doesNotMatch(h.text(), /¿Cuánto pegas aproximadamente con driver\?/);
  assert.match(h.text(), /Velocidad de swing con driver/);
});

test("saving only club speed returns to exactly the missing carry question", async () => {
  const h = wizard(null, null);
  await h.click("No conozco mi hándicap / Estoy empezando");
  await h.click("Siguiente →");
  await h.click("Agregar mediciones de launch monitor");
  h.applyLaunchSession(capturedDriverSession({ clubSpeedMph: 121 }));
  assert.match(h.text(), /¿Cuánto pegas aproximadamente con driver\?/);
  assert.doesNotMatch(h.text(), /Velocidad de swing con driver/);
});

test("saving without driver metrics keeps both manual questions available", async () => {
  const h = wizard(null, null);
  await h.click("No conozco mi hándicap / Estoy empezando");
  await h.click("Siguiente →");
  await h.click("Agregar mediciones de launch monitor");
  h.applyLaunchSession(capturedDriverSession({}));
  assert.match(h.text(), /¿Cuánto pegas aproximadamente con driver\?/);
  assert.match(h.text(), /Velocidad de swing con driver/);
});

test("known manual driver data is not reasked after a launch capture for another club", async () => {
  const savedInput = fitting.normalizeBallFitInput({
    userId: "flow-owner",
    handicapSource: "UNKNOWN",
    driverDistanceYards: 245,
    swingSpeedBand: "FROM_95_TO_105",
  });
  assert.ok(savedInput);
  const h = wizard(null, null, savedInput);
  await h.click("Siguiente →");
  await h.click("Agregar mediciones de launch monitor");
  h.applyLaunchSession(capturedIronSession());
  assert.match(h.text(), /Feel y vuelo/);
  assert.doesNotMatch(h.text(), /¿Cuánto pegas aproximadamente con driver\?|Velocidad de swing con driver/);
});

test("after launch capture only the still-missing manual driver fact is requested", async () => {
  const savedInput = fitting.normalizeBallFitInput({
    userId: "flow-owner",
    handicapSource: "UNKNOWN",
    driverDistanceYards: 245,
    swingSpeedBand: "UNKNOWN",
  });
  assert.ok(savedInput);
  const h = wizard(null, null, savedInput);
  await h.click("Siguiente →");
  await h.click("Agregar mediciones de launch monitor");
  h.applyLaunchSession(capturedIronSession());
  assert.doesNotMatch(h.text(), /¿Cuánto pegas aproximadamente con driver\?/);
  assert.match(h.text(), /Velocidad de swing con driver/);
});

test("resuming a saved launch capture still asks only the missing driver fact", async () => {
  const persistedInput = fitting.normalizeBallFitInput({
    userId: "flow-owner",
    handicapSource: "UNKNOWN",
    driverDistanceYards: 245,
    swingSpeedBand: "UNKNOWN",
    launchMonitorSession: capturedIronSession(),
  });
  assert.ok(persistedInput);
  const h = wizard(null, null, undefined, { input: persistedInput, step: 1 });
  assert.match(h.text(), /Tienes un fitting en progreso/);
  await h.click("Reanudar fitting");
  assert.doesNotMatch(h.text(), /¿Cuánto pegas aproximadamente con driver\?/);
  assert.match(h.text(), /Velocidad de swing con driver/);
});

function launchCaptureHarness() {
  const slots: unknown[] = [];
  let cursor = 0;
  let session: LaunchMonitorSession | null = null;
  let done = 0;
  const exports: Record<string, (props: unknown) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>, key?: string) => ({ type, props: key === undefined ? props : { ...props, key } });
  const react = {
    useEffect(fn: () => void) { fn(); },
    useMemo(fn: () => unknown) { return fn(); },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
  };
  const compiled = ts.transpileModule(readFileSync("app/components/launch-monitor-capture.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "next/image") return { __esModule: true, default: "image" };
    if (name.endsWith("/golf-equipment")) return equipment;
    if (name === "./launch-monitor-camera") return { LaunchMonitorCamera: "launch-camera" };
    if (name === "./equipment-category-assets") return { EQUIPMENT_CATEGORY_ASSETS: {
      DRIVER: { src: "/brand/equipment/onboarding-ref-b/driver_ref_b.png", width: 1006, height: 396 },
      IRON_SET: { src: "/brand/equipment/onboarding-ref-b/hierros_ref_b.png", width: 1006, height: 412 },
      WEDGE: { src: "/brand/equipment/onboarding-ref-b/wedges_ref_b.png", width: 1006, height: 412 },
    } };
    if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
    throw new Error(name);
  } });
  let tree: Node;
  const props = () => ({ userId: "flow-owner", value: session, onChange: (next: LaunchMonitorSession | null) => { session = next; }, onDone: () => { done += 1; } });
  const render = () => { cursor = 0; tree = exports.LaunchMonitorCapture(props()); return tree; };
  render();
  return {
    render,
    text: () => text(tree),
    click(label: string) {
      const button = nodes(tree).find((node) => node.type === "button" && text(node).trim().startsWith(label));
      assert.ok(button, label);
      (button.props.onClick as () => void)();
      render();
    },
    buttonText(label: string) {
      const button = nodes(tree).find((node) => node.type === "button" && text(node).trim().startsWith(label));
      assert.ok(button, label);
      return text(button);
    },
    camera(club: equipment.LaunchMonitorClub) {
      const camera = nodes(tree).find((node) => node.type === "launch-camera" && node.props.targetClub === club);
      assert.ok(camera, club);
      return camera.props;
    },
    cameraCount() {
      return nodes(tree).filter((node) => node.type === "launch-camera").length;
    },
    summaryText() {
      const summary = nodes(tree).find((node) => node.type === "section" && node.props["data-capture-order"] === "3");
      assert.ok(summary, "current-club summary");
      return text(summary);
    },
    session: () => session,
    done: () => done,
  };
}

function threeDriverShots() {
  return [0, 1, 2].map((index) => ({
    id: `driver-shot-${index + 1}`,
    club: "DRIVER" as const,
    excluded: false,
    capturedAt: `2026-09-28T12:0${index}:00.000Z`,
    note: null,
    clubSpeedMph: 101 + index,
    ballSpeedMph: 149 + index,
    launchAngleDegrees: 12 + index,
    spinRpm: 2300 + index * 50,
    carryYards: 245 + index,
    totalYards: 260 + index,
    peakHeightYards: 31 + index,
    landingAngleDegrees: 39 + index,
  }));
}

function twoIronShots() {
  return [0, 1].map((index) => ({
    id: `iron-shot-${index + 1}`,
    club: "IRON_7" as const,
    excluded: false,
    capturedAt: `2026-09-28T12:1${index}:00.000Z`,
    note: null,
    clubSpeedMph: null,
    ballSpeedMph: 121 + index,
    launchAngleDegrees: null,
    spinRpm: null,
    carryYards: 160 + index * 2,
    totalYards: null,
    peakHeightYards: null,
    landingAngleDegrees: null,
  }));
}

test("saving each launch-monitor club returns to the selector and only the final Ball Fit action exits", () => {
  const h = launchCaptureHarness();
  assert.match(h.text(), /Selecciona tu palo/);
  h.click("Driver");
  (h.camera("DRIVER").onConfirm as (source: string, shots: ReturnType<typeof threeDriverShots>) => void)("TrackMan", threeDriverShots());
  h.render();
  assert.match(h.summaryText(), /Driver\s*3\s*golpe\s*s\s*válido\s*s/);
  for (const metric of ["Ball Speed", "Carry", "Total", "Launch", "Spin"]) assert.match(h.summaryText(), new RegExp(metric, "i"));

  h.click("Guardar mediciones");
  assert.equal(h.done(), 0, "guardar el palo actual no termina Launch Monitor");
  assert.match(h.text(), /Driver\s+guardado/);
  assert.match(h.buttonText("Driver"), /3\s*\/3 golpes válidos\s*✓/);

  h.click("Hierro 7");
  (h.camera("IRON_7").onConfirm as (source: string, shots: ReturnType<typeof twoIronShots>) => void)("GCQuad", twoIronShots());
  h.render();
  assert.match(h.summaryText(), /Hierro 7\s*2\s*golpe\s*s\s*válido\s*s/);
  for (const metric of ["Ball Speed", "Carry"]) assert.match(h.summaryText(), new RegExp(metric, "i"));
  for (const absent of ["Total", "Launch", "Spin"]) assert.doesNotMatch(h.summaryText(), new RegExp(absent, "i"));

  const captured = h.session();
  assert.ok(captured);
  assert.equal(captured.shots.filter((shot) => shot.club === "DRIVER").length, 3);
  assert.equal(captured.shots.filter((shot) => shot.club === "IRON_7").length, 2);
  assert.equal(captured.shots.find((shot) => shot.id === "driver-shot-1")?.carryYards, 245);
  assert.equal(captured.shots.find((shot) => shot.id === "iron-shot-1")?.carryYards, 160);

  h.click("Guardar mediciones");
  assert.equal(h.done(), 0);
  assert.match(h.buttonText("Driver"), /3\s*\/3 golpes válidos\s*✓/);
  assert.match(h.buttonText("Hierro 7"), /2\s*\/3 golpes válidos\s*✓/);
  h.click("Continuar con Ball Fit");
  assert.equal(h.done(), 1, "sólo Continuar con Ball Fit termina el módulo");
});

test("visited clubs keep their independent camera instances mounted while switching", () => {
  const h = launchCaptureHarness();
  h.click("Driver");
  const driverCamera = h.camera("DRIVER");
  assert.equal(driverCamera.key, "launch-camera-DRIVER-0");

  h.click("Hierro 7");
  const ironCamera = h.camera("IRON_7");
  assert.equal(ironCamera.key, "launch-camera-IRON_7-0");
  assert.equal(h.camera("DRIVER").key, driverCamera.key, "Driver remains mounted with its in-memory photos");
  assert.equal(h.cameraCount(), 2);
});

test("overlapping club analysis callbacks merge against the latest session without losing measurements", () => {
  const h = launchCaptureHarness();
  h.click("Driver");
  const confirmDriver = h.camera("DRIVER").onConfirm as (source: string, shots: ReturnType<typeof threeDriverShots>) => void;
  h.click("Hierro 7");
  const confirmIron = h.camera("IRON_7").onConfirm as (source: string, shots: ReturnType<typeof twoIronShots>) => void;

  confirmIron("GCQuad", twoIronShots());
  confirmDriver("TrackMan", threeDriverShots());
  h.render();

  const captured = h.session();
  assert.ok(captured);
  assert.equal(captured.shots.filter((shot) => shot.club === "DRIVER").length, 3);
  assert.equal(captured.shots.filter((shot) => shot.club === "IRON_7").length, 2);
  assert.equal(captured.shots.length, 5);
});

test("known launch-monitor driver metrics are applied instead of requested again", async () => {
  const savedInput = fitting.normalizeBallFitInput({
    userId: "flow-owner",
    handicap: null,
    handicapSource: "UNKNOWN",
    launchMonitorSession: {
      id: "launch-driver",
      userId: "flow-owner",
      source: "Launch monitor",
      startedAt: "2026-09-28T12:00:00.000Z",
      completedAt: "2026-09-28T12:02:00.000Z",
      shots: [
        { id: "shot-1", club: "DRIVER", excluded: false, clubSpeedMph: 101, carryYards: 247 },
      ],
    },
  });
  assert.ok(savedInput);
  const h = wizard(null, null, savedInput);
  await h.click("Siguiente →");
  assert.match(h.text(), /Club speed\s*101\s*mph/);
  assert.match(h.text(), /Carry\s*247\s*yd/);
  assert.doesNotMatch(h.text(), /¿Cuánto pegas aproximadamente con driver\?|Velocidad de swing con driver/);
});

test("selecting a catalog ball saves its canonical id, closes results and keeps one real generation label", async () => {
  const h = wizard(null, null);
  for (let index = 0; index < 5; index++) await h.click("Siguiente →");
  assert.equal(h.search().expanded, false);
  h.focusSearch();
  assert.equal(h.search().expanded, true);
  const label = "Seleccionar Titleist Pro V1x Left Dash";
  assert.equal(h.catalogOptionCount(label), 1);
  h.selectCatalogBall(label);
  assert.equal(h.currentSelections.length, 1);
  assert.equal(h.currentSelections[0].id, golfBallCatalog.find((ball) => ball.brand === "Titleist" && ball.model === "Pro V1x Left Dash")?.id);
  assert.equal(h.search().expanded, false);
  assert.equal(h.search().value, "Titleist Pro V1x Left Dash");
  assert.match(String(h.search().status), /✓ Seleccionada:\s*Titleist\s+Pro V1x Left Dash/);
  assert.match(h.text(), /2025/);
  assert.doesNotMatch(h.text(), /2025 · 2025|Generación sin dato publicado/);
  h.focusSearch();
  assert.equal(h.search().expanded, true, "the selected ball can be changed by reopening the search");
  h.selectCatalogBall(label);
  await h.click("Ver mi Top 3");
  const canonical = golfBallCatalog.find((ball) => ball.brand === "Titleist" && ball.model === "Pro V1x Left Dash");
  assert.ok(canonical);
  assert.equal(h.sent[0].currentBallId, canonical.id);
});

test("No comparar changes only fitting input and never clears the saved current ball", async () => {
  const h = wizard(null, null);
  for (let index = 0; index < 5; index++) await h.click("Siguiente →");
  h.focusSearch();
  h.selectCatalogBall("Seleccionar Titleist Pro V1x Left Dash");
  assert.equal(h.currentSelections.length, 1);
  h.focusSearch();
  h.selectCatalogBall("No comparar con una bola");
  assert.equal(h.currentSelections.length, 1, "No comparar must not call profile persistence");
  await h.click("Ver mi Top 3");
  assert.equal(h.sent[0].currentBallId, null);
});

test("Top 3 is a single accessible choice and defaults to keeping the current ball", async () => {
  const catalogBall = golfBallCatalog.find((ball) => ball.active)!;
  const currentBall: equipment.PlayerBall = {
    id: "current-player-ball", userId: "flow-owner", catalogBallId: catalogBall.id,
    ballBrand: catalogBall.brand, ballModel: catalogBall.model, generation: catalogBall.generation,
    year: catalogBall.year, color: null, notes: null, isCurrent: true,
    startedUsingAt: "2026-09-29T12:00:00.000Z", stoppedUsingAt: null,
    createdAt: "2026-09-29T12:00:00.000Z", updatedAt: "2026-09-29T12:00:00.000Z",
  };
  const keep = wizard(null, null, undefined, undefined, currentBall);
  for (let index = 0; index < 5; index++) await keep.click("Siguiente →");
  await keep.click("Ver mi Top 3");
  assert.deepEqual(keep.checkedRadios(), ["Conservar mi bola actual"]);
  assert.equal(keep.radioLabels().filter((label) => label.startsWith("Elegir ")).length, 3);
  await keep.click("Guardar elección y terminar");
  assert.equal((keep.savedChoices[0] as { action: string }).action, "KEEP_CURRENT");

  const recommendation = wizard(null, null, undefined, undefined, currentBall);
  for (let index = 0; index < 5; index++) await recommendation.click("Siguiente →");
  await recommendation.click("Ver mi Top 3");
  const recommendationLabel = recommendation.radioLabels().find((label) => label.startsWith("Elegir "))!;
  recommendation.selectRadio(recommendationLabel);
  assert.deepEqual(recommendation.checkedRadios(), [recommendationLabel]);
  await recommendation.click("Guardar elección y terminar");
  assert.equal((recommendation.savedChoices[0] as { action: string }).action, "RECOMMENDATION");
});

test("a fitting without a current ball keeps the existing optional finish behavior", async () => {
  const h = wizard(null, null);
  for (let index = 0; index < 5; index++) await h.click("Siguiente →");
  await h.click("Ver mi Top 3");
  assert.deepEqual(h.checkedRadios(), []);
  assert.doesNotMatch(h.text(), /Conservar mi bola actual/);
  await h.click("Guardar elección y terminar");
  assert.equal(h.savedChoices[0], null);
});
