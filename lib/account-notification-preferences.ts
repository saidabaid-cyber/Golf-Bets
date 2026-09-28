export type AccountNotificationPreferences = {
  push: boolean;
  email: boolean;
  rounds: boolean;
  reminders: boolean;
  updatedAt: string | null;
};

export type NotificationDeliveryCapability = {
  configured: boolean;
  state: "ready" | "not_configured";
};

export type AccountNotificationPreferenceResponse = {
  initialized: boolean;
  preferences: AccountNotificationPreferences;
  delivery: {
    push: NotificationDeliveryCapability;
    email: NotificationDeliveryCapability;
  };
};

export const DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES: AccountNotificationPreferences = {
  // This is the legacy/unknown fallback, not the new-account product default.
  // New accounts have explicit true values inserted server-side.
  push: false,
  email: false,
  rounds: false,
  reminders: false,
  updatedAt: null,
};

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseAccountNotificationPreferences(value: unknown): AccountNotificationPreferenceResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!body.preferences || typeof body.preferences !== "object" || Array.isArray(body.preferences)) return null;
  const preferences = body.preferences as Record<string, unknown>;
  const delivery = body.delivery && typeof body.delivery === "object" && !Array.isArray(body.delivery)
    ? body.delivery as Record<string, unknown>
    : {};
  const capability = (candidate: unknown): NotificationDeliveryCapability => {
    const source = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {};
    const configured = source.configured === true;
    return { configured, state: configured ? "ready" : "not_configured" };
  };
  return {
    initialized: body.initialized === true,
    preferences: {
      push: booleanOrDefault(preferences.push, DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.push),
      email: booleanOrDefault(preferences.email, DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.email),
      rounds: booleanOrDefault(preferences.rounds, DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.rounds),
      reminders: booleanOrDefault(preferences.reminders, DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES.reminders),
      updatedAt: typeof preferences.updatedAt === "string" && Number.isFinite(Date.parse(preferences.updatedAt))
        ? preferences.updatedAt
        : null,
    },
    delivery: { push: capability(delivery.push), email: capability(delivery.email) },
  };
}

export async function requestAccountNotificationPreferences(
  accessToken: string,
  preferences?: Omit<AccountNotificationPreferences, "updatedAt">,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const response = await transport("/api/account/notification-preferences", {
    method: preferences ? "PUT" : "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(preferences ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    signal,
    ...(preferences ? { body: JSON.stringify(preferences) } : {}),
  });
  const parsed = parseAccountNotificationPreferences(await response.json().catch(() => null));
  if (!response.ok || !parsed) throw new Error("No pudimos confirmar tus preferencias de notificaciones.");
  if (preferences && (parsed.preferences.push !== preferences.push
    || parsed.preferences.email !== preferences.email
    || parsed.preferences.rounds !== preferences.rounds
    || parsed.preferences.reminders !== preferences.reminders)) {
    throw new Error("El servidor no confirmó todas tus preferencias de notificaciones.");
  }
  return parsed;
}

/** Migrates the former per-device preferences exactly once. A legacy database
 * row has NULL channel columns and is returned as initialized=false. Missing
 * local values stay OFF; explicit legacy true/false choices are sent unchanged.
 * New accounts never take this branch because Auth persisted all four values. */
export async function bootstrapAccountNotificationPreferences(
  accessToken: string,
  local: Omit<AccountNotificationPreferences, "updatedAt">,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const remote = await requestAccountNotificationPreferences(accessToken, undefined, signal, transport);
  if (remote.initialized) return remote;
  return requestAccountNotificationPreferences(accessToken, local, signal, transport);
}
