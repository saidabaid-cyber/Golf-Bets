import assert from "node:assert/strict";
import test from "node:test";

import {
  askRulesWithClient,
  buildRulesAiInstructions,
  buildRulesQuestionContext,
  cleanRulesAiAnswer,
  isLaVistaRulesContext,
  publicRulesAiStatus,
  rulesAiConfig,
  type RulesAiClient,
} from "../lib/rules-ai";

test("Rules AI reports disabled and incomplete configuration without exposing secrets", () => {
  assert.equal(rulesAiConfig({ RULES_AI_ENABLED: "false", OPENAI_API_KEY: "secret" }).ready, false);
  const status = publicRulesAiStatus({ RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret", OPENAI_RULES_VECTOR_STORE_ID: "vs_test" });
  assert.deepEqual(status, { enabled: true, configured: true });
  assert.equal("apiKey" in status, false);
  assert.equal("vectorStoreId" in status, false);
});

test("Rules AI prompt preserves source hierarchy and gentlemen-code safety", () => {
  const instructions = buildRulesAiInstructions();
  assert.ok(instructions.indexOf("Reglas de Golf/USGA") < instructions.indexOf("Aclaraciones vigentes"));
  assert.ok(instructions.indexOf("Aclaraciones vigentes") < instructions.indexOf("Procedimientos del Comité"));
  assert.match(instructions, /Nunca derives de él golpe de castigo/i);
  assert.match(instructions, /QUÉ PROCEDE, PENALIDAD, QUÉ DEBO HACER, REGLA y FUENTE/);
});

test("La Vista local rules are included only in a La Vista context", () => {
  assert.equal(isLaVistaRulesContext("Otro campo", "Mi bola está en agua"), false);
  assert.equal(isLaVistaRulesContext("Otro campo", "Estoy jugando La Vista en el hoyo 14"), false);
  assert.equal(isLaVistaRulesContext("", "Estoy jugando La Vista en el hoyo 14"), true);
  assert.match(buildRulesQuestionContext({ question: "Hoyo 14", courseName: "La Vista" }), /Boyas rojas/);
  assert.match(buildRulesQuestionContext({ question: "Hoyo 14", courseName: "Otro campo" }), /No aplicar reglas locales/);
});

test("Rules AI uses local rules only for the active La Vista fields and stays general without a round", () => {
  assert.equal(isLaVistaRulesContext("La Vista Temporal", "Hoyo 14"), true);
  assert.equal(isLaVistaRulesContext("Campestre de Puebla", "La Vista hoyo 14"), false);
  assert.doesNotMatch(buildRulesQuestionContext({ question: "Hoyo 14", courseName: "El Cristo" }), /Boyas rojas/);
  const noRound = buildRulesQuestionContext({ question: "¿Tengo alivio del camino?", courseName: "" });
  assert.match(noRound, /NO HAY RONDA ACTIVA/);
  assert.match(noRound, /Una Regla Local del campo podría modificar el procedimiento/);
  assert.doesNotMatch(noRound, /Boyas rojas/);
});

test("enabled Rules AI uses Responses file_search with a configured vector store and a mock client", async () => {
  let request: Record<string, unknown> | undefined;
  const client: RulesAiClient = { responses: { create: async (input) => { request = input; return { output_text: "QUÉ PROCEDE\nAlivio.\n\nPENALIDAD\nSin penalidad." }; } } };
  const env = { RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret-never-send", OPENAI_RULES_VECTOR_STORE_ID: "vs_rules", OPENAI_RULES_MODEL: "gpt-5.4-mini" };
  const answer = await askRulesWithClient({ client, env, question: "¿Tengo alivio del camino?", courseName: "La Vista" });
  assert.match(answer, /QUÉ PROCEDE/);
  assert.equal(request?.model, "gpt-5.4-mini");
  assert.deepEqual(request?.tools, [{ type: "file_search", vector_store_ids: ["vs_rules"], max_num_results: 12 }]);
  assert.equal(JSON.stringify(request).includes("secret-never-send"), false);
});

test("Rules AI removes internal file citation markers from the visible answer", () => {
  assert.equal(cleanRulesAiAnswer("FUENTE\nGuía Oficial fileciteturn0file1"), "FUENTE\nGuía Oficial");
});
