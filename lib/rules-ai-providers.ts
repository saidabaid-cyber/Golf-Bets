export type RulesAiProviderName = "gemini" | "openai";

export type RulesAiGenerationInput = {
  model: string;
  instructions: string;
  prompt: string;
};

export type RulesAiTextProvider = {
  name: RulesAiProviderName;
  generate: (input: RulesAiGenerationInput) => Promise<string>;
};

export type RulesOpenAiClient = {
  responses: {
    create: (input: Record<string, unknown>) => Promise<{ output_text?: string }>;
  };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { code?: number; status?: string; message?: string };
};

export class RulesAiProviderRequestError extends Error {
  readonly provider: RulesAiProviderName;
  readonly status: number;
  readonly code: string;

  constructor(provider: RulesAiProviderName, status: number, code: string, message: string) {
    super(message || code || "RULES_AI_PROVIDER_ERROR");
    this.name = "RulesAiProviderRequestError";
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

export function createGeminiRulesProvider({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 20_000,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): RulesAiTextProvider {
  return {
    name: "gemini",
    async generate({ model, instructions, prompt }) {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 900 },
        }),
      });
      const payload = await response.json().catch(() => ({})) as GeminiResponse;
      if (!response.ok) {
        throw new RulesAiProviderRequestError(
          "gemini",
          response.status,
          payload.error?.status || String(payload.error?.code || response.status),
          payload.error?.message || response.statusText,
        );
      }
      return (payload.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();
    },
  };
}

export function createOpenAiRulesProvider(client: RulesOpenAiClient): RulesAiTextProvider {
  return {
    name: "openai",
    async generate({ model, instructions, prompt }) {
      const response = await client.responses.create({ model, instructions, input: prompt });
      return response.output_text?.trim() || "";
    },
  };
}
