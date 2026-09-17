import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeBallFitHandicap } from "../lib/ball-fit-handicap";
import { normalizeBallFitInput, runBackyardBallFit, toEquipmentBallFitSummary, restoreEquipmentBallFitSummary } from "../lib/ball-fitting";
import { createBallFitTransportInput, normalizeBallFitTransportInput } from "../lib/ball-fitting-api";
import { createEmptyEquipmentProfile, normalizeEquipmentProfile, setLastBallFit } from "../lib/golf-equipment";
import { golfBallCatalog } from "../lib/golf-equipment-catalog";
import { loadBallFitDraft, saveBallFitDraft } from "../lib/ball-fitting-storage";

const answers = { userId: "fit-handicap-owner", feelPreference: "SOFT", trajectoryPreference: "MID", wantsGreensideSpin: "YES", priorities: ["WEDGE_SPIN"] };

test("blank, unknown and invalid fitting handicap never become zero or official", () => {
  for (const value of [null, undefined, "", " ", "18", NaN, 55, -21]) {
    assert.equal(normalizeBallFitHandicap(value, "GHIN").handicap, null);
    assert.equal(normalizeBallFitHandicap(value, "GHIN").handicapSource, "UNKNOWN");
  }
  assert.deepEqual(normalizeBallFitHandicap(0, "MANUAL"), { handicap: 0, handicapSource: "MANUAL" });
  assert.deepEqual(normalizeBallFitHandicap(18, undefined), { handicap: 18, handicapSource: "MANUAL" });
  assert.deepEqual(normalizeBallFitHandicap(18, "UNKNOWN"), { handicap: null, handicapSource: "UNKNOWN" });
});

for (const source of ["GHIN", "BACKYARD", "MANUAL", "UNKNOWN"] as const) {
  test(`Ball Fit ${source} preserves value and source through request, equipment snapshot and reload`, () => {
    const input = normalizeBallFitInput({ ...answers, handicap: source === "UNKNOWN" ? null : 18.4, handicapSource: source, experience: "STARTING", typicalScore: 110 });
    assert.ok(input);
    const transport = normalizeBallFitTransportInput(createBallFitTransportInput(input));
    assert.equal(transport?.handicap, input.handicap);
    assert.equal(transport?.handicapSource, source);
    const result = runBackyardBallFit(golfBallCatalog, input);
    assert.equal(result.recommendations.length, 3, "no GHIN requirement");
    const summary = toEquipmentBallFitSummary(result, `fit-${source}`, "2026-09-17T10:00:00Z", input);
    assert.ok(summary);
    const profile = createEmptyEquipmentProfile(input.userId);
    assert.ok(profile);
    const saved = setLastBallFit(profile, summary);
    assert.ok(saved);
    const reloaded = normalizeEquipmentProfile(JSON.parse(JSON.stringify(saved)), input.userId);
    assert.ok(reloaded);
    const restored = restoreEquipmentBallFitSummary(reloaded.lastBallFit);
    assert.equal(restored?.input.handicapSource, source);
    assert.equal(restored?.input.handicap, input.handicap);
    assert.equal(restored?.input.experience, "STARTING");
    if (source === "MANUAL") assert.ok(result.warnings.some((warning) => warning.includes("no es un índice oficial")));
    if (source === "UNKNOWN") assert.ok(result.warnings.some((warning) => warning.includes("sin estimar un índice")));
  });
}

test("unknown beginner's experience and typical score do not invent a handicap", () => {
  const noHcp = normalizeBallFitInput({ ...answers, handicapSource: "UNKNOWN", handicap: null, experience: "STARTING", typicalScore: 120 });
  assert.ok(noHcp);
  const experienced = { ...noHcp, experience: "REGULAR", typicalScore: 80 };
  assert.equal(noHcp.handicap, null);
  assert.deepEqual(runBackyardBallFit(golfBallCatalog, noHcp).recommendations, runBackyardBallFit(golfBallCatalog, experienced).recommendations);
});

test("manual choice survives draft resume without replacing it with current profile index", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  assert.ok(saveBallFitDraft(storage, { ...answers, handicap: 24, handicapSource: "MANUAL" }, 4));
  const restored = loadBallFitDraft(storage, answers.userId);
  assert.equal(restored?.input.handicap, 24);
  assert.equal(restored?.input.handicapSource, "MANUAL");
  const wizard = readFileSync("app/components/ball-fit-wizard.tsx", "utf8");
  assert.match(wizard, /setInput\(savedDraft\.input\)/);
  assert.doesNotMatch(wizard, /\.\.\.savedDraft\.input, handicap: defaultHandicap/);
  assert.match(wizard, /createBallFitTransportInput\(input\)/);
  assert.doesNotMatch(wizard, /updateProfile|saveCloudAccountProfile|updateUser/);
});

test("onboarding uses page editors and inline equipment results have no nested scroll", () => {
  const onboarding = readFileSync("app/components/equipment-onboarding.tsx", "utf8");
  assert.match(onboarding, /if \(clubEditorOpen\) return[^\n]*presentation="page"/);
  assert.match(onboarding, /if \(ballEditorOpen\) return[^\n]*presentation="page"/);
  const css = readFileSync("app/components/equipment.module.css", "utf8");
  assert.match(css, /\.editorPage :global\(\.anchoredSearchResults\) \{\s*position: static;\s*max-height: none;\s*overflow: visible;/);
  assert.match(css, /\.editorPage \.formActions \{ position: static;/);
  assert.match(css, /padding-bottom: calc\(100px \+ env\(safe-area-inset-bottom\)\)/);
});
