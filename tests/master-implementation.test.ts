import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCaddieHoleContext, missingCaddieInputs } from "../features/caddie/domain";
import { planHasFeature } from "../lib/plans";
import { collectRoundSetupPreflightIssues } from "../lib/round-setup-preflight";

test("preflight explica faltantes y cada uno conserva un destino accionable", () => {
  const issues = collectRoundSetupPreflightIssues({
    courseSelected: false,
    players: [{ id: "said", name: "" }],
    betIssues: [{ code: "skins", sectionId: "result-section-setup-skins", message: "Skins: completa participantes." }],
  });
  assert.deepEqual(issues.map((issue) => issue.kind), ["course", "players", "bets"]);
  assert.deepEqual(issues.map((issue) => issue.targetId), ["round-course", "round-players", "result-section-setup-skins"]);
});

test("Caddie AI es exclusivo de Backyard Black y no inventa contexto faltante", () => {
  assert.equal(planHasFeature("free", "caddie_ai"), false);
  assert.equal(planHasFeature("gold", "caddie_ai"), false);
  assert.equal(planHasFeature("black", "caddie_ai"), true);
  const context = buildCaddieHoleContext({ hole: { number: 7, par: 4, strokeIndex: 3 } });
  assert.equal(context.yards, null);
  assert.equal(context.wind, null);
  assert.equal(context.pinPosition, null);
  assert.ok(missingCaddieInputs(context).includes("viento"));
  assert.ok(missingCaddieInputs(context).includes("posición de bandera"));
});

test("setup oculta tees avanzados, muestra campo cercano y preflight sin botón muerto", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const picker = readFileSync("app/components/round-course-picker.tsx", "utf8");
  const route = readFileSync("app/api/courses/search/route.ts", "utf8");
  assert.match(page, /<h2>1\. Campo<\/h2>/);
  assert.match(page, /<details className="playerTeeAssignments optionalTeeSetup">/);
  assert.match(page, /FALTA COMPLETAR/);
  assert.match(page, /document\.getElementById\(issue\.targetId\)/);
  assert.match(picker, /Buscar campos cercanos con mi ubicación/);
  assert.match(picker, /No diste permiso de ubicación/);
  assert.match(route, /nearbyCourses/);
  assert.match(route, /invalid_location/);
});

test("Game Screen usa controles naturales y nunca crea inputs animales independientes", () => {
  const capture = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  const controls = readFileSync("app/components/bet-fields/capture-controls.tsx", "utf8");
  assert.match(capture, /data-game-screen="approved-compact-v1"/);
  assert.match(capture, /Penalty \/ Hazard/);
  assert.match(capture, /<SituationCounter label="OB"/);
  assert.match(capture, /activeAnimals\.viper/);
  assert.match(capture, /activeAnimals\.camel/);
  assert.match(capture, /activeAnimals\.fish/);
  assert.doesNotMatch(capture, /label="Camello"|label="Víbora"|label="Pez"/);
  assert.doesNotMatch(capture, /Resultado de la bola/);
  assert.match(controls, /Optional non-negative fact/);
});

test("fallo de consentimiento remoto muestra causa y garantiza que no hubo envío", () => {
  const prompt = readFileSync("app/components/backyard-ai/ai-processing-consent.tsx", "utf8");
  const setup = readFileSync("app/components/backyard-ai/ai-round-setup.tsx", "utf8");
  assert.match(prompt, /consent_environment_blocked/);
  assert.match(prompt, /registro de autorizaciones aislado/);
  assert.match(prompt, /No se envió ningún contenido a la IA/);
  assert.match(prompt, /aiProcessingConsentFailureMessage\(reason, Boolean\(accessToken\)\)/);
  assert.match(prompt, /setError\(aiProcessingConsentFailureMessage\(reason, true\)\)/);
  assert.match(setup, /consentInfrastructureNotice/);
  assert.match(setup, /La instrucción no se envió y continuamos con el intérprete local seguro/);
  assert.match(setup, /!consentInfrastructureNotice && !remoteConsentUnavailable/);
});
