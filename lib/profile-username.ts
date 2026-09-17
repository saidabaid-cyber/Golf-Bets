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
