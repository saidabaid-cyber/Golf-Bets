import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("all owned product visuals layer the exact approved Backyard master mark", () => {
  const mark = source("app/components/backyard-mark.tsx");
  const visuals = source("app/components/equipment-visuals.tsx");
  const css = source("app/components/equipment-visuals.module.css");

  assert.match(mark, /href="\/brand\/the-backyard-logo\.svg"/);
  assert.match(mark, /viewBox="375 255 340 455"/);
  assert.doesNotMatch(mark, /<path\b/);
  assert.match(visuals, /<BackyardMark className=\{styles\.clubBrandMark\}/);
  assert.match(visuals, /<BackyardMark className=\{styles\.ballBrandMark\}/);
  assert.match(visuals, /THE BACKYARD/);
  assert.match(css, /data-club-category="DRIVER"/);
  assert.match(css, /data-club-category="FAIRWAY_WOOD"/);
  assert.match(css, /data-club-category="HYBRID"/);
  assert.match(css, /data-club-category="IRON_SET"/);
  assert.match(css, /data-club-category="WEDGE"/);
  assert.match(css, /data-club-category="PUTTER"/);

  for (const asset of ["driver", "fairway", "hybrid", "irons", "wedge", "putter", "ball"]) {
    const file = join("public", "brand", "equipment", `backyard-${asset}-clean.png`);
    assert.ok(statSync(file).size > 500_000, `${file} must be a production transparent product asset`);
    assert.match(visuals, new RegExp(`backyard-${asset}-clean\\.png`));
  }
});

test("Mi Bolsa keeps approved product media while permanent management stays compact", () => {
  const panel = source("app/components/equipment-profile-panel.tsx");
  const css = source("app/components/equipment.module.css");

  assert.match(panel, /EN MI BOLSA/);
  assert.match(panel, /AGREGAR EQUIPO/);
  assert.match(panel, /bagManagement\.missing/);
  assert.doesNotMatch(panel, /className=\{styles\.emptyBagCopy\}/);
  assert.doesNotMatch(panel, /Tu juego empieza<br \/>en tu bolsa/);
  assert.match(css, /\.bagItemMain \{ display:grid;grid-template-columns:156px/);
  assert.match(css, /backyard-fairway-scene\.svg/);
});

test("GHIN has the official lockup, live action and an unclipped document-level dialog", () => {
  const selector = source("app/components/handicap-source-selector.tsx");
  const panel = source("app/components/ghin-read-only-panel.tsx");
  const modal = source("app/components/modal-shell.tsx");
  const selectorCss = source("app/components/handicap-source-selector.module.css");

  assert.match(selector, /ghin-logotype\.png/);
  assert.match(selector, /A USGA SERVICE/);
  assert.match(selector, /<GhinReadOnlyPanel control=\{ghinControl\}/);
  assert.match(panel, /onClick=\{\(\) => setAuthMode\("link"\)\}/);
  assert.match(panel, /<ModalShell open=\{authMode !== null\}/);
  assert.match(panel, /Email o número GHIN/);
  assert.match(panel, /Contraseña GHIN/);
  assert.match(modal, /createPortal\(/);
  assert.match(modal, /document\.body/);
  assert.match(selectorCss, /\.ghinMark small/);
});

test("no-index remains one action that persists null and advances", () => {
  const selector = source("app/components/handicap-source-selector.tsx");
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  assert.match(selector, /onContinueWithoutIndex \? onContinueWithoutIndex\(\) : control\.change\(false\)/);
  assert.match(onboarding, /await indexControl\.change\(false\)/);
  assert.match(onboarding, /handicap_choice: "UNKNOWN", manual_hcp: null/);
  assert.match(onboarding, /delegated = continueFlow\(\)/);
  assert.doesNotMatch(onboarding, /defaultHandicap:\s*0/);
});
