import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("continuar sin índice persists an explicit resolution and advances in one action", () => {
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  const choices = source("app/components/handicap-source-selector.tsx");
  assert.match(choices, /onContinueWithoutIndex/);
  assert.match(onboarding, /await indexControl\.change\(false\)/);
  assert.match(onboarding, /handicap_choice: "UNKNOWN", manual_hcp: null/);
  assert.match(onboarding, /delegated = continueFlow\(\)/);
  assert.match(onboarding, /sourceChosen \? <button/);
  assert.doesNotMatch(onboarding, /defaultHandicap:\s*0/);
});

test("betting consent is contextual and score-only stays free of betting UI", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  const provider = source("app/components/account-provider.tsx");
  const page = source("app/page.tsx");
  assert.doesNotMatch(consent, /FUNCIONES DE APUESTAS|ACTIVAR APUESTAS|onResolveBetting/);
  assert.doesNotMatch(provider, /initialBettingDecision=|onResolveBetting=/);
  assert.match(page, /const runAfterBettingConsent/);
  assert.match(page, /roundPresentation\.playMode !== "score_only"/);
  assert.match(page, /scoreOnly=\{roundPresentation\.playMode === "score_only"\}/);
});

test("profile progress is actionable, optional-aware and removes No aplica", () => {
  const ring = source("app/components/profile-completion-ring.tsx");
  const panel = source("app/components/profile-account-panel.tsx");
  const page = source("app/page.tsx");
  assert.match(ring, /Completa tu perfil/);
  assert.match(ring, /percent !== 100/);
  assert.match(ring, /onOpen\(section\.id\)/);
  assert.doesNotMatch(ring, /No aplica|mismo peso|not_applicable/);
  for (const target of ["equipment", "ball", "fitting"]) assert.match(panel, new RegExp(`completionTarget === "${target}"`));
  assert.match(panel, /setCompletionEditTarget\(completionTarget\)/);
  assert.match(page, /setProfileCompletionTarget\(section\)/);
});

test("equipment and Ball Fit use neutral category visuals with selected and empty states", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const panel = source("app/components/equipment-profile-panel.tsx");
  const wizard = source("app/components/ball-fit-wizard.tsx");
  const visuals = source("app/components/equipment-visuals.tsx");
  for (const category of ["Driver", "Maderas", "Híbridos", "Hierros", "Wedges", "Putter"]) assert.match(onboarding, new RegExp(category));
  assert.match(onboarding, /ClubCategoryVisual/);
  assert.match(panel, /ClubCategoryVisual/);
  assert.match(wizard, /GolfBallVisual/);
  for (const priority of ["Distancia", "Control", "Sensación"]) assert.match(wizard, new RegExp(priority));
  assert.match(visuals, /Neutral product silhouettes/);
  assert.doesNotMatch(visuals, /Titleist|Callaway|TaylorMade|PING/);
});

test("launch-monitor capture explains the block first and auto-applies clear readings", () => {
  const camera = source("app/components/launch-monitor-camera.tsx");
  const capture = source("app/components/launch-monitor-capture.tsx");
  assert.match(camera, /CAPTURA ACTUAL/);
  assert.match(camera, /Después sigue/);
  assert.match(camera, /detected\.every/);
  assert.match(camera, /onConfirm\(assigned\.source, detected\)/);
  assert.match(camera, /Corrige sólo lo necesario/);
  assert.match(camera, /Editar datos detectados/);
  assert.match(capture, /setActiveClub\(nextProtocolClub/);
  assert.match(capture, /updateShotMetric/);
  assert.match(capture, /Excluir/);
  assert.doesNotMatch(capture, /Guardar golpe|Guardar captura parcial/);
  assert.doesNotMatch(camera, /Revisa antes de guardar/);
});

test("catalog requests share the central feedback dialog with their category selected", () => {
  const page = source("app/page.tsx");
  const editors = source("app/components/equipment-editors.tsx");
  const ballFit = source("app/components/ball-fit-wizard.tsx");
  const feedback = source("app/components/feedback-dialog.tsx");
  assert.match(page, /<FeedbackDialog/);
  assert.match(page, /requestFeedback\("COURSE"/);
  assert.match(page, /requestFeedback\("TEE"/);
  for (const category of ["CLUB", "SHAFT", "BALL"]) assert.match(editors, new RegExp(`FeedbackLink category="${category}"`));
  assert.match(ballFit, /FeedbackLink category="BALL"/);
  assert.match(feedback, /setForm\(v=>\(\{\.\.\.v,\.\.\.prefill,category/);
  assert.match(feedback, /window\.dispatchEvent\(new CustomEvent\('backyard:feedback'/);
});

test("legal and application links have real destinations and no placeholder href", () => {
  const tsxFiles = filesBelow("app").filter((path) => path.endsWith(".tsx"));
  const application = tsxFiles.map(source).join("\n");
  assert.doesNotMatch(application, /href\s*=\s*["']#["']/);
  assert.match(application, /href="\/legal\/terms\?returnTo=/);
  assert.match(application, /href="\/legal\/privacy\?returnTo=/);
});

test("mobile CTAs reserve the iPhone safe area", () => {
  const equipmentCss = source("app/components/equipment.module.css");
  const completionCss = source("app/components/profile-completion-ring.module.css");
  assert.match(equipmentCss, /env\(safe-area-inset-bottom\)/);
  assert.match(equipmentCss, /@media\(max-width:540px\)/);
  assert.match(completionCss, /env\(safe-area-inset-bottom\)/);
});
