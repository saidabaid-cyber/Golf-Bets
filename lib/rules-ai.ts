import type { LocalRule } from "./types";
import { formatRulesEvidence, isLaVistaRulesContext, retrieveRulesEvidence, type RulesEvidence } from "./rules-evidence";
import type { RulesAiProviderName, RulesAiTextProvider } from "./rules-ai-providers";

export const DEFAULT_GEMINI_RULES_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OPENAI_RULES_MODEL = "gpt-5.4-mini";
export const DEFAULT_RULES_AI_PROVIDER: RulesAiProviderName = "openai";
export const RULES_AI_UNCERTAIN_MESSAGE = "No encontré suficiente fundamento en las reglas disponibles para responder con seguridad.";

type RulesAiEnvironment = Record<string, string | undefined>;

export function rulesAiConfig(env: RulesAiEnvironment) {
  const configuredProvider = env.RULES_AI_PROVIDER?.trim().toLowerCase();
  const providerSupported = !configuredProvider || configuredProvider === "gemini" || configuredProvider === "openai";
  const provider: RulesAiProviderName = configuredProvider === "gemini" || configuredProvider === "openai"
    ? configuredProvider
    : DEFAULT_RULES_AI_PROVIDER;
  const hasApiKey = provider === "gemini" ? Boolean(env.GEMINI_API_KEY?.trim()) : Boolean(env.OPENAI_API_KEY?.trim());
  const enabled = env.RULES_AI_ENABLED === "true";
  return {
    enabled,
    provider,
    providerSupported,
    hasApiKey,
    ready: enabled && providerSupported && hasApiKey,
    model: provider === "gemini"
      ? env.GEMINI_RULES_MODEL?.trim() || DEFAULT_GEMINI_RULES_MODEL
      : env.OPENAI_RULES_MODEL?.trim() || DEFAULT_OPENAI_RULES_MODEL,
  };
}

export function rulesAiProviderSecret(env: RulesAiEnvironment) {
  const config = rulesAiConfig(env);
  return config.provider === "gemini" ? env.GEMINI_API_KEY?.trim() || "" : env.OPENAI_API_KEY?.trim() || "";
}

export function publicRulesAiStatus(env: RulesAiEnvironment) {
  const config = rulesAiConfig(env);
  return {
    enabled: config.ready,
    configured: config.providerSupported && config.hasApiKey,
    state: config.ready ? "ready" as const : config.enabled ? "missing_config" as const : "disabled" as const,
  };
}

export function classifyRulesAiFailure(error: unknown, selectedProvider?: RulesAiProviderName) {
  const detail = error && typeof error === "object" ? error as { provider?: RulesAiProviderName; status?: number; code?: string; message?: string; name?: string } : {};
  const provider = detail.provider || selectedProvider || "openai";
  const text = `${detail.code || ""} ${detail.message || ""}`.toLowerCase();
  if (provider === "gemini" && detail.status === 429) {
    return { status: 503, code: "quota", message: "Gemini alcanzó la cuota disponible para este proyecto. Intenta más tarde o revisa sus límites en Google AI Studio." };
  }
  if (detail.status === 429 && /quota|credit|billing/.test(text)) return { status: 503, code: "quota", message: "La IA está configurada, pero el proveedor no tiene crédito disponible. Intenta más tarde." };
  if (detail.status === 429) return { status: 429, code: "rate_limit", message: "Hay demasiadas consultas en este momento. Intenta de nuevo en un minuto." };
  if (detail.status === 400 || detail.status === 404 || /model.?not.?found|invalid.?argument/.test(text)) return { status: 503, code: "provider_config", message: "El modelo configurado para la IA de Reglas necesita revisión." };
  if (detail.status === 401 || detail.status === 403 || /api.?key|authentication|permission.?denied/.test(text)) return { status: 503, code: "provider_config", message: "La conexión privada del reglamento necesita revisión de configuración." };
  if (detail.name === "AbortError" || /timeout|timed out|aborted/.test(text)) return { status: 504, code: "timeout", message: "La consulta tardó demasiado. Intenta nuevamente." };
  if (/fetch|network|connection|econn/.test(text)) return { status: 502, code: "network", message: "No pudimos conectar con el proveedor de IA. Intenta nuevamente." };
  return { status: 502, code: "temporary", message: "No fue posible consultar el reglamento en este momento." };
}

export { isLaVistaRulesContext };

export function buildRulesAiInstructions() {
  return [
    "Responde siempre en español y únicamente con la EVIDENCIA RECUPERADA incluida en la solicitud.",
    "No uses conocimiento de memoria, búsqueda web ni información que no aparezca en los fragmentos [E#].",
    "Jerarquía para reglas deportivas: 1) Reglas de Golf/USGA, 2) Aclaraciones vigentes, 3) Procedimientos del Comité, 4) Regla Local La Vista cuando el contexto sea La Vista.",
    "Si una Regla Local de La Vista modifica o complementa la regla general, separa REGLA GENERAL y REGLA LOCAL · LA VISTA y explica la relación.",
    "Nunca apliques una Regla Local de La Vista a otro campo.",
    "El Código de Caballeros solo sirve para etiqueta, comportamiento, convivencia, ritmo, respeto, cultura y apuestas. Nunca derives de él golpe de castigo, pérdida del hoyo, descalificación ni otra penalidad deportiva.",
    "Usa exactamente estos encabezados: QUÉ PROCEDE, PENALIDAD, QUÉ DEBO HACER, REGLA y FUENTE. Agrega REGLA LOCAL · LA VISTA solo cuando corresponda.",
    "En REGLA incluye únicamente números y nombres respaldados por los fragmentos. En FUENTE cita los identificadores [E#] y el documento correspondiente.",
    `Si la evidencia no permite confirmar número, penalidad o procedimiento, responde exactamente: “${RULES_AI_UNCERTAIN_MESSAGE}”`,
    "Sé claro, breve y útil en campo. Termina recordando que en competencia el Comité o árbitro tiene la decisión final.",
  ].join("\n");
}

export function buildRulesQuestionContext({
  question,
  courseName,
  evidence,
  localRules,
}: {
  question: string;
  courseName: string;
  evidence?: RulesEvidence[];
  localRules?: LocalRule[];
}) {
  const resolvedEvidence = evidence || retrieveRulesEvidence({ question, courseName, localRules }).evidence;
  const activeCourse = courseName.trim().slice(0, 120);
  const noRoundNotice = activeCourse ? "" : "\nNO HAY RONDA ACTIVA. Responde con las Reglas generales. Si una Regla Local pudiera cambiar el resultado, aclara que una Regla Local del campo podría modificar el procedimiento.\n";
  return [
    `CAMPO ACTUAL: ${activeCourse || "Sin ronda activa"}`,
    "Las Reglas Locales de La Vista únicamente son aplicables a La Vista y La Vista Temporal.",
    noRoundNotice,
    "EVIDENCIA RECUPERADA:",
    formatRulesEvidence(resolvedEvidence),
    "",
    "PREGUNTA:",
    question,
  ].filter(Boolean).join("\n");
}

export function cleanRulesAiAnswer(answer: string) {
  return answer
    .replace(/filecite[^]*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

export async function askRulesWithProvider({
  provider,
  env,
  question,
  courseName,
  localRules,
}: {
  provider: RulesAiTextProvider;
  env: RulesAiEnvironment;
  question: string;
  courseName: string;
  localRules?: LocalRule[];
}) {
  const config = rulesAiConfig(env);
  if (!config.ready || provider.name !== config.provider) throw new Error("RULES_AI_NOT_READY");
  const retrieval = retrieveRulesEvidence({ question, courseName, localRules });
  if (!retrieval.sufficient) return RULES_AI_UNCERTAIN_MESSAGE;
  const answer = await provider.generate({
    model: config.model,
    instructions: buildRulesAiInstructions(),
    prompt: buildRulesQuestionContext({ question, courseName, evidence: retrieval.evidence }),
  });
  return cleanRulesAiAnswer(answer) || RULES_AI_UNCERTAIN_MESSAGE;
}
