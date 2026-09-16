import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as privacy from "../lib/backyard-ai/privacy";
import * as security from "../lib/backyard-ai/server/http-security";
import * as photoRequest from "../lib/backyard-ai/server/scorecard-request";
import * as handicapSource from "../lib/handicap-source";

type Node = { type: unknown; props: Record<string, unknown> };
type Handler = (...args: unknown[]) => unknown;
const draft = { ownerId: "qa-user", players: [], personalBets: [], date: "2026-09-15" };
const PROVIDER = "AI_PROVIDER_PROCESSING_CONSENT";
const IMAGE = "AI_IMAGE_PROCESSING_CONSENT";
const LAUNCH = "AI_LAUNCH_MONITOR_PROCESSING_CONSENT";
const flush = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };

/** Executes the actual TSX handlers and state transitions. Only React's host
 * renderer and remote/browser boundaries are replaced; no copied feature logic. */
function featureHarness(file: string, options: { active?: boolean; remoteError?: boolean; guest?: boolean } = {}) {
  let cursor = 0;
  const slots: unknown[] = [];
  const effects: (() => unknown)[] = [];
  let checks = 0;
  const checkedScopes: string[] = [];
  let providerCalls = 0;
  let microphoneStarts = 0;
  let acceptances = 0;
  let revoked = false;
  const prompts = { AiProcessingConsentPrompt: "ConsentPrompt", AiProcessingConsentRequired: "ConsentRequired" };
  const state = (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: unknown) => {
      slots[index] = typeof next === "function" ? next(slots[index]) : next;
    }];
  };
  const react = {
    useState: state,
    useRef: (initial: unknown) => state({ current: initial })[0],
    useMemo: (calculate: () => unknown) => calculate(),
    useCallback: (fn: unknown) => fn,
    useEffect: (effect: () => unknown) => { effects.push(effect); },
    useLayoutEffect: (effect: () => unknown) => { effects.push(effect); },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const remote = () => ({
    active: Boolean(options.active && !revoked), discarded: false, pendingLocalRevocation: false,
    cachePersisted: true, acceptedAt: options.active ? "2026-09-15T12:00:00Z" : null,
    consent: options.active ? { userId: "qa-user", scope: PROVIDER, acceptedAt: "2026-09-15T12:00:00Z", revokedAt: null } : null,
  });
  const deps: Record<string, unknown> = {
    "react": react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/link": { default: "a" },
    "../modal-shell": { ModalCloseButton: "Close" },
    "./ai-processing-consent": prompts,
    "./backyard-ai/ai-processing-consent": { ...prompts, AiProcessingConsentSettings: "AiConsentSettings" },
    "./account-provider": { useBackyardAccount: () => ({ identity: {
      userId: "qa-user", displayName: "QA", mode: "authenticated", accessToken: "qa-token", defaultHandicap: 0,
    } }) },
    "account-state": { profileHandicapInput: () => "0" },
    "profile-geography": { normalizeProfileLocation: () => ({}) },
    "handicap-source": handicapSource,
    "./ai-round-review": { AiRoundReview: "Review" },
    "./scorecard-correction": { ScorecardCorrection: "Correction" },
    "./backyard-ai.module.css": { default: {} },
    "./ai-processing-consent.module.css": { default: {} },
    "./equipment.module.css": { default: {} },
    "consent-client": {
      RemoteAiProcessingConsentError: class extends Error {},
      resolveAuthoritativeAiProcessingConsent: async (input: { scope: string }) => {
        checks++;
        checkedScopes.push(input.scope);
        if (options.remoteError) throw new Error("unavailable");
        return remote();
      },
      beginAiProcessingConsentMutation: () => undefined,
      acceptRemoteAiProcessingConsent: async (_token: string, _owner: string, scope: string) => {
        acceptances++;
        return { active: true, scope, acceptedAt: "2026-09-15T12:00:00Z", revokedAt: null };
      },
      revokeRemoteAiProcessingConsent: async () => {
        revoked = true;
        return { active: false, revokedAt: "2026-09-15T13:00:00Z" };
      },
    },
    "processing-consent": {
      browserAiProcessingConsentStorage: () => ({}),
      hasActiveAiProcessingConsent: () => false,
      AI_PROCESSING_CONSENT_UPDATED_EVENT: "consent-updated",
      aiProcessingConsentAllowsTransport: (value: { accountPersisted: boolean; localPersisted: boolean }) => value.accountPersisted || value.localPersisted,
      readAiProcessingConsent: () => null,
      acceptAiProcessingConsent: (_storage: unknown, userId: string, scope: string, acceptedAt: string) => ({ ok: true, persisted: true, consent: { userId, scope, acceptedAt, revokedAt: null } }),
      revokeAiProcessingConsent: () => ({ ok: true }),
      acknowledgeRemoteAiProcessingConsentRevocation: () => ({ ok: true }),
    },
    "privacy": { AI_PROVIDER_PROCESSING_CONSENT: PROVIDER, AI_IMAGE_PROCESSING_CONSENT: IMAGE, AI_LAUNCH_MONITOR_PROCESSING_CONSENT: LAUNCH, BACKYARD_AI_PROVIDER_CONSENT_VERSION: "v1", backyardAiProviderConsent: () => ({ accepted: true }) },
    "client-api": { requestBackyardAi: async () => { providerCalls++; return { canonicalCommand: "Jugamos Said", confidence: 1, clarification: null, extraction: {}, summary: "QA", observations: [], answer: "QA" }; } },
    "learning-events": { readLearningConsent: () => ({ consent: { personalMemoryEnabled: false } }) },
    "clarification": { parseUnknownPlayerClarification: () => null },
    "answer-command": { roundSetupAnswerCommand: (_q: unknown, input: string) => input },
    "canonical-command-guard": { validateCanonicalRoundCommand: (_input: string, command: string) => ({ ok: true, command }) },
    "round-setup": { planRoundSetup: () => ({ draft, questions: [], memory: [], configurationIssues: [], canConfirm: true, interpretation: { confidence: 1 } }) },
    "personal-modes": { frequentPersonalSuggestions: () => [] },
    "speech-dictation": { speechRecognitionConstructor: () => function Recognition() {}, createDictationSession: () => ({ start: () => { microphoneStarts++; }, dispose: () => undefined }) },
    "limits": { MAX_SCORECARD_PHOTOS: 4 },
    "live-questions": { classifyLiveQuestion: () => "score", liveQuestionFacts: () => ({}) },
    "client": { MAX_LAUNCH_MONITOR_PHOTOS: 4, prepareLaunchMonitorPhotos: async () => [], recordProductEvent: async () => undefined },
    "domain": { buildGolfTrends: () => [] },
    "insights": { structuredGolfInsightInput: () => ({ sampleRounds: 1 }) },
    "launch-monitor": { normalizeLaunchMonitorVisionExtraction: () => ({ shots: [] }) },
    "client-pipeline": {
      runScorecardPhotoAnalysis: async (_photos: unknown, _owner: string, input: { analyze: (transport: unknown[]) => Promise<unknown> }) => ({
        response: await input.analyze([]), persistence: Promise.resolve({ failedPhotoIds: [] }), preparationFailures: [], preparedPhotoIds: [],
      }),
      scorecardScanErrorMessage: () => "No pudimos leer la foto.",
      ScorecardClientPipelineError: Error,
    },
    "extractor": { normalizeScorecardExtraction: () => ({ ok: true, extraction: { sourceIds: [] } }) },
    "validator": { validateScorecardExtraction: () => ({ ready: false, issues: [], acceptedCells: [] }) },
    "scorecard-photo": { deleteStaleTemporaryScorecardPhotos: async () => undefined },
  };
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  runInNewContext(compiled, {
    exports, console, Date, Intl, AbortController, DOMException, crypto: { randomUUID: () => "qa-id" },
    performance: { now: () => 0 },
    window: { addEventListener: () => undefined, removeEventListener: () => undefined, requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined },
    URL: { createObjectURL: () => "blob:qa", revokeObjectURL: () => undefined },
    require: (id: string) => deps[id] ?? deps[id.split("/").at(-1)!] ?? {},
  });
  const props: Record<string, unknown> = {
    initialDraft: draft, memoryContext: { profile: { userId: "qa-user" } },
    accessToken: options.guest ? undefined : "qa-token", requiresRemoteConsent: !options.guest,
    storageOwnerId: "qa-user", userId: "qa-user",
    consentOwnerId: "qa-user", scoreboard: { status: "ACTIVE" },
    insights: { scoredRounds: 1, scoreScopeHoles: 18, scoreCohorts: { 18: { recentRounds: [], holeCount: 18, rounds: 1 } }, advancedRounds: 0 },
    round: { roundId: "qa-round", players: [], roundHoles: 18, startHole: 1, course: { name: "QA" } },
    onConfirm: () => undefined, onManualEdit: () => undefined, onCancel: () => undefined,
  };
  return {
    props,
    render: (name: string) => { cursor = 0; effects.length = 0; return exports[name](props); },
    effects: async () => { effects.splice(0).forEach(effect => effect()); await flush(); },
    checks: () => checks, checkedScopes, providerCalls: () => providerCalls,
    microphoneStarts: () => microphoneStarts, acceptances: () => acceptances,
  };
}

function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  const node = tree as Node;
  return [node, ...nodes(node.props?.children)];
}
const find = (tree: Node, predicate: (node: Node) => boolean) => {
  const node = nodes(tree).find(predicate);
  assert.ok(node, "Expected UI node must exist");
  return node;
};
const invoke = (node: Node, prop: string, ...args: unknown[]) => (node.props[prop] as Handler)(...args);
const file = (name: string) => `app/components/backyard-ai/${name}.tsx`;

for (const active of [false, true]) {
  test(`authenticated AI instructions: server active=${active}, no feature acceptance popup`, async () => {
    const h = featureHarness(file("ai-round-setup"), { active });
    let tree = h.render("AiRoundSetup");
    invoke(find(tree, node => node.type === "textarea"), "onChange", { target: { value: "Jugamos Said" } });
    tree = h.render("AiRoundSetup");
    invoke(find(tree, node => node.type === "button" && node.props.children === "Preparar mi ronda"), "onClick");
    await flush();
    tree = h.render("AiRoundSetup");
    assert.equal(h.checks(), 1);
    assert.equal(h.providerCalls(), active ? 1 : 0);
    assert.equal(nodes(tree).some(node => node.type === "ConsentPrompt"), false);
    assert.equal(nodes(tree).some(node => node.type === "ConsentRequired"), !active);
  });
}

test("guest instructions retain explicit consent rather than inherit account authorization", async () => {
  const h = featureHarness(file("ai-round-setup"), { guest: true });
  invoke(find(h.render("AiRoundSetup"), node => node.type === "textarea"), "onChange", { target: { value: "Jugamos Said" } });
  invoke(find(h.render("AiRoundSetup"), node => node.type === "button" && node.props.children === "Preparar mi ronda"), "onClick");
  await flush();
  assert.ok(nodes(h.render("AiRoundSetup")).some(node => node.type === "ConsentPrompt"));
  assert.equal(h.providerCalls(), 0);
});

for (const outcome of ["authorized", "declined", "unavailable"] as const) {
  test(`scorecard ${outcome}: server checked and no account popup`, async () => {
    const h = featureHarness(file("scorecard-scanner"), { active: outcome === "authorized", remoteError: outcome === "unavailable" });
    invoke(find(h.render("ScorecardScanner"), node => node.type === "input" && node.props.type === "file"), "onChange", {
      target: { files: [{ type: "image/jpeg" }], value: "qa-photo.jpg" },
    });
    invoke(find(h.render("ScorecardScanner"), node => node.type === "button" && node.props.children === "ESCANEAR TARJETA"), "onClick");
    await flush();
    const tree = h.render("ScorecardScanner");
    assert.equal(h.checks(), 1);
    assert.equal(h.providerCalls(), outcome === "authorized" ? 1 : 0);
    assert.equal(nodes(tree).some(node => node.type === "ConsentPrompt"), false);
    assert.equal(nodes(tree).some(node => node.type === "ConsentRequired"), outcome === "declined");
  });
}

test("revoked instructions block dictation before the speech service or microphone starts", async () => {
  const h = featureHarness(file("ai-round-setup"), { active: false });
  invoke(find(h.render("AiRoundSetup"), node => node.type === "button" && node.props.children === "🎙 Hablar"), "onClick");
  await flush();
  assert.equal(h.checks(), 1);
  assert.equal(h.microphoneStarts(), 0);
  assert.ok(nodes(h.render("AiRoundSetup")).some(node => node.type === "ConsentRequired"));
});

test("rapid double dictation tap verifies once and opens one speech session", async () => {
  const h = featureHarness(file("ai-round-setup"), { active: true });
  const button = find(h.render("AiRoundSetup"), node => node.type === "button" && node.props.children === "🎙 Hablar");
  invoke(button, "onClick");
  invoke(button, "onClick");
  await flush();
  assert.equal(h.checks(), 1);
  assert.equal(h.microphoneStarts(), 1);
});

test("settings load server decisions, render both statuses and offer explicit reauthorization", async () => {
  const h = featureHarness(file("ai-processing-consent"), { active: false });
  h.render("AiProcessingConsentSettings");
  await h.effects();
  let tree = h.render("AiProcessingConsentSettings");
  assert.equal(h.checks(), 3);
  assert.equal(nodes(tree).filter(node => node.type === "b" && node.props.children === "DESACTIVADO").length, 3);
  assert.ok(nodes(tree).some(node => node.props.children === "Instrucciones Backyard AI"));
  assert.ok(nodes(tree).some(node => node.props.children === "Lectura de scorecards"));
  assert.ok(nodes(tree).some(node => node.props.children === "Lectura de datos de práctica"));
  invoke(find(tree, node => node.type === "button" && node.props.children === "Autorizar"), "onClick");
  tree = h.render("AiProcessingConsentSettings");
  assert.ok(nodes(tree).some(node => typeof node.type === "function" && (node.type as { name: string }).name === "AiProcessingConsentPrompt"));
  assert.equal(h.acceptances(), 0, "opening settings or a prompt is never acceptance");
});

test("settings authorization remains unchecked and requires an affirmative action before POST", async () => {
  const h = featureHarness(file("ai-processing-consent"), { active: false });
  h.props.scope = PROVIDER;
  let accepted = false;
  h.props.onAccepted = () => { accepted = true; };
  h.render("AiProcessingConsentPrompt");
  await h.effects();
  let tree = h.render("AiProcessingConsentPrompt");
  const checkbox = find(tree, node => node.type === "input" && node.props.type === "checkbox");
  assert.equal(checkbox.props.checked, false);
  let submit = find(tree, node => node.type === "button" && node.props.children === "Aceptar y continuar");
  assert.equal(submit.props.disabled, true);
  invoke(submit, "onClick");
  await flush();
  assert.equal(h.acceptances(), 0);
  invoke(checkbox, "onChange", { target: { checked: true } });
  tree = h.render("AiProcessingConsentPrompt");
  submit = find(tree, node => node.type === "button" && node.props.children === "Aceptar y continuar");
  assert.equal(submit.props.disabled, false);
  invoke(submit, "onClick");
  await flush();
  assert.equal(h.acceptances(), 1);
  assert.equal(accepted, true);
});

test("feature privacy navigation opens the compact AI settings directly and consumes its intent", async () => {
  const h = featureHarness("app/components/profile-account-panel.tsx");
  h.props.view = "account";
  h.props.openAiPrivacySettings = true;
  h.props.indexControl = { preference: null, ready: true, saving: false, error: "" };
  let consumed = 0;
  h.props.onAiPrivacyOpened = () => { consumed++; h.props.openAiPrivacySettings = false; };
  let tree = h.render("ProfileAccountPanel");
  assert.ok(nodes(tree).some(node => node.type === "AiConsentSettings"));
  assert.ok(nodes(tree).some(node => node.type === "button" && node.props.children === "← Cuenta y privacidad"));
  await h.effects();
  assert.equal(consumed, 1);
  tree = h.render("ProfileAccountPanel");
  await h.effects();
  assert.equal(consumed, 1, "normal account navigation must not reuse an old privacy intent");
  assert.ok(nodes(tree).some(node => node.type === "AiConsentSettings"));
});

for (const feature of [
  { component: "LiveRoundQuestion", path: "live-round-question", label: "¿Cómo voy?" },
  { component: "StatsDashboard", path: "stats-dashboard", label: "Explicar mi juego" },
]) {
  for (const active of [true, false]) {
    test(`${feature.component}: empty local cache uses current server consent active=${active}`, async () => {
      const h = featureHarness(`app/components/${feature.path}.tsx`, { active });
      invoke(find(h.render(feature.component), node => node.type === "button" && node.props.children === feature.label), "onClick");
      await flush();
      assert.equal(h.checks(), 1);
      assert.equal(h.providerCalls(), active ? 1 : 0);
      assert.equal(nodes(h.render(feature.component)).some(node => node.type === "ConsentPrompt"), false);
    });
  }
  test(`${feature.component}: missing account token never falls back to guest consent`, async () => {
    const h = featureHarness(`app/components/${feature.path}.tsx`, { active: true });
    h.props.accessToken = null;
    invoke(find(h.render(feature.component), node => node.type === "button" && node.props.children === feature.label), "onClick");
    await flush();
    assert.equal(h.checks(), 0);
    assert.equal(h.providerCalls(), 0);
  });
}

for (const active of [true, false]) {
  test(`launch-monitor camera checks its own purpose active=${active}, never scorecard consent`, async () => {
    const h = featureHarness("app/components/launch-monitor-camera.tsx", { active });
    const input = find(h.render("LaunchMonitorCamera"), node => node.type === "input" && node.props.type === "file");
    invoke(input, "onChange", { target: { files: [{ type: "image/jpeg" }, { type: "image/jpeg" }] }, currentTarget: { value: "photo.jpg" } });
    invoke(find(h.render("LaunchMonitorCamera"), node => node.type === "button" && node.props.children === "Analizar fotos"), "onClick");
    await flush();
    assert.deepEqual(h.checkedScopes, [LAUNCH]);
    assert.equal(h.providerCalls(), active ? 1 : 0);
    const tree = h.render("LaunchMonitorCamera");
    assert.equal(nodes(tree).some(node => node.type === "ConsentPrompt"), false);
    assert.equal(nodes(tree).some(node => node.type === "ConsentRequired"), !active);
  });
}

test("launch-monitor endpoint rejects scorecard consent before touching the provider or ledger", async () => {
  const compiled = ts.transpileModule(readFileSync("app/api/backyard-ai/launch-monitor/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const verifiedScopes: string[] = [];
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  runInNewContext(compiled, {
    exports, process: { env: {} },
    require: (id: string) => {
      if (id === "next/server") return { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } };
      if (id.endsWith("/privacy")) return privacy;
      if (id.endsWith("/http-security")) return security;
      if (id.endsWith("/scorecard-request")) return photoRequest;
      if (id.endsWith("/config")) return { backyardAiConfig: () => ({ enabled: true, configured: true }) };
      if (id.endsWith("/processing-consent")) return { verifyStoredAiProcessingConsent: async (_request: Request, scope: string) => {
        verifiedScopes.push(scope);
        return { ok: false, status: 403, code: "consent_required", error: "Not authorized" };
      } };
      return {};
    },
  });
  assert.ok(exports.POST);
  const request = (scope: privacy.BackyardAiProcessingConsentScope) => new Request("https://preview.invalid/api/backyard-ai/launch-monitor", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer qa-token" },
    body: JSON.stringify({ photos: [], consent: privacy.backyardAiProviderConsent(scope) }),
  });
  const scorecardOnly = await exports.POST(request(privacy.AI_IMAGE_PROCESSING_CONSENT));
  assert.equal(scorecardOnly.status, 403);
  assert.deepEqual(verifiedScopes, [], "a scorecard grant cannot reach launch-monitor authorization");
  const ownPurpose = await exports.POST(request(privacy.AI_LAUNCH_MONITOR_PROCESSING_CONSENT));
  assert.equal(ownPurpose.status, 403, "even the correct client assertion still requires stored server acceptance");
  assert.deepEqual(verifiedScopes, [LAUNCH]);
});
