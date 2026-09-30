import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EQUIPMENT_CATEGORY_ASSETS } from "../app/components/equipment-category-assets";
import { BAG_CATEGORY_SECTIONS, bagCategoryManagement } from "../lib/equipment-bag-management";
import type { ClubCategory } from "../lib/golf-equipment";

const onboarding = readFileSync("app/components/equipment-onboarding.tsx", "utf8");
const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");

const EXPECTED = [
  ["DRIVER", "Driver"],
  ["MINI_DRIVER", "Mini Driver"],
  ["FAIRWAY_WOOD", "Maderas"],
  ["HYBRID", "Híbridos"],
  ["UTILITY_IRON", "Utility / Driving Iron"],
  ["IRON_SET", "Hierros"],
  ["WEDGE", "Wedges"],
  ["PUTTER", "Putter"],
] as const;

const canonicalCategories = BAG_CATEGORY_SECTIONS.map((section) => [section.categories[0], section.label] as const);

test("Onboarding renders exactly the canonical eight equipment categories", () => {
  assert.deepEqual(canonicalCategories, EXPECTED);
  assert.match(onboarding, /const ONBOARDING_CLUB_CATEGORIES = BAG_CATEGORY_SECTIONS\.map/);
  assert.match(onboarding, /ONBOARDING_CLUB_CATEGORIES\.map/);
});

test("Profile category selection renders the same canonical eight categories", () => {
  assert.equal(BAG_CATEGORY_SECTIONS.length, 8);
  assert.match(editor, /BAG_CATEGORY_SECTIONS\.map\(\(section\) =>/);
  assert.match(editor, /const category = section\.categories\[0\]/);
});

test("Onboarding and Profile cannot diverge in category order", () => {
  assert.deepEqual(canonicalCategories.map(([category]) => category), EXPECTED.map(([category]) => category));
  assert.match(onboarding, /import \{ BAG_CATEGORY_SECTIONS \}/);
  assert.match(editor, /import \{ BAG_CATEGORY_SECTIONS \}/);
});

test("Mini Driver uses its canonical selector category and approved copy", () => {
  const miniDriver = BAG_CATEGORY_SECTIONS.find((section) => section.categories[0] === "MINI_DRIVER");
  assert.deepEqual(miniDriver && [miniDriver.label, miniDriver.onboardingDescription], ["Mini Driver", "Control desde el tee con una cabeza compacta."]);
  assert.match(editor, /onClick=\{\(\) => chooseCategory\(category\)\}/);
  assert.match(onboarding, /setClubEditorCategory\(category\); setClubEditorOpen\(true\)/);
});

test("Utility / Driving Iron uses its canonical selector category and approved copy", () => {
  const utility = BAG_CATEGORY_SECTIONS.find((section) => section.categories[0] === "UTILITY_IRON");
  assert.deepEqual(utility && [utility.label, utility.onboardingDescription], ["Utility / Driving Iron", "Trayectoria penetrante y control desde el tee."]);
  assert.match(editor, /initialCategory/);
  assert.match(onboarding, /initialCategory=\{clubEditorCategory \|\| undefined\}/);
});

test("Onboarding and Profile resolve all eight images from the same canonical asset registry", () => {
  assert.deepEqual(Object.keys(EQUIPMENT_CATEGORY_ASSETS), EXPECTED.map(([category]) => category));
  assert.match(onboarding, /EQUIPMENT_CATEGORY_ASSETS\[category\]/);
  assert.match(editor, /EQUIPMENT_CATEGORY_ASSETS\[category\]/);
  assert.notEqual(EQUIPMENT_CATEGORY_ASSETS.MINI_DRIVER.src, EQUIPMENT_CATEGORY_ASSETS.DRIVER.src);
  assert.notEqual(EQUIPMENT_CATEGORY_ASSETS.UTILITY_IRON.src, EQUIPMENT_CATEGORY_ASSETS.IRON_SET.src);
});

test("a saved Mini Driver is marked in the bag and uses the shared En mi bolsa state", () => {
  const state = bagCategoryManagement([{ category: "MINI_DRIVER" as ClubCategory }]);
  assert.deepEqual(state.populated.map((section) => section.id), ["mini-driver"]);
  assert.ok(!state.missing.some((section) => section.id === "mini-driver"));
  assert.match(onboarding, /configured \? "✓ En mi bolsa" : "Agregar a mi bolsa"/);
});

test("a saved Utility / Driving Iron is marked in the bag and uses the shared En mi bolsa state", () => {
  const state = bagCategoryManagement([{ category: "UTILITY_IRON" as ClubCategory }]);
  assert.deepEqual(state.populated.map((section) => section.id), ["utility"]);
  assert.ok(!state.missing.some((section) => section.id === "utility"));
  assert.match(onboarding, /const configured = clubs\.length > 0/);
});
