export const GPS_PILOT_PATH = "/gps-pilot/la-vista-1";
export const GPS_PILOT_LOGIN_PATH = "/gps-pilot/login";
export const GPS_PILOT_RETURN_KEY = "the-backyard:gps-pilot-auth-return:v1";
const MAX_AGE = 60 * 60 * 1000;
type ReturnStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Navigation hint only. Fixed destination; never accepts user-provided URLs,
 * tokens, account IDs or authorization. Normal auth returns stay unchanged. */
export function rememberGpsPilotReturn(storage: ReturnStorage | null, host: string, now = Date.now()) {
  if (host !== "dev.thebackyard.com.mx") return;
  try { storage?.setItem(GPS_PILOT_RETURN_KEY, JSON.stringify({ path: GPS_PILOT_PATH, createdAt: now })); }
  catch { /* The dedicated login page still returns after OTP if storage is unavailable. */ }
}

export function consumeGpsPilotReturn(storage: ReturnStorage | null, host: string, now = Date.now()): string | null {
  try {
    const raw = storage?.getItem(GPS_PILOT_RETURN_KEY);
    storage?.removeItem(GPS_PILOT_RETURN_KEY);
    if (host !== "dev.thebackyard.com.mx" || !raw) return null;
    const value = JSON.parse(raw);
    return value?.path === GPS_PILOT_PATH && Number.isFinite(value.createdAt) &&
      value.createdAt <= now && now - value.createdAt <= MAX_AGE ? GPS_PILOT_PATH : null;
  } catch { return null; }
}

export function gpsReturnStorage(): ReturnStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}
