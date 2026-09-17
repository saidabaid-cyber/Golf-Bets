import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveRoundSetupProvider } from "../lib/backyard-ai/runtime/provider-round-setup";
import { parseRoundSetupIntent } from "../lib/backyard-ai/runtime/intent-parser";
import { planRoundSetup } from "../lib/backyard-ai/runtime/round-setup";
import { createRoundSetupDraft } from "../lib/backyard-ai/schemas/round-setup";

const provider = (canonicalCommand: string) => ({ canonicalCommand, confidence: 0.99, clarification: null });
const original = "Somos Alfa y Bravo. Nassau match de 100, 100 y 200. Salimos por el hoyo 10. Sin presiones.";
const activeDraft = createRoundSetupDraft({ date: "2026-09-17", ownerId: "a", players: [
  { id: "a", name: "Alfa", handicap: 0 }, { id: "b", name: "Bravo", handicap: 8 },
], course: { id: "qa", name: "Campo QA", teeName: "Azules", holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })) } });

test("A equivalent provider remains remote canonical, never auto-starts a round", () => {
  const result = resolveRoundSetupProvider("Skins de $100.", provider("Skins por 100."));
  assert.ok(result.ok);
  assert.equal(result.response.mode, "AI_PROVIDER_CANONICAL");
  assert.equal(result.response.canonicalCommand, "Skins por 100.");
  assert.deepEqual(result.response.integrityIssueCodes, []);
  assert.equal("roundId" in result.response, false);
});

const rejected = [
  ["B amount", "Skins de 100.", "Skins de 200."],
  ["C starting hole", "Salimos por el hoyo 10.", "Salimos por el hoyo 1."],
  ["D negation", "Skins de 100. Sin presiones.", "Skins de 100. Con presiones."],
  ["D bare negation removed", "Skins de 100. Sin presiones.", "Skins de 100."],
  ["E added player", "Somos Alfa y Bravo.", "Somos Alfa, Bravo y Carlos."],
  ["F changed teams", "Bola Amiga Alfa/Bravo contra Carlos/Diego de 100.", "Bola Amiga Alfa/Carlos contra Bravo/Diego de 100."],
  ["F Foursome teams", "Foursome Match Said/Pedro contra Juan/Andrés de 500.", "Foursome Match Said/Juan contra Pedro/Andrés de 500."],
  ["G memory", "Los mismos del domingo. Skins de 100.", "Como la semana pasada. Skins de 100."],
  ["H unknown game", "Calcuta de 100.", "Skins de 100."],
  ["tee", "Juan juega azules y los demás blancas.", "Juan juega blancas y los demás azules."],
  ["holes", "Jugamos 18 hoyos.", "Jugamos 9 hoyos."],
  ["exclusion", "Todos juegan Skins menos Carlos.", "Todos juegan Skins."],
] as const;
for (const [label, input, proposed] of rejected) test(`${label}: reject provider, preserve exact original and discard its clarification`, () => {
  const result = resolveRoundSetupProvider(input, { ...provider(proposed), clarification: "¿Confirmas la configuración alterada?" });
  assert.ok(result.ok);
  assert.equal(result.response.mode, "SAFE_LOCAL_FALLBACK");
  assert.equal(result.response.canonicalCommand, input);
  assert.equal(result.response.clarification, null);
  assert.ok(result.response.integrityIssueCodes.length > 0);
  assert.deepEqual(parseRoundSetupIntent(result.response.canonicalCommand), parseRoundSetupIntent(input));
});

test("exact Preview 502 fixture now yields safe review, preserves raw stakes and never invents ambiguous Nassau", () => {
  const result = resolveRoundSetupProvider(original, provider(original.replace("100, 100 y 200", "200, 200 y 400")));
  assert.ok(result.ok);
  assert.equal(result.response.canonicalCommand, original);
  const plan = planRoundSetup(result.response.canonicalCommand, { activeDraft, today: "2026-09-17" });
  assert.equal(plan.draft.startHole, 10);
  assert.equal(plan.draft.roundHoles, 18);
  assert.deepEqual(plan.draft.players.map(p => p.name), ["Alfa", "Bravo"]);
  assert.equal(plan.questions.some(q => q.field === "bets.pressures"), false);
  assert.ok(plan.questions.some(q => q.prompt.includes("monto")));
  assert.equal(plan.canConfirm, false);
  assert.equal(plan.draft.supplementalBets.length, 0);
});

test("full explicit safe fallback reaches review with 18H/H10/Skins100, roster and tees unchanged", () => {
  const input = "Somos Alfa y Bravo. Jugamos 18 hoyos. Salimos por el hoyo 10. Skins de 100. Sin presiones. Tee azules.";
  const result = resolveRoundSetupProvider(input, provider(input.replace("100", "200")));
  assert.ok(result.ok);
  const plan = planRoundSetup(result.response.canonicalCommand, { activeDraft, courses: [activeDraft.course!], today: "2026-09-17" });
  assert.equal(plan.draft.bets.skins.value, 100);
  assert.equal(plan.draft.bets.skins.enabled, true);
  assert.equal(plan.draft.startHole, 10);
  assert.equal(plan.draft.roundHoles, 18);
  assert.deepEqual(plan.draft.players.map(p => p.name), ["Alfa", "Bravo"]);
  assert.equal(plan.draft.course?.teeName, "Azules");
  assert.equal(plan.draft.bets.foursome.enabled, false);
  assert.equal(plan.draft.supplementalBets.length, 0);
  assert.equal(plan.questions.some(q => q.field.startsWith("bets.pressures")), false);
});

test("I invalid provider schemas remain a controlled error, not a successful interpretation", () => {
  for (const value of [null, [], {}, provider(""), { ...provider("Skins de 100."), confidence: 2 }, { ...provider("Skins de 100."), execute: true }]) {
    assert.deepEqual(resolveRoundSetupProvider(original, value), { ok: false, code: "invalid_interpretation" });
  }
});

test("J unrecognized original cannot turn fallback into fabricated setup", () => {
  const input = "Agrega Calcuta de 100.";
  const result = resolveRoundSetupProvider(input, provider("Skins de 100."));
  assert.ok(result.ok);
  const plan = planRoundSetup(result.response.canonicalCommand, { activeDraft, today: "2026-09-17" });
  assert.equal(plan.canConfirm, false);
  assert.ok(plan.questions.some(q => q.code === "unknown_bet"));
  assert.equal(plan.draft.bets.skins.enabled, false);
});

test("route uses safe resolver, typed issue-only telemetry; UI does not mark fallback as provider success", () => {
  const route = readFileSync("app/api/backyard-ai/round-setup/route.ts", "utf8");
  assert.ok(route.indexOf("const localInterpretation = parseRoundSetupIntent(input)") < route.indexOf("const rawResult = await"));
  assert.match(route, /resolveRoundSetupProvider\(input, rawResult, localInterpretation\)/);
  assert.match(route, /return json\(response\)/);
  assert.doesNotMatch(route, /code: "canonical_integrity".*status: 502/);
  const telemetry = route.slice(route.indexOf("function logRoundSetupProvider"), route.indexOf("function instructions"));
  assert.match(telemetry, /event: "canonical_integrity_fallback", issueCodes:/);
  assert.doesNotMatch(telemetry, /canonicalCommand|originalCommand|rawResult|prompt:/);
  const ui = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  assert.match(ui, /integrity.ok && response.mode !== "SAFE_LOCAL_FALLBACK"/);
});
