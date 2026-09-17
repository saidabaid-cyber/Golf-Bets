import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createScrollLock } from "../lib/mobile-viewport";
import { finalizeNumericCapture, normalizeNumericCaptureText } from "../lib/numeric-input";
import { normalizeBallFitInput } from "../lib/ball-fitting";
import { loadBallFitDraft, saveBallFitDraft } from "../lib/ball-fitting-storage";

test("score and distance retain intermediate keystrokes below the final minimum", () => {
  for (const [value, min, max] of [[72, 40, 200], [82, 40, 200], [95, 40, 200], [245, 50, 500]]) {
    let raw = "";
    for (const digit of String(value)) { raw = normalizeNumericCaptureText(raw + digit); assert.ok(raw); }
    assert.equal(finalizeNumericCapture(raw, min, max).value, value);
  }
  const component = readFileSync("app/components/ball-fit-wizard.tsx", "utf8");
  assert.ok(!component.includes("optionalNumber("));
  assert.match(component, /NumericCaptureInput keyboardMode="numeric" min=\{40\}/);
  assert.match(component, /NumericCaptureInput keyboardMode="numeric" min=\{50\}/);
  assert.match(readFileSync("app/components/numeric-capture-input.tsx", "utf8"), /inputMode=\{keyboardMode \?\? "text"\}/);
});

test("fitting draft reload and editing preserve independent distance/speed without inventing handicap", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
  const input = normalizeBallFitInput({ userId: "qa-mobile", handicap: null, handicapSource: "UNKNOWN", typicalScore: 82, driverDistanceYards: 245, swingSpeedBand: "UNKNOWN" });
  assert.ok(input);
  assert.ok(saveBallFitDraft(storage, input, 2));
  let restored = loadBallFitDraft(storage, input.userId)!;
  assert.equal(restored.input.typicalScore, 82);
  assert.equal(restored.input.driverDistanceYards, 245);
  assert.equal(restored.input.swingSpeedBand, "UNKNOWN");
  assert.equal(restored.input.handicap, null);
  assert.ok(saveBallFitDraft(storage, { ...restored.input, typicalScore: 95 }, 0));
  restored = loadBallFitDraft(storage, input.userId)!;
  assert.equal(restored.input.typicalScore, 95);
  assert.equal(restored.input.driverDistanceYards, 245);
});

for (const order of [[0, 1], [1, 0]]) test(`nested modal cleanup restores exactly once in order ${order}`, () => {
  let locks = 0, restores = 0;
  const acquire = createScrollLock(() => { locks++; return () => { restores++; }; });
  const release = [acquire(), acquire()];
  assert.equal(locks, 1);
  release[order[0]](); assert.equal(restores, 0);
  release[order[0]](); assert.equal(restores, 0);
  release[order[1]](); assert.equal(restores, 1);
  for (let i = 0; i < 30; i++) { const close = acquire(); close(); close(); }
  assert.equal(locks, 31); assert.equal(restores, 31);
});

test("navigation and wizards use one commit-aware scroll policy, not old scroll restoration", () => {
  for (const file of ["use-screen-navigation.ts", "use-secondary-view.ts", "ball-fit-wizard.tsx", "round-setup-wizard.tsx", "equipment-profile-panel.tsx", "equipment-onboarding.tsx", "profile-account-panel.tsx"]) {
    assert.match(readFileSync(`app/components/${file}`, "utf8"), /useViewScrollReset/);
  }
  assert.doesNotMatch(readFileSync("app/components/use-screen-navigation.ts", "utf8"), /previous\.scroll/);
  const hook = readFileSync("app/components/use-view-scroll-reset.ts", "utf8");
  assert.match(hook, /cancelAnimationFrame/);
  const scroll = readFileSync("lib/mobile-viewport.ts", "utf8");
  assert.match(scroll, /modal\.scrollTop = 0/);
  assert.match(scroll, /else scrollDocumentToTop/);
});

test("cloud preference defaults on only when no explicit false exists", () => {
  const source = readFileSync("lib/cloud-sync-service.ts", "utf8");
  assert.match(source, /highContrast: preferences.data\?\.high_contrast !== false/);
  assert.match(source, /high_contrast: preferences\?\.highContrast !== false/);
});
