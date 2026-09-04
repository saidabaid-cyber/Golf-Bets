export type RulesAiRateLimitClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export class RulesAiRateLimitError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super("RULES_AI_RATE_LIMIT_UNAVAILABLE");
    this.name = "RulesAiRateLimitError";
    this.cause = cause;
  }
}

export async function consumePersistentRulesAiLimit(
  client: RulesAiRateLimitClient,
  keyHash: string,
  limit = 8,
  windowSeconds = 60,
) {
  const result = await client.rpc("consume_rules_ai_rate_limit", {
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (result.error) throw new RulesAiRateLimitError(result.error);
  if (typeof result.data !== "boolean") throw new RulesAiRateLimitError(new Error("invalid_rate_limit_response"));
  return result.data;
}
