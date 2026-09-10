export const PRODUCT_EVENT_NAMES = [
  "signup_completed",
  "round_created",
  "round_completed",
  "group_created",
  "friend_added",
  "ai_round_setup",
  "card_ai_used",
  "game_used",
  "gps_used",
  "shot_recorded",
  "ball_fit_completed",
  "course_selected",
  "round_invite_sent",
  "round_invite_accepted",
  "membership_benefits_viewed",
  "ai_insight_viewed",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];
export type ProductEventMetadata = Record<string, string | number | boolean | null>;

const SAFE_METADATA_KEYS = new Set([
  "source", "surface", "feature", "gameId", "courseId", "roundHoles", "playerCount",
  "result", "status", "errorCode", "provider", "model", "latencyMs", "quantity",
  "planId", "environment", "window", "deviceClass", "offline", "version",
]);
const SENSITIVE_KEY = /(email|name|prompt|image|photo|latitude|longitude|address|phone|token|secret|scorecard)/i;

export function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === "string" && (PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}

/** Analytics accepts only a narrow scalar allowlist and never carries prompts,
 * coordinates, names, images or contact details. Unknown keys are discarded. */
export function sanitizeProductEventMetadata(value: unknown): ProductEventMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: ProductEventMetadata = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SAFE_METADATA_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    if (raw === null || typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw))) output[key] = raw;
    else if (typeof raw === "string" && raw.length <= 120) output[key] = raw;
  }
  return output;
}

export type UsageWindow = "daily" | "monthly" | "lifetime";
export type UsageRecord = { userId: string; capability: string; quantity: number; occurredAt: string };

export function usageCount(records: readonly UsageRecord[], input: { userId: string; capability: string; window: UsageWindow; now: string }) {
  const now = new Date(input.now);
  if (Number.isNaN(now.getTime())) throw new Error("Fecha inválida.");
  return records.reduce((sum, record) => {
    if (record.userId !== input.userId || record.capability !== input.capability) return sum;
    const date = new Date(record.occurredAt);
    if (Number.isNaN(date.getTime())) return sum;
    if (input.window === "daily" && (date.getUTCFullYear() !== now.getUTCFullYear() || date.getUTCMonth() !== now.getUTCMonth() || date.getUTCDate() !== now.getUTCDate())) return sum;
    if (input.window === "monthly" && (date.getUTCFullYear() !== now.getUTCFullYear() || date.getUTCMonth() !== now.getUTCMonth())) return sum;
    return sum + Math.max(0, Number.isFinite(record.quantity) ? record.quantity : 0);
  }, 0);
}
