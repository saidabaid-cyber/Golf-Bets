/** Same format as the existing Social unique username constraint. Empty legacy
 * values mean no rename; they must not erase the established public handle. */
export function normalizeProfileUsername(value: string | undefined): string | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const username = value.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._]{1,39}$/.test(username)) {
    throw Object.assign(new Error("Usa entre 2 y 40 letras, números, puntos o guiones bajos en tu username."), { code: "PROFILE_USERNAME_INVALID" });
  }
  return username;
}

export function canonicalProfileUsername(username: unknown, fallback: string | undefined): string {
  return typeof username === "string" && username.trim() ? username.trim() : fallback || "";
}

export async function checkProfileUsernameAvailability(
  accessToken: string | null,
  username: string,
  fetcher: typeof fetch = fetch,
) {
  if (!accessToken) throw new Error("Inicia sesión para cambiar tu nombre de usuario.");
  const normalized = normalizeProfileUsername(username);
  if (!normalized) throw new Error("Escribe un nombre de usuario.");
  const response = await fetcher(`/api/account/username?username=${encodeURIComponent(normalized)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { available?: boolean; error?: string } | null;
  if (!response.ok) throw new Error(result?.error || "No pudimos validar el nombre de usuario. Reintenta.");
  return result?.available === true;
}
