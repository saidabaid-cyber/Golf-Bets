import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("Construye tu bolsa uses the canonical master logo over six clean product assets", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const visuals = source("app/components/equipment-visuals.tsx");
  const brandReadme = source("public/brand/README.md");

  assert.match(brandReadme, /the-backyard-logo\.svg[\s\S]*primera opción/);
  assert.match(visuals, /src="\/brand\/the-backyard-logo\.svg"/);
  assert.match(onboarding, /<ClubCategoryVisual category=\{category\} className=\{styles\.visualClubProduct\} useMasterBrand \/>/);
  assert.doesNotMatch(onboarding, /backyard-(?:driver|fairway|hybrid|irons|wedge|putter)-card\.png/);

  for (const asset of ["driver", "fairway", "hybrid", "irons", "wedge", "putter"]) {
    const file = join("public", "brand", "equipment", `backyard-${asset}-clean.png`);
    assert.ok(statSync(file).size > 500_000, `${file} must be a high-resolution product cutout`);
    assert.match(visuals, new RegExp(`backyard-${asset}-clean\\.png`));
  }
});

test("Construye tu bolsa keeps the approved six-card hierarchy and real actions", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");

  for (const label of ["Driver", "Maderas", "Híbridos", "Hierros", "Wedges", "Putter"]) {
    assert.match(onboarding, new RegExp(`label: "${label}"`));
  }
  assert.match(onboarding, /Construye tu bolsa/);
  assert.match(onboarding, /Selecciona tu equipamiento ideal/);
  assert.match(onboarding, /Agregar a mi bolsa/);
  assert.match(onboarding, /setClubEditorCategory\(category\); setClubEditorOpen\(true\)/);
  assert.match(onboarding, /clubs\.length \? "✓" : "\+"/);
});

test("mobile bag cards preserve touch targets and cannot create horizontal overflow", () => {
  const css = source("app/components/equipment.module.css");

  assert.match(css, /@media\(max-width:560px\)[\s\S]*\.visualClubCard,\.visualClubSelected \{ grid-template-columns:53% minmax\(0,1fr\) 40px/);
  assert.match(css, /\.visualClubCard,\.visualClubSelected \{[\s\S]*overflow:hidden/);
  assert.match(css, /\.visualClubMedia \{ width:100%;height:128px/);
  assert.match(css, /\.visualClubCard > strong,\.visualClubSelected > strong \{ width:40px;height:40px/);
});
