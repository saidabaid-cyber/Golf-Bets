import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("onboarding requires one of the two final index sources", () => {
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  const choices = source("app/components/handicap-source-selector.tsx");
  assert.doesNotMatch(choices, /onContinueWithoutIndex|CONTINUAR SIN ÍNDICE|data-handicap-source="NONE"/);
  assert.doesNotMatch(onboarding, /await indexControl\.change\(false\)|handicap_choice: "UNKNOWN"|continuar sin índice/i);
  assert.match(onboarding, /delegated = continueFlow\(\)/);
  assert.match(onboarding, /sourceChosen \? <button/);
  assert.match(onboarding, /Elige GHIN o Backyard Index para continuar/);
  assert.doesNotMatch(onboarding, /defaultHandicap:\s*0/);
});

test("betting consent is contextual and score-only stays free of betting UI", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  const provider = source("app/components/account-provider.tsx");
  const page = source("app/page.tsx");
  assert.doesNotMatch(consent, /FUNCIONES DE APUESTAS|ACTIVAR APUESTAS|onResolveBetting/);
  assert.doesNotMatch(consent, /apuestas/i);
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
  const completion = source("lib/profile-completion.ts");
  const route = source("app/api/account/completion/route.ts");
  assert.match(completion, /input\.indexValue/);
  assert.match(route, /player_handicap_provider_profiles/);
  assert.match(route, /indexValue:/);
});

test("equipment and Ball Fit use owned premium product art with selected and empty states", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const categoryAssets = source("app/components/equipment-category-assets.ts");
  const panel = source("app/components/equipment-profile-panel.tsx");
  const wizard = source("app/components/ball-fit-wizard.tsx");
  const visuals = source("app/components/equipment-visuals.tsx");
  const equipmentCss = source("app/components/equipment.module.css");
  for (const category of ["Driver", "Maderas", "Híbridos", "Hierros", "Wedges", "Putter"]) assert.match(onboarding, new RegExp(category));
  assert.match(categoryAssets, /onboarding-ref-b\/driver_ref_b\.png/);
  assert.match(onboarding, /EQUIPMENT_CATEGORY_ASSETS/);
  assert.doesNotMatch(onboarding, /ClubCategoryVisual/);
  assert.match(onboarding, /Máxima distancia y confianza/);
  assert.match(panel, /ClubCategoryVisual/);
  assert.match(wizard, /GolfBallVisual/);
  for (const priority of ["Distancia", "Control", "Sensación"]) assert.match(wizard, new RegExp(priority));
  assert.match(visuals, /from "next\/image"/);
  for (const asset of ["backyard-driver-clean.png", "backyard-fairway-clean.png", "backyard-hybrid-clean.png", "backyard-irons-clean.png", "backyard-wedge-clean.png", "backyard-putter-clean.png", "backyard-ball-clean.png"]) {
    assert.ok(statSync(join("public", "brand", "equipment", asset)).size > 50_000, `${asset} must contain production artwork`);
    assert.match(visuals, new RegExp(asset.replace(".", "\\.")));
  }
  assert.ok(statSync(join("public", "brand", "onboarding-course-hero.png")).size > 50_000);
  assert.match(equipmentCss, /onboarding-course-hero\.png/);
  assert.match(equipmentCss, /backyard-fairway-scene\.svg/);
  assert.doesNotMatch(visuals, /Titleist|Callaway|TaylorMade|PING/);
});

test("focus areas are multi-select cards with category-specific iconography", () => {
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  const icons = source("app/components/backyard-icon.tsx");
  const css = source("app/components/beta-onboarding-flow.module.css");
  for (const goal of ["DRIVER", "IRONS", "APPROACH", "SHORT_GAME", "BUNKER", "PUTTING", "CONSISTENCY", "COURSE_STRATEGY", "MENTAL_CONFIDENCE", "LOWER_HANDICAP"]) {
    assert.match(onboarding, new RegExp(`${goal}:`));
  }
  assert.match(onboarding, /BUNKER: "bunker"/);
  assert.match(onboarding, /data-focus-area=\{goal\}/);
  assert.match(onboarding, /aria-pressed=\{active\}/);
  assert.match(onboarding, /\{active \? "✓" : ""\}/);
  assert.match(icons, /bunker:/);
  assert.match(icons, /mental:/);
  for (const icon of ["driver", "irons", "approach", "shortGame", "bunker", "putting", "consistency", "strategy", "mental", "handicap"]) assert.match(icons, new RegExp(`${icon}:`));
  const mapping = onboarding.match(/const IMPROVEMENT_ICONS[\s\S]*?= \{([\s\S]*?)\};/)?.[1] || "";
  const assignedIcons = [...mapping.matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(assignedIcons.length, 10);
  assert.equal(new Set(assignedIcons).size, 10, "cada categoría conserva un icono propio");
  assert.match(css, /grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /onboarding-course-hero\.png/);
});

test("Ball Fit priorities use nine literal and non-repeated icons", () => {
  const wizard = source("app/components/ball-fit-wizard.tsx");
  const icons = source("app/components/backyard-icon.tsx");
  const expected = {
    DRIVER_DISTANCE: "driverDistance",
    LESS_DRIVER_SPIN: "lessDriverSpin",
    STABILITY_CONTROL: "stabilityControl",
    HEIGHT: "trajectoryHeight",
    IRON_CONTROL: "ironControl",
    STOP_ON_GREEN: "stopOnGreen",
    WEDGE_SPIN: "wedgeSpin",
    GREENSIDE_FEEL: "greensideFeel",
    PUTTER_FEEL: "putterFeel",
  } as const;
  for (const [priority, icon] of Object.entries(expected)) {
    assert.match(wizard, new RegExp(`${priority}: "${icon}"`));
    assert.match(icons, new RegExp(`${icon}:`));
  }
  assert.equal(new Set(Object.values(expected)).size, 9);
});

test("index selection presents GHIN and Backyard as branded product choices", () => {
  const choices = source("app/components/handicap-source-selector.tsx");
  const css = source("app/components/handicap-source-selector.module.css");
  assert.match(choices, /ghin-logotype\.png/);
  assert.match(choices, /Sincroniza tu Handicap Index/);
  assert.match(choices, /BackyardMark/);
  assert.ok(statSync(join("public", "brand", "ghin-logotype.png")).size > 10_000);
  assert.match(css, /\.ghinMark img/);
  assert.match(css, /data-onboarding-step="ghin"/);
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
  const orderedStages = [1, 2, 3, 4, 5].map((step) => capture.indexOf(`data-capture-order="${step}"`));
  assert.ok(orderedStages.every((position, index) => position >= 0 && (index === 0 || position > orderedStages[index - 1])), "el flujo conserva los cinco pasos en orden");
  assert.match(capture, /Selecciona tu palo/);
  assert.match(capture, /Pitching Wedge/);
  assert.match(capture, /Half Wedge \/ Approach/);
  assert.match(capture, /ClubCategoryVisual/);
  assert.equal((capture.match(/showBranding=\{false\}/g) || []).length, 2, "selector y resumen usan cutouts limpios");
  assert.match(capture, /Análisis automático/);
  assert.match(capture, /Mediciones aplicadas/);
  assert.match(capture, /\["carryYards", "ballSpeedMph", "launchAngleDegrees", "spinRpm"\]/);
  assert.match(capture, /updateShotMetric/);
  assert.match(capture, /Excluir/);
  assert.match(capture, /Capturar datos manualmente/);
  assert.match(capture, /shotDetailsOpen/);
  assert.match(capture, /Guardar y continuar/);
  assert.match(capture, /data-capture-order="5"[\s\S]*disabled=\{!onDone \|\| includedShots === 0\}/);
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
  assert.match(equipmentCss, /\.clubChoiceGrid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(completionCss, /env\(safe-area-inset-bottom\)/);
});
