export const PROFILE_AUDIENCE_CHOICES = ["public", "friends"] as const;
export type ProfileAudienceChoice = (typeof PROFILE_AUDIENCE_CHOICES)[number];
export type PersistedProfileAudience = ProfileAudienceChoice | "private";

export function isProfileAudienceChoice(value: unknown): value is ProfileAudienceChoice {
  return value === "public" || value === "friends";
}

export function parseProfileAudienceResponse(value: unknown): PersistedProfileAudience | null {
  if (!value || typeof value !== "object") return null;
  const audience = (value as { visibility?: unknown }).visibility;
  return isProfileAudienceChoice(audience) || audience === "private" ? audience : null;
}

export async function requestProfileAudience(accessToken: string, choice?: ProfileAudienceChoice, signal?: AbortSignal, transport: typeof fetch = fetch) {
  const response = await transport("/api/account/privacy", {
    method: choice === undefined ? "GET" : "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, ...(choice === undefined ? {} : { "Content-Type": "application/json" }) },
    cache: "no-store", signal,
    ...(choice === undefined ? {} : { body: JSON.stringify({ visibility: choice }) }),
  });
  const body: unknown = await response.json().catch(() => null);
  const audience = parseProfileAudienceResponse(body);
  if (!response.ok || audience === null || (choice !== undefined && audience !== choice)) throw new Error("No pudimos confirmar tu privacidad. Reintenta.");
  return audience;
}
