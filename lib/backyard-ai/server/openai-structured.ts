import "server-only";

export type BackyardAiJsonSchema = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export type BackyardAiResponseInput = string | Array<Record<string, unknown>>;

export type BackyardOpenAiClient = {
  responses: {
    create: (input: Record<string, unknown>) => Promise<{ output_text?: string; status?: string; error?: unknown }>;
  };
};

export class BackyardAiProviderError extends Error {
  readonly code: "empty_response" | "incomplete_response" | "invalid_json";

  constructor(code: "empty_response" | "incomplete_response" | "invalid_json") {
    super(`BACKYARD_AI_${code.toLocaleUpperCase("en-US")}`);
    this.name = "BackyardAiProviderError";
    this.code = code;
  }
}

/**
 * Calls the model only as a structured interpreter. Domain validation and every
 * monetary calculation remain outside this boundary.
 */
export async function generateBackyardAiJson<T>({
  client,
  model,
  instructions,
  input,
  format,
  maxOutputTokens = 2_500,
}: {
  client: BackyardOpenAiClient;
  model: string;
  instructions: string;
  input: BackyardAiResponseInput;
  format: BackyardAiJsonSchema;
  maxOutputTokens?: number;
}) {
  const response = await client.responses.create({
    model,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: format.name,
        description: format.description,
        schema: format.schema,
        strict: true,
      },
    },
  });
  if (response.error || (response.status && response.status !== "completed")) {
    throw new BackyardAiProviderError("incomplete_response");
  }
  const text = response.output_text?.trim();
  if (!text) throw new BackyardAiProviderError("empty_response");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BackyardAiProviderError("invalid_json");
  }
}

export function classifyBackyardAiFailure(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; name?: unknown } : {};
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (code === "insufficient_quota" || code === "credit_balance_exhausted") {
    return { status: 503, code: "quota", message: "Backyard AI no tiene capacidad disponible en este momento." };
  }
  if (status === 429 || code === "rate_limit_exceeded") {
    return { status: 429, code: "rate_limit", message: "Backyard AI está recibiendo muchas solicitudes. Intenta de nuevo en un momento." };
  }
  if (candidate.name === "AbortError" || candidate.name === "APIConnectionTimeoutError" || code === "ETIMEDOUT") {
    return { status: 504, code: "timeout", message: "Backyard AI tardó demasiado. Tu configuración manual sigue disponible." };
  }
  if (status === 401 || status === 403 || status === 404) {
    return { status: 503, code: "provider_config", message: "Backyard AI necesita configuración del servidor." };
  }
  if (error instanceof BackyardAiProviderError) {
    return { status: 502, code: error.code, message: "Backyard AI devolvió una interpretación inválida. Tu configuración manual sigue intacta." };
  }
  return { status: 502, code: "provider_error", message: "No pudimos interpretar la solicitud. Puedes reintentar o usar la configuración manual." };
}
