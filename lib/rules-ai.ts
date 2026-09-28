import type { LocalRule } from "./types";
import { formatRulesEvidence, isLaVistaRulesContext, retrieveRulesEvidence, type RulesEvidence } from "./rules-evidence";
import type { RulesAiProviderName, RulesAiTextProvider } from "./rules-ai-providers";
import { previewDatabaseFeaturesAvailable } from "./preview-database";

export const DEFAULT_GEMINI_RULES_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OPENAI_RULES_MODEL = "gpt-5.4-mini";
export const DEFAULT_RULES_AI_PROVIDER: RulesAiProviderName = "openai";
export const RULES_AI_UNCERTAIN_MESSAGE = "No encontré suficiente fundamento en las reglas disponibles para responder con seguridad.";
export const RULES_AI_FINAL_AUTHORITY_NOTICE = "En competencia, el Comité o árbitro oficial tiene la decisión final.";

type RulesAiEnvironment = Record<string, string | undefined>;

function enabledFlag(value: string | undefined) {
  return ["1", "true", "on", "enabled"].includes(value?.trim().toLocaleLowerCase("en-US") || "");
}

function enabledByDefault(value: string | undefined) {
  return !["0", "false", "off", "no"].includes(value?.trim().toLocaleLowerCase("en-US") || "");
}

function modelId(value: string | undefined) {
  const clean = value?.trim() || "";
  return clean.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(clean) ? clean : "";
}

export function rulesAiConfig(env: RulesAiEnvironment) {
  const configuredProvider = env.RULES_AI_PROVIDER?.trim().toLowerCase();
  const providerSupported = !configuredProvider || configuredProvider === "gemini" || configuredProvider === "openai";
  const provider: RulesAiProviderName = configuredProvider === "gemini" || configuredProvider === "openai"
    ? configuredProvider
    : DEFAULT_RULES_AI_PROVIDER;
  const hasApiKey = provider === "gemini" ? Boolean(env.GEMINI_API_KEY?.trim()) : Boolean(env.OPENAI_API_KEY?.trim());
  const enabled = enabledFlag(env.RULES_AI_ENABLED);
  const providerConfigured = providerSupported && hasApiKey;
  const limiterConfigured = enabledByDefault(env.CLOUD_ENABLED)
    && previewDatabaseFeaturesAvailable(env)
    && Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim())
    && Boolean((env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim());
  const configured = providerConfigured && limiterConfigured;
  return {
    enabled,
    provider,
    providerSupported,
    hasApiKey,
    providerConfigured,
    limiterConfigured,
    configured,
    providerReady: enabled && providerConfigured,
    ready: enabled && configured,
    model: provider === "gemini"
      ? modelId(env.GEMINI_RULES_MODEL) || DEFAULT_GEMINI_RULES_MODEL
      : modelId(env.OPENAI_RULES_MODEL) || DEFAULT_OPENAI_RULES_MODEL,
  };
}

export function rulesAiProviderSecret(env: RulesAiEnvironment) {
  const config = rulesAiConfig(env);
  return config.provider === "gemini" ? env.GEMINI_API_KEY?.trim() || "" : env.OPENAI_API_KEY?.trim() || "";
}

export function publicRulesAiStatus(env: RulesAiEnvironment) {
  const config = rulesAiConfig(env);
  return {
    enabled: config.enabled,
    configured: config.configured,
    provider: config.provider,
    model: config.model,
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
    "Usa exactamente estos encabezados, cada uno en su propia línea y en este orden: QUÉ PROCEDE, PENALIDAD, QUÉ DEBO HACER, REGLA y FUENTE. Agrega REGLA LOCAL · LA VISTA entre REGLA y FUENTE solo cuando corresponda.",
    "QUÉ PROCEDE, PENALIDAD, QUÉ DEBO HACER, REGLA y, cuando exista, REGLA LOCAL · LA VISTA deben incluir al menos una cita [E#] en su propio bloque.",
    "En PENALIDAD escribe únicamente la consecuencia canónica que aparezca expresamente en el fragmento citado (SIN PENALIDAD, UN GOLPE DE PENALIDAD, DOS GOLPES DE PENALIDAD, PENALIDAD GENERAL, PÉRDIDA DEL HOYO, DESCALIFICACIÓN o GOLPE Y DISTANCIA); no agregues explicación ni la deduzcas del número de Regla.",
    "En REGLA escribe únicamente el identificador exacto respaldado por el fragmento citado (por ejemplo Regla 17 o Regla 17.1), sin agregar títulos. Un capítulo general no respalda por sí solo una subregla inventada.",
    "En FUENTE repite todos los identificadores [E#] utilizados en los bloques anteriores y el documento correspondiente. No cites un fragmento que no respalde la afirmación del bloque.",
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

function buildRulesRepairContext({
  question,
  courseName,
  evidence,
}: {
  question: string;
  courseName: string;
  evidence: RulesEvidence[];
}) {
  return [
    buildRulesQuestionContext({ question, courseName, evidence }),
    "",
    "REPARACIÓN DE FORMATO Y GROUNDING:",
    "La respuesta anterior fue rechazada por el validador. Responde otra vez usando solo la evidencia anterior.",
    "Cada encabezado obligatorio debe ir solo en su propia línea y cada bloque debe incluir su cita [E#].",
    "En QUÉ PROCEDE y QUÉ DEBO HACER usa términos concretos presentes en el fragmento citado.",
    "En PENALIDAD escribe únicamente una consecuencia canónica exacta y su cita; no agregues explicación.",
    "En REGLA escribe únicamente Regla + el identificador exacto respaldado y su cita.",
    "En FUENTE incluye todos los [E#] usados y el documento correspondiente.",
    `Si no puedes cumplirlo únicamente con la evidencia, responde exactamente: “${RULES_AI_UNCERTAIN_MESSAGE}”`,
  ].join("\n");
}

export function cleanRulesAiAnswer(answer: string) {
  return answer
    .replace(/filecite[^]*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

export type RulesEvidenceReference = {
  citation: string;
  rule: string;
  title: string;
  source: string;
  sourceId: string;
  sourceUrl?: string;
  page?: number;
  local: boolean;
};

export type RulesAiAnswerResult = {
  answer: string;
  evidence: RulesEvidenceReference[];
};

function evidenceReferences(evidence: readonly RulesEvidence[]): RulesEvidenceReference[] {
  return evidence.map((entry, index) => ({
    citation: `[E${index + 1}]`,
    rule: entry.rule,
    title: entry.title,
    source: entry.source,
    sourceId: entry.sourceId,
    ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
    ...(entry.page ? { page: entry.page } : {}),
    local: entry.local,
  }));
}

const REQUIRED_RULES_AI_SECTIONS = ["QUÉ PROCEDE", "PENALIDAD", "QUÉ DEBO HACER", "REGLA", "FUENTE"] as const;
const OPTIONAL_LOCAL_RULE_SECTION = "REGLA LOCAL · LA VISTA" as const;
type RulesAiSectionName = typeof REQUIRED_RULES_AI_SECTIONS[number] | typeof OPTIONAL_LOCAL_RULE_SECTION;

function sectionHeading(line: string): RulesAiSectionName | null {
  const normalized = line.trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:\*\*|__)/, "")
    .replace(/(?:\*\*|__)$/, "")
    .replace(/:\s*$/, "")
    .trim()
    .toLocaleUpperCase("es-MX");
  return [...REQUIRED_RULES_AI_SECTIONS, OPTIONAL_LOCAL_RULE_SECTION].includes(normalized as RulesAiSectionName)
    ? normalized as RulesAiSectionName
    : null;
}

function parseRulesAiSections(answer: string) {
  const sections = new Map<RulesAiSectionName, string[]>();
  const order: RulesAiSectionName[] = [];
  let current: RulesAiSectionName | null = null;
  for (const line of answer.split(/\r?\n/)) {
    const heading = sectionHeading(line);
    if (heading) {
      if (sections.has(heading)) return null;
      sections.set(heading, []);
      order.push(heading);
      current = heading;
      continue;
    }
    if (!current) {
      if (line.trim()) return null;
      continue;
    }
    sections.get(current)!.push(line);
  }
  const expectedWithoutLocal: RulesAiSectionName[] = [...REQUIRED_RULES_AI_SECTIONS];
  const expectedWithLocal: RulesAiSectionName[] = [
    "QUÉ PROCEDE", "PENALIDAD", "QUÉ DEBO HACER", "REGLA", OPTIONAL_LOCAL_RULE_SECTION, "FUENTE",
  ];
  const orderMatches = (expected: readonly RulesAiSectionName[]) => expected.length === order.length
    && expected.every((heading, index) => order[index] === heading);
  if (!orderMatches(expectedWithoutLocal) && !orderMatches(expectedWithLocal)) return null;
  const parsed = new Map<RulesAiSectionName, string>();
  for (const [heading, lines] of sections) {
    const body = lines.join("\n").trim();
    if (!body || !body.replace(/\[E\d+\]/g, "").replace(/[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ]+/g, "")) return null;
    parsed.set(heading, body);
  }
  return parsed;
}

function sectionCitations(value: string, evidenceCount: number) {
  const tokens = value.match(/\[E[^\]\r\n]*\]/gi) || [];
  const matches = Array.from(value.matchAll(/\[E(\d+)\]/g));
  if (!matches.length || tokens.length !== matches.length) return null;
  const citations = matches.map((match) => Number(match[1]));
  if (citations.some((citation) => !Number.isSafeInteger(citation) || citation < 1 || citation > evidenceCount)) return null;
  return [...new Set(citations)];
}

type PenaltyFact = "none" | "one_stroke" | "two_strokes" | "general" | "loss_of_hole" | "disqualification" | "stroke_and_distance";

function normalizedFactText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}

function answerPenaltyFacts(value: string) {
  const normalized = normalizedFactText(value.replace(/\[E\d+\]/g, " "));
  const facts = new Set<PenaltyFact>();
  if (/\b(?:sin|ninguna|no hay)\s+(?:golpe\s+de\s+)?penalidad\b|\bcero\s+golpes?\b/.test(normalized)) facts.add("none");
  if (/\b(?:un|1)\s+golpe\b|\bpenalidad\s+de\s+(?:un|1)\s+golpe\b/.test(normalized)) facts.add("one_stroke");
  if (/\b(?:dos|2)\s+golpes\b|\bpenalidad\s+de\s+(?:dos|2)\s+golpes\b/.test(normalized)) facts.add("two_strokes");
  if (/\bpenalidad\s+general\b/.test(normalized)) facts.add("general");
  if (/\bperdida\s+del\s+hoyo\b/.test(normalized)) facts.add("loss_of_hole");
  if (/\bdescalificacion\b/.test(normalized)) facts.add("disqualification");
  if (/\bgolpe\s+y\s+distancia\b/.test(normalized)) facts.add("stroke_and_distance");
  return facts;
}

function penaltySectionHasOnlyCanonicalFacts(value: string) {
  const normalized = normalizedFactText(value.replace(/\[E\d+\]/g, " "));
  const remainder = normalized
    .replace(/\bgolpe\s+y\s+distancia\b/g, " ")
    .replace(/\b(?:sin|ninguna|no hay)\s+(?:golpe\s+de\s+)?penalidad\b/g, " ")
    .replace(/\b(?:un|1|dos|2)\s+golpes?\s+de\s+penalidad\b/g, " ")
    .replace(/\bpenalidad\s+general\b/g, " ")
    .replace(/\bperdida\s+del\s+hoyo\b/g, " ")
    .replace(/\bdescalificacion\b/g, " ")
    .replace(/\b(?:y|o)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  return remainder.length === 0;
}

function evidencePenaltyFacts(entry: RulesEvidence) {
  const normalized = normalizedFactText([entry.rule, entry.title, entry.excerpt].join(" "));
  const facts = new Set<PenaltyFact>();
  if (/\b(?:sin|ninguna|no hay)\s+(?:golpe\s+de\s+)?penalidad\b|\balivio\s+gratis\b/.test(normalized)) facts.add("none");
  if (/\b(?:un|1)\s+golpe\s+(?:de\s+)?(?:penalidad|castigo)\b|\bpenalidad\s+de\s+(?:un|1)\s+golpe\b/.test(normalized)) facts.add("one_stroke");
  if (/\b(?:dos|2)\s+golpes\s+(?:de\s+)?(?:penalidad|castigo)\b|\bpenalidad\s+de\s+(?:dos|2)\s+golpes\b/.test(normalized)) facts.add("two_strokes");
  if (/\bpenalidad\s+general\b/.test(normalized)) facts.add("general");
  if (/\bperdida\s+del\s+hoyo\b/.test(normalized)) facts.add("loss_of_hole");
  if (/\bdescalificacion\b/.test(normalized)) facts.add("disqualification");
  if (/\bgolpe\s+y\s+distancia\b/.test(normalized)) facts.add("stroke_and_distance");
  return facts;
}

const RULE_REFERENCE = "(?:[1-9]|1\\d|2[0-5])(?:\\.\\d+){0,2}[a-z]?(?:\\(\\d+\\))?";

function answerRuleReferences(value: string) {
  const clean = value.replace(/\[E\d+\]/g, " ");
  const matches = Array.from(
    clean.matchAll(new RegExp(`(?:^|\\b)(?:regla\\s+)?(${RULE_REFERENCE})(?![\\w(]|\\.\\d)`, "gi")),
    (match) => match[1].toLocaleLowerCase("es-MX"),
  );
  return [...new Set(matches)];
}

function ruleSectionHasOnlyCanonicalReferences(value: string) {
  const normalized = normalizedFactText(value.replace(/\[E\d+\]/g, " "));
  const remainder = normalized
    .replace(new RegExp(`\\bregla\\s+${RULE_REFERENCE}(?![\\w(]|\\.\\d)`, "gi"), " ")
    .replace(/\bregla\s+local\b/g, " ")
    .replace(/\b(?:y|o)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  return remainder.length === 0;
}

function evidenceRuleReferences(entry: RulesEvidence) {
  const references = new Set<string>();
  const canonical = entry.rule.trim().match(new RegExp(`^(${RULE_REFERENCE})$`, "i"));
  if (canonical) references.add(canonical[1].toLocaleLowerCase("es-MX"));
  const mentions = [entry.title, entry.excerpt].join(" ").matchAll(new RegExp(`\\bregla\\s+(${RULE_REFERENCE})(?![\\w(]|\\.\\d)`, "gi"));
  for (const mention of mentions) references.add(mention[1].toLocaleLowerCase("es-MX"));
  return references;
}

function ruleReferenceIsGrounded(reference: string, evidence: readonly RulesEvidence[]) {
  for (const entry of evidence) {
    for (const grounded of evidenceRuleReferences(entry)) {
      if (reference === grounded) return true;
      if (!reference.includes(".") && grounded.startsWith(`${reference}.`)) return true;
    }
  }
  return false;
}

const GROUNDING_STOP_WORDS = new Set([
  "ahora", "aplica", "aplicable", "bola", "cada", "campo", "como", "cuando", "debe", "debes", "debo",
  "desde", "donde", "esta", "este", "esto", "golf", "hacer", "hasta", "juego", "jugador", "misma", "mismo",
  "para", "pero", "puede", "puedes", "regla", "segun", "sobre", "tiene", "toma", "usar", "utiliza",
]);

function groundingTokens(value: string) {
  const tokens = normalizedFactText(value.replace(/\[E\d+\]/g, " ")).match(/[a-z0-9]{4,}/g) || [];
  return new Set(tokens.filter((token) => !GROUNDING_STOP_WORDS.has(token)));
}

function proseSectionIsGrounded(value: string, citations: readonly number[], evidence: readonly RulesEvidence[]) {
  const claims = groundingTokens(value);
  if (!claims.size) return false;
  const support = groundingTokens(citations.map((citation) => {
    const entry = evidence[citation - 1];
    return [entry.rule, entry.title, entry.excerpt, entry.source].join(" ");
  }).join(" "));
  let overlap = 0;
  for (const token of claims) if (support.has(token)) overlap += 1;
  return overlap >= Math.min(2, claims.size);
}

function groundedRulesAnswer(answer: string, evidence: readonly RulesEvidence[]) {
  const clean = cleanRulesAiAnswer(answer);
  if (clean === RULES_AI_UNCERTAIN_MESSAGE) return { answer: clean, citations: [] as number[] };
  const sections = clean ? parseRulesAiSections(clean) : null;
  if (!sections) return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
  const citationsBySection = new Map<RulesAiSectionName, number[]>();
  for (const [heading, body] of sections) {
    const citations = sectionCitations(body, evidence.length);
    if (!citations) return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
    citationsBySection.set(heading, citations);
  }
  const substantiveSections: RulesAiSectionName[] = ["QUÉ PROCEDE", "PENALIDAD", "QUÉ DEBO HACER", "REGLA"];
  if (sections.has(OPTIONAL_LOCAL_RULE_SECTION)) substantiveSections.push(OPTIONAL_LOCAL_RULE_SECTION);
  const sourceCitations = new Set(citationsBySection.get("FUENTE") || []);
  const substantiveCitations = substantiveSections.flatMap((heading) => citationsBySection.get(heading) || []);
  if (substantiveCitations.some((citation) => !sourceCitations.has(citation))) {
    return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
  }
  for (const heading of ["QUÉ PROCEDE", "QUÉ DEBO HACER"] as const) {
    if (!proseSectionIsGrounded(sections.get(heading) || "", citationsBySection.get(heading) || [], evidence)) {
      return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
    }
  }

  const penaltyCitations = citationsBySection.get("PENALIDAD") || [];
  const penaltyFacts = answerPenaltyFacts(sections.get("PENALIDAD") || "");
  if (!penaltySectionHasOnlyCanonicalFacts(sections.get("PENALIDAD") || "")
    || !penaltyFacts.size || (penaltyFacts.has("none") && penaltyFacts.size > 1)) {
    return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
  }
  const groundedPenaltyFacts = new Set<PenaltyFact>();
  for (const citation of penaltyCitations) {
    for (const fact of evidencePenaltyFacts(evidence[citation - 1])) groundedPenaltyFacts.add(fact);
  }
  if ([...penaltyFacts].some((fact) => !groundedPenaltyFacts.has(fact))) {
    return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
  }

  const ruleCitations = citationsBySection.get("REGLA") || [];
  const citedRuleEvidence = ruleCitations.map((citation) => evidence[citation - 1]);
  const ruleBody = sections.get("REGLA") || "";
  const ruleReferences = answerRuleReferences(ruleBody);
  const groundedLocalRule = /\bregla\s+local\b/i.test(ruleBody) && citedRuleEvidence.some((entry) => entry.local);
  if (!ruleSectionHasOnlyCanonicalReferences(ruleBody)
    || (!ruleReferences.length && !groundedLocalRule)
    || ruleReferences.some((reference) => !ruleReferenceIsGrounded(reference, citedRuleEvidence))) {
    return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
  }
  if (sections.has(OPTIONAL_LOCAL_RULE_SECTION)) {
    const localCitations = citationsBySection.get(OPTIONAL_LOCAL_RULE_SECTION) || [];
    if (!localCitations.some((citation) => evidence[citation - 1].local)) {
      return { answer: RULES_AI_UNCERTAIN_MESSAGE, citations: [] as number[] };
    }
  }

  const citations = [...new Set([...substantiveCitations, ...sourceCitations])];
  const withAuthority = /comit[eé][\s\S]*?[aá]rbitro[\s\S]*?decisi[oó]n final/i.test(clean)
    ? clean
    : `${clean}\n\n${RULES_AI_FINAL_AUTHORITY_NOTICE}`;
  return { answer: withAuthority, citations };
}

export async function answerRulesWithProvider({
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
}): Promise<RulesAiAnswerResult> {
  const config = rulesAiConfig(env);
  if (!config.providerReady || provider.name !== config.provider) throw new Error("RULES_AI_NOT_READY");
  const retrieval = retrieveRulesEvidence({ question, courseName, localRules });
  if (!retrieval.sufficient) return { answer: RULES_AI_UNCERTAIN_MESSAGE, evidence: [] };
  let providerAnswer = await provider.generate({
    model: config.model,
    instructions: buildRulesAiInstructions(),
    prompt: buildRulesQuestionContext({ question, courseName, evidence: retrieval.evidence }),
  });
  let grounded = groundedRulesAnswer(providerAnswer, retrieval.evidence);
  if (grounded.answer === RULES_AI_UNCERTAIN_MESSAGE
    && cleanRulesAiAnswer(providerAnswer) !== RULES_AI_UNCERTAIN_MESSAGE) {
    providerAnswer = await provider.generate({
      model: config.model,
      instructions: buildRulesAiInstructions(),
      prompt: buildRulesRepairContext({ question, courseName, evidence: retrieval.evidence }),
    });
    grounded = groundedRulesAnswer(providerAnswer, retrieval.evidence);
  }
  const references = evidenceReferences(retrieval.evidence);
  return {
    answer: grounded.answer,
    evidence: grounded.citations.map((citation) => references[citation - 1]),
  };
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
  return (await answerRulesWithProvider({ provider, env, question, courseName, localRules })).answer;
}
