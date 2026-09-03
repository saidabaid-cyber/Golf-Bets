export type AuthProviderStatus = {
  status: "ready" | "unconfigured" | "unavailable";
  email: boolean;
  google: boolean;
  apple: boolean;
};

/** Public Auth settings only. No admin key, user records, tokens or secrets. */
export async function readAuthProviderStatus(url?: string, publicKey?: string, request: typeof fetch = fetch): Promise<AuthProviderStatus> {
  const unavailable: AuthProviderStatus = { status: "unconfigured", email: false, google: false, apple: false };
  if (!url || !publicKey) return unavailable;
  try {
    const response = await request(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: publicKey }, cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ...unavailable, status: "unavailable" };
    const settings = await response.json() as { external?: Record<string, boolean> };
    if (!settings.external) return { ...unavailable, status: "unavailable" };
    return { status: "ready", email: settings.external.email === true, google: settings.external.google === true, apple: settings.external.apple === true };
  } catch { return { ...unavailable, status: "unavailable" }; }
}
