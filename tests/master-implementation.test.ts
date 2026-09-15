import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCaddieHoleContext, missingCaddieInputs } from "../features/caddie/domain";
import { planHasFeature } from "../lib/plans";
import { collectRoundSetupPreflightIssues } from "../lib/round-setup-preflight";
import { MAX_ROUND_PLAYERS, ROUND_PLAYER_LIMIT_MESSAGE, roundPlayerLimitExceeded } from "../lib/round-player-limit";

test("preflight explica faltantes y cada uno conserva un destino accionable", () => {
  const issues = collectRoundSetupPreflightIssues({
    courseSelected: false,
    players: [{ id: "said", name: "" }],
    betIssues: [{ code: "skins", sectionId: "result-section-setup-skins", message: "Skins: completa participantes." }],
  });
  assert.deepEqual(issues.map((issue) => issue.kind), ["course", "players", "bets"]);
  assert.deepEqual(issues.map((issue) => issue.targetId), ["round-course", "round-players", "result-section-setup-skins"]);
  assert.deepEqual(issues.map((issue) => issue.label), ["Campo", "Nombre de jugadores", "Configuración de apuesta"]);
});

test("el límite de cinco pertenece a toda ronda y Preflight bloquea borradores legacy con seis", () => {
  assert.equal(MAX_ROUND_PLAYERS, 5);
  assert.equal(roundPlayerLimitExceeded(5), false);
  assert.equal(roundPlayerLimitExceeded(6), true);
  const issues = collectRoundSetupPreflightIssues({
    courseSelected: true,
    players: Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, name: `Jugador ${index + 1}` })),
    betIssues: [],
  });
  assert.deepEqual(issues, [{
    id: "player-limit",
    label: "Jugadores",
    detail: `${ROUND_PLAYER_LIMIT_MESSAGE}. Quita 1 para continuar.`,
    targetId: "round-players",
    kind: "players",
  }]);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /players\.length >= MAX_ROUND_PLAYERS/);
  assert.match(page, /5 \/ 5 jugadores · máximo por grupo de salida/);
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

test("Más concentra herramientas, ayuda y configuración sin duplicar Perfil", () => {
  const more = readFileSync("app/components/more-hub.tsx", "utf8");
  const page = readFileSync("app/page.tsx", "utf8");
  for (const label of ["Campos", "Mi Bolsa", "Handicap / GHIN", "Fitting", "GPS / Hole Map", "Ayuda", "Configuración adicional"]) {
    assert.match(more, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(more, /title: "Perfil"/);
  assert.match(page, /onOpenHelp=\{openRulesForRound\}/);
  assert.match(page, /onOpenSettings=\{\(\) => setTab\("account"\)\}/);
});

test("plantillas de grupo conservan Foursome Match y las reglas explícitas de animales", () => {
  const editor = readFileSync("app/components/group-bet-template-editor.tsx", "utf8");
  assert.match(editor, /<option value="match" disabled=\{value\.roundDefaults\.roundHoles !== 18\}>Match · Primera \/ Segunda \/ Total<\/option>/);
  assert.match(editor, /mode === "match" \? \{ segmentSize: 18, pressureMultiplier: 1, pressSecond9: false/);
  assert.match(editor, /Presionadas Match/);
  assert.match(editor, /¿Cómo se define quién se queda el animal\?/);
  assert.match(editor, /Los empatados lo pagan/);
  assert.match(editor, /El último de los empatados en hacerlo/);
  assert.match(editor, /settlementMode: "round"/);
});

test("Foursome Match expone presiones independientes sin reutilizar el multiplicador legacy", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const engine = readFileSync("lib/engine.ts", "utf8");
  assert.match(page, /Presionadas Match/);
  assert.match(page, /\+ Agregar presión/);
  assert.match(page, /matchPresses/);
  assert.match(page, /Foursome — Match/);
  assert.match(page, /Resultados Foursome Match/);
  assert.match(page, /TOTAL A PAGAR/);
  assert.match(engine, /FoursomeMatchPressResult/);
  assert.match(engine, /pressProvisionalMoney/);
});
