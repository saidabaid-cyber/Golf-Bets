import type { LocalRule } from "./types";
import { activeLocalRules, isLaVistaCourse, LA_VISTA_LOCAL_RULES } from "./local-rules";

export const DEFAULT_RULES_AI_MODEL = "gpt-5.4-mini";
export const RULES_AI_UNCERTAIN_MESSAGE = "No pude confirmar esta situación con suficiente seguridad.";

type RulesAiEnvironment = Record<string, string | undefined>;

export type RulesAiClient = {
  responses: {
    create: (input: Record<string, unknown>) => Promise<{ output_text?: string }>;
  };
};

export function rulesAiConfig(env: RulesAiEnvironment) {
  const hasApiKey = Boolean(env.OPENAI_API_KEY?.trim());
  const hasVectorStore = Boolean(env.OPENAI_RULES_VECTOR_STORE_ID?.trim());
  const enabled = env.RULES_AI_ENABLED === "true";
  return {
    enabled,
    hasApiKey,
    hasVectorStore,
    ready: enabled && hasApiKey && hasVectorStore,
    model: env.OPENAI_RULES_MODEL?.trim() || DEFAULT_RULES_AI_MODEL,
    vectorStoreId: env.OPENAI_RULES_VECTOR_STORE_ID?.trim() || "",
  };
}

export function publicRulesAiStatus(env: RulesAiEnvironment) {
  const config = rulesAiConfig(env);
  return {
    enabled: config.ready,
    configured: config.hasApiKey && config.hasVectorStore,
    state: config.ready ? "ready" as const : config.enabled ? "missing_config" as const : "disabled" as const,
  };
}

export function classifyRulesAiFailure(error: unknown) {
  const detail = error && typeof error === "object" ? error as { status?: number; code?: string; message?: string; name?: string } : {};
  const text = `${detail.code || ""} ${detail.message || ""}`.toLowerCase();
  if (detail.status === 429 && /quota|credit|billing/.test(text)) return { status: 503, code: "quota", message: "La IA está configurada, pero el proveedor no tiene crédito disponible. Intenta más tarde." };
  if (detail.status === 429) return { status: 429, code: "rate_limit", message: "Hay demasiadas consultas en este momento. Intenta de nuevo en un minuto." };
  if (detail.status === 401 || detail.status === 403 || /api.?key|authentication/.test(text)) return { status: 503, code: "provider_config", message: "La conexión privada del reglamento necesita revisión de configuración." };
  if (detail.name === "AbortError" || /timeout|timed out|aborted/.test(text)) return { status: 504, code: "timeout", message: "La consulta tardó demasiado. Intenta nuevamente." };
  if (/fetch|network|connection|econn/.test(text)) return { status: 502, code: "network", message: "No pudimos conectar con el proveedor de IA. Intenta nuevamente." };
  return { status: 502, code: "temporary", message: "No fue posible consultar el reglamento en este momento." };
}

export function isLaVistaRulesContext(courseName: string, question: string) {
  const activeCourse = courseName.trim();
  if (activeCourse) return isLaVistaCourse(activeCourse);
  return /\bla\s+vista(?:\s+temporal)?\b/i.test(question);
}

function sanitizeLocalRules(rules: LocalRule[]) {
  return activeLocalRules(rules).slice(0, 30).map((rule) => ({
    title: rule.title.trim().slice(0, 160),
    text: rule.text.trim().slice(0, 1200),
    hole: Number.isInteger(rule.hole) && Number(rule.hole) >= 1 && Number(rule.hole) <= 18 ? Number(rule.hole) : null,
  }));
}

export function buildRulesAiInstructions() {
  return [
    "Responde siempre en español y solo con evidencia recuperada de los documentos indexados o de las reglas locales activas incluidas en el contexto.",
    "Jerarquía para reglas deportivas: 1) Reglas de Golf/USGA, 2) Aclaraciones vigentes, 3) Procedimientos del Comité, 4) Regla Local La Vista cuando el contexto sea La Vista.",
    "Si una Regla Local de La Vista modifica o complementa la regla general, separa REGLA GENERAL y REGLA LOCAL · LA VISTA y explica la relación.",
    "Nunca apliques una Regla Local de La Vista a otro campo.",
    "El Código de Caballeros solo sirve para etiqueta, comportamiento, convivencia, ritmo, respeto, cultura y apuestas. Nunca derives de él golpe de castigo, pérdida del hoyo, descalificación ni otra penalidad deportiva.",
    "Usa exactamente estos encabezados: QUÉ PROCEDE, PENALIDAD, QUÉ DEBO HACER, REGLA y FUENTE. Agrega REGLA LOCAL solo cuando corresponda.",
    `Si la evidencia no permite confirmar número, penalidad o procedimiento, responde: “${RULES_AI_UNCERTAIN_MESSAGE}” No inventes nada.`,
    "En REGLA incluye número y nombre. En FUENTE identifica el documento utilizado. Termina recordando que en competencia el Comité o árbitro tiene la decisión final.",
  ].join("\n");
}

export function buildRulesQuestionContext({ question, courseName, localRules }: { question: string; courseName: string; localRules?: LocalRule[] }) {
  const laVista = isLaVistaRulesContext(courseName, question);
  const rules = laVista ? sanitizeLocalRules(Array.isArray(localRules) ? localRules : LA_VISTA_LOCAL_RULES) : [];
  const context = rules.length
    ? rules.map((rule) => `- ${rule.hole ? `Hoyo ${rule.hole} · ` : ""}${rule.title}: ${rule.text}`).join("\n")
    : "No aplicar reglas locales de La Vista en esta consulta.";
  const activeCourse = courseName.trim().slice(0, 120);
  const noRoundNotice = activeCourse ? "" : "\nNO HAY RONDA ACTIVA. Responde con las Reglas generales. Si una Regla Local pudiera cambiar el resultado, indica: “Esta respuesta corresponde a las Reglas generales de Golf. Una Regla Local del campo podría modificar el procedimiento.”\n";
  return `CAMPO ACTUAL: ${activeCourse || "Sin ronda activa"}\nLas Reglas Locales de La Vista únicamente son aplicables a La Vista y La Vista Temporal.${noRoundNotice}\nREGLAS LOCALES ACTIVAS DEL CONTEXTO:\n${context}\n\nPREGUNTA:\n${question}`;
}

export function cleanRulesAiAnswer(answer: string) {
  return answer
    .replace(/filecite[^]*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

export async function askRulesWithClient({
  client,
  env,
  question,
  courseName,
  localRules,
}: {
  client: RulesAiClient;
  env: RulesAiEnvironment;
  question: string;
  courseName: string;
  localRules?: LocalRule[];
}) {
  const config = rulesAiConfig(env);
  if (!config.ready) throw new Error("RULES_AI_NOT_READY");
  const response = await client.responses.create({
    model: config.model,
    instructions: buildRulesAiInstructions(),
    input: buildRulesQuestionContext({ question, courseName, localRules }),
    tools: [{ type: "file_search", vector_store_ids: [config.vectorStoreId], max_num_results: 12 }],
    include: ["file_search_call.results"],
  });
  return cleanRulesAiAnswer(response.output_text || "") || RULES_AI_UNCERTAIN_MESSAGE;
}
