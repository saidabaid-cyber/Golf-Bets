import assert from "node:assert/strict";
import test from "node:test";

import {
  answerRulesWithProvider,
  askRulesWithProvider,
  buildRulesAiInstructions,
  buildRulesQuestionContext,
  cleanRulesAiAnswer,
  classifyRulesAiFailure,
  DEFAULT_RULES_AI_PROVIDER,
  DEFAULT_GEMINI_RULES_MODEL,
  DEFAULT_OPENAI_RULES_MODEL,
  isLaVistaRulesContext,
  publicRulesAiStatus,
  RULES_AI_FINAL_AUTHORITY_NOTICE,
  RULES_AI_UNCERTAIN_MESSAGE,
  rulesAiConfig,
} from "../lib/rules-ai";
import {
  createGeminiRulesProvider,
  createOpenAiRulesProvider,
  RulesAiProviderRequestError,
  type RulesAiGenerationInput,
  type RulesAiTextProvider,
} from "../lib/rules-ai-providers";
import { retrieveRulesEvidence } from "../lib/rules-evidence";

const limiterEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

test("Rules AI defaults to OpenAI and reports configuration without exposing secrets", () => {
  assert.equal(DEFAULT_RULES_AI_PROVIDER, "openai");
  assert.equal(rulesAiConfig({ RULES_AI_ENABLED: "false", OPENAI_API_KEY: "secret" }).ready, false);
  const status = publicRulesAiStatus({ ...limiterEnvironment, RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret" });
  assert.deepEqual(status, { enabled: true, configured: true, provider: "openai", model: DEFAULT_OPENAI_RULES_MODEL, state: "ready" });
  assert.equal("apiKey" in status, false);
  assert.deepEqual(
    publicRulesAiStatus({ RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret" }),
    { enabled: true, configured: false, provider: "openai", model: DEFAULT_OPENAI_RULES_MODEL, state: "missing_config" },
    "el endpoint no declara ready si el limitador distribuido no puede existir",
  );
  assert.equal(rulesAiConfig({ ...limiterEnvironment, RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret" }).model, DEFAULT_OPENAI_RULES_MODEL);
  assert.equal(rulesAiConfig({ RULES_AI_ENABLED: "true", RULES_AI_PROVIDER: "otro", OPENAI_API_KEY: "secret" }).ready, false);
});

test("OpenAI remains explicitly selectable without depending on its vector store", () => {
  const config = rulesAiConfig({ ...limiterEnvironment, RULES_AI_ENABLED: "true", RULES_AI_PROVIDER: "openai", OPENAI_API_KEY: "secret", OPENAI_RULES_MODEL: "gpt-test" });
  assert.equal(config.provider, "openai");
  assert.equal(config.model, "gpt-test");
  assert.equal(config.ready, true);
});

test("Gemini remains explicitly selectable", () => {
  const config = rulesAiConfig({ ...limiterEnvironment, RULES_AI_ENABLED: "true", RULES_AI_PROVIDER: "gemini", GEMINI_API_KEY: "secret" });
  assert.equal(config.provider, "gemini");
  assert.equal(config.model, DEFAULT_GEMINI_RULES_MODEL);
  assert.equal(config.ready, true);
});

test("Rules AI distinguishes Gemini quota, OpenAI quota, rate limit, timeout, network and configuration", () => {
  assert.equal(classifyRulesAiFailure(new RulesAiProviderRequestError("gemini", 429, "RESOURCE_EXHAUSTED", "quota")).code, "quota");
  assert.match(classifyRulesAiFailure(new RulesAiProviderRequestError("gemini", 429, "RESOURCE_EXHAUSTED", "quota")).message, /Gemini/);
  assert.equal(classifyRulesAiFailure({ status: 429, code: "insufficient_quota" }, "openai").code, "quota");
  assert.match(classifyRulesAiFailure({ status: 429, code: "credit_balance_exhausted" }, "openai").message, /no tiene crédito disponible/);
  assert.equal(classifyRulesAiFailure({ status: 429, code: "rate_limit_exceeded" }, "openai").code, "rate_limit");
  assert.equal(classifyRulesAiFailure({ name: "AbortError" }).code, "timeout");
  assert.equal(classifyRulesAiFailure({ message: "Failed to fetch" }).code, "network");
  assert.equal(classifyRulesAiFailure({ status: 401, message: "invalid api key" }).code, "provider_config");
  assert.equal(classifyRulesAiFailure({ status: 404, message: "model not found" }, "gemini").code, "provider_config");
});

test("Rules AI prompt preserves evidence-only policy, source hierarchy and response format", () => {
  const instructions = buildRulesAiInstructions();
  assert.match(instructions, /únicamente con la EVIDENCIA RECUPERADA/);
  assert.ok(instructions.indexOf("Reglas de Golf/USGA") < instructions.indexOf("Aclaraciones vigentes"));
  assert.ok(instructions.indexOf("Aclaraciones vigentes") < instructions.indexOf("Procedimientos del Comité"));
  assert.match(instructions, /Nunca derives de él golpe de castigo/i);
  assert.match(instructions, /QUÉ PROCEDE, PENALIDAD, QUÉ DEBO HACER, REGLA y FUENTE/);
  assert.match(instructions, /deben incluir al menos una cita \[E#\]/);
  assert.match(instructions, /consecuencia canónica que aparezca expresamente en el fragmento citado/);
  assert.match(instructions, /únicamente el identificador exacto respaldado por el fragmento citado/);
});

test("La Vista local rules are retrieved only in a La Vista context", () => {
  assert.equal(isLaVistaRulesContext("Otro campo", "Mi bola está en agua"), false);
  assert.equal(isLaVistaRulesContext("Otro campo", "Estoy jugando La Vista en el hoyo 14"), false);
  assert.equal(isLaVistaRulesContext("", "Estoy jugando La Vista en el hoyo 14"), true);
  const laVista = buildRulesQuestionContext({ question: "En el hoyo 14 caí delante de las boyas rojas", courseName: "La Vista" });
  assert.match(laVista, /Reglas Locales · La Vista/);
  assert.match(laVista, /Boyas rojas/);
  const otherCourse = buildRulesQuestionContext({ question: "En el hoyo 14 caí delante de las boyas rojas", courseName: "Otro campo" });
  assert.doesNotMatch(otherCourse, /Reglas Locales · La Vista/);
});

test("Evidence retrieval covers the required field questions before invoking an LLM", () => {
  const cases: Array<[string, RegExp]> = [
    ["Mi bola se movió accidentalmente en el green, ¿qué procede?", /^(?:9|13)(?:\.|$)/],
    ["¿Puedo declarar una bola injugable dentro de un bunker?", /^19(?:\.|$)/],
    ["¿Qué pasa si golpeo accidentalmente mi bola durante una búsqueda?", /^7(?:\.|$)/],
  ];
  for (const [question, expectedRule] of cases) {
    const result = retrieveRulesEvidence({ question, courseName: "" });
    assert.equal(result.sufficient, true, question);
    assert.ok(result.evidence.some(entry => expectedRule.test(entry.rule)), question);
  }
  const local = retrieveRulesEvidence({ question: "En La Vista, hoyo 14, mi bola cruzó delante de las boyas rojas", courseName: "La Vista" });
  assert.ok(local.evidence.some(entry => entry.local && /Hoyo 14/.test(entry.rule)));

  const water = retrieveRulesEvidence({ question: "¿Qué pasa si mi bola se va al agua?", courseName: "" });
  assert.equal(water.sufficient, true);
  assert.match(water.evidence[0]?.rule || "", /^17(?:\.|$)/, "la pregunta de QA debe recuperar primero áreas de penalidad, no una coincidencia genérica de bola");
  assert.match(water.evidence[0]?.excerpt || "", /un golpe de penalidad/i, "la evidencia citada debe contener la penalidad, no solo el número de capítulo");
});

test("Gemini receives only the question and retrieved evidence, never the API key", async () => {
  let request: RulesAiGenerationInput | undefined;
  const provider: RulesAiTextProvider = {
    name: "gemini",
    generate: async input => {
      request = input;
      return "QUÉ PROCEDE\nHay alivio por la condición anormal. [E5]\n\nPENALIDAD\nSIN PENALIDAD. [E5]\n\nQUÉ DEBO HACER\nToma alivio completo según el procedimiento aplicable. [E5]\n\nREGLA\nRegla 16. [E5]\n\nFUENTE\n[E5] Reglas de Golf.";
    },
  };
  const answer = await askRulesWithProvider({
    provider,
    env: { RULES_AI_ENABLED: "true", RULES_AI_PROVIDER: "gemini", GEMINI_API_KEY: "secret-never-send", GEMINI_RULES_MODEL: "gemini-test" },
    question: "¿Tengo alivio del camino?",
    courseName: "La Vista",
  });
  assert.match(answer, /QUÉ PROCEDE/);
  assert.match(answer, /Comité o árbitro oficial tiene la decisión final/);
  assert.equal(request?.model, "gemini-test");
  assert.match(request?.prompt || "", /EVIDENCIA RECUPERADA/);
  assert.match(request?.prompt || "", /FUENTE:/);
  assert.equal(JSON.stringify(request).includes("secret-never-send"), false);
});

test("Rules AI does not call any provider when local retrieval finds no evidence", async () => {
  let called = false;
  const provider: RulesAiTextProvider = { name: "gemini", generate: async () => { called = true; return "Respuesta inventada"; } };
  const question = "¿Cuál es la receta de zyzzyva con chocolate cuántico?";
  assert.equal(retrieveRulesEvidence({ question, courseName: "" }).sufficient, false);
  const answer = await askRulesWithProvider({
    provider,
    env: { RULES_AI_ENABLED: "true", RULES_AI_PROVIDER: "gemini", GEMINI_API_KEY: "secret" },
    question,
    courseName: "",
  });
  assert.equal(answer, RULES_AI_UNCERTAIN_MESSAGE);
  assert.equal(called, false);
});

test("Rules AI returns only cited canonical evidence and fails closed on free-form output", async () => {
  const groundedProvider: RulesAiTextProvider = {
    name: "openai",
    generate: async () => "QUÉ PROCEDE\nPuedes tomar una opción de alivio. [E1]\n\nPENALIDAD\nUN GOLPE DE PENALIDAD. [E1]\n\nQUÉ DEBO HACER\nElige la opción permitida y usa el punto de referencia correcto. [E1]\n\nREGLA\nRegla 17. [E1]\n\nFUENTE\n[E1] Reglas de Golf.",
  };
  const env = { RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret" };
  const result = await answerRulesWithProvider({
    provider: groundedProvider,
    env,
    question: "¿Qué pasa si mi bola se va al agua?",
    courseName: "",
  });
  assert.match(result.answer, /\[E1\]/);
  assert.match(result.answer, new RegExp(RULES_AI_FINAL_AUTHORITY_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].citation, "[E1]");
  assert.match(result.evidence[0].rule, /^17(?:\.|$)/);
  assert.match(result.evidence[0].sourceUrl || "", /^https:\/\//);

  for (const answer of [
    "Puedes dropear con un golpe.",
    "QUÉ PROCEDE\nDropear.\nPENALIDAD\nUn golpe.\nQUÉ DEBO HACER\nDropear.\nREGLA\n17.\nFUENTE\n[E1]",
    "QUÉ PROCEDE\nToma alivio. [E1]\nPENALIDAD\nDOS GOLPES DE PENALIDAD. [E1]\nQUÉ DEBO HACER\nDropea. [E1]\nREGLA\nRegla 17. [E1]\nFUENTE\n[E1] Reglas de Golf.",
    "QUÉ PROCEDE\nToma alivio. [E1]\nPENALIDAD\nUN GOLPE DE PENALIDAD Y EXPULSIÓN. [E1]\nQUÉ DEBO HACER\nDropea. [E1]\nREGLA\nRegla 17. [E1]\nFUENTE\n[E1] Reglas de Golf.",
    "QUÉ PROCEDE\nToma alivio. [E1]\nPENALIDAD\nUN GOLPE DE PENALIDAD. [E1]\nQUÉ DEBO HACER\nDropea. [E1]\nREGLA\nRegla 18. [E1]\nFUENTE\n[E1] Reglas de Golf.",
    "QUÉ PROCEDE\nToma alivio. [E1]\nPENALIDAD\nUN GOLPE DE PENALIDAD. [E1]\nQUÉ DEBO HACER\nDropea. [E1]\nREGLA\nRegla 17 mágica. [E1]\nFUENTE\n[E1] Reglas de Golf.",
    "QUÉ PROCEDE\nToma alivio. [E1]\nPENALIDAD\nUN GOLPE DE PENALIDAD. [E1]\nQUÉ DEBO HACER\nDropea. [E1]\nREGLA\nRegla 17. [E1]\nFUENTE\n[E99] Reglas de Golf.",
    "QUÉ PROCEDE\nLanza el objeto con un bate hacia la calle. [E1]\nPENALIDAD\nUN GOLPE DE PENALIDAD. [E1]\nQUÉ DEBO HACER\nGuárdalo en tu bolsillo y sigue caminando. [E1]\nREGLA\nRegla 17. [E1]\nFUENTE\n[E1] Reglas de Golf.",
  ]) {
    const unsafe = await answerRulesWithProvider({
      provider: { name: "openai", generate: async () => answer },
      env,
      question: "¿Qué pasa si mi bola se va al agua?",
      courseName: "",
    });
    assert.deepEqual(unsafe, { answer: RULES_AI_UNCERTAIN_MESSAGE, evidence: [] });
  }
});

test("Rules AI makes one bounded evidence-only repair attempt after grounding rejection", async () => {
  let calls = 0;
  let repairPrompt = "";
  const provider: RulesAiTextProvider = {
    name: "openai",
    generate: async input => {
      calls += 1;
      if (calls === 1) return "Puedes dropear con un golpe.";
      repairPrompt = input.prompt;
      return "QUÉ PROCEDE\nPuedes tomar una opción de alivio. [E1]\n\nPENALIDAD\nUN GOLPE DE PENALIDAD. [E1]\n\nQUÉ DEBO HACER\nElige la opción permitida y usa el punto de referencia correcto. [E1]\n\nREGLA\nRegla 17. [E1]\n\nFUENTE\n[E1] Reglas de Golf.";
    },
  };
  const result = await answerRulesWithProvider({
    provider,
    env: { RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret" },
    question: "¿Qué pasa si mi bola se va al agua?",
    courseName: "",
  });
  assert.equal(calls, 2);
  assert.match(repairPrompt, /REPARACIÓN DE FORMATO Y GROUNDING/);
  assert.match(repairPrompt, /EVIDENCIA RECUPERADA/);
  assert.equal(result.evidence[0]?.citation, "[E1]");
  assert.match(result.answer, /Regla 17/);

  calls = 0;
  const explicitlyUncertain = await answerRulesWithProvider({
    provider: {
      name: "openai",
      generate: async () => {
        calls += 1;
        return RULES_AI_UNCERTAIN_MESSAGE;
      },
    },
    env: { RULES_AI_ENABLED: "true", OPENAI_API_KEY: "secret" },
    question: "¿Qué pasa si mi bola se va al agua?",
    courseName: "",
  });
  assert.equal(calls, 1, "una incertidumbre explícita del proveedor no dispara otro consumo");
  assert.deepEqual(explicitlyUncertain, { answer: RULES_AI_UNCERTAIN_MESSAGE, evidence: [] });
});

test("Gemini REST provider keeps its key in a server header and parses the response", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Respuesta con fuente" }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = createGeminiRulesProvider({ apiKey: "gemini-secret", fetchImpl });
  const answer = await provider.generate({ model: "gemini-3.5-flash-lite", instructions: "Solo evidencia", prompt: "[E1] Regla 13" });
  assert.equal(answer, "Respuesta con fuente");
  assert.match(requestedUrl, /gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(requestedUrl.includes("gemini-secret"), false);
  assert.equal(String(requestedInit?.body).includes("gemini-secret"), false);
  assert.equal((requestedInit?.headers as Record<string, string>)["x-goog-api-key"], "gemini-secret");
});

test("Gemini REST provider preserves safe quota metadata for public classification", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }), { status: 429 });
  const provider = createGeminiRulesProvider({ apiKey: "secret", fetchImpl });
  await assert.rejects(
    provider.generate({ model: "gemini-test", instructions: "rules", prompt: "evidence" }),
    (error: unknown) => error instanceof RulesAiProviderRequestError && error.provider === "gemini" && error.code === "RESOURCE_EXHAUSTED",
  );
});

test("OpenAI fallback uses the same provider contract without file_search", async () => {
  let request: Record<string, unknown> | undefined;
  const provider = createOpenAiRulesProvider({ responses: { create: async input => { request = input; return { output_text: "Respuesta OpenAI" }; } } });
  const answer = await provider.generate({ model: "gpt-test", instructions: "Solo evidencia", prompt: "[E1] Regla 13" });
  assert.equal(answer, "Respuesta OpenAI");
  assert.deepEqual(request, { model: "gpt-test", instructions: "Solo evidencia", input: "[E1] Regla 13", max_output_tokens: 900, store: false });
  assert.equal("tools" in (request || {}), false);
});

test("Rules AI removes internal file citation markers from the visible answer", () => {
  assert.equal(cleanRulesAiAnswer("FUENTE\nGuía Oficial fileciteturn0file1"), "FUENTE\nGuía Oficial");
});
