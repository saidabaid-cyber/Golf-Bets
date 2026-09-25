export const PRODUCTION_APP_ORIGIN = "https://app.thebackyard.com.mx";
export const CANONICAL_QA_APP_ORIGIN = "https://dev.thebackyard.com.mx";
export const CANONICAL_QA_BRANCH_APP_ORIGIN = "https://golf-bets-git-integration-backyard-current-saha8.vercel.app";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function exactAppOrigin(value: string, errorCode: string) {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error(errorCode); }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash || (!local && parsed.port)) throw new Error(errorCode);
  return parsed.origin;
}

export function isLocalAppOrigin(value: string) {
  try { return LOCAL_HOSTS.has(new URL(value).hostname); }
  catch { return false; }
}

/**
 * Resolves every browser-generated callback/share URL from one stable origin.
 * Local development deliberately wins over a deployed build-time setting.
 * Remote Vercel/custom previews without NEXT_PUBLIC_APP_ORIGIN fail closed.
 */
export function resolveBrowserAppOrigin(browserOrigin: string, configuredOrigin?: string) {
  const browser = exactAppOrigin(browserOrigin, "invalid_browser_app_origin");
  if (isLocalAppOrigin(browser)) return browser;
  if (configuredOrigin?.trim()) {
    const configured = exactAppOrigin(configuredOrigin.trim(), "invalid_configured_app_origin");
    if (configured !== CANONICAL_QA_APP_ORIGIN && configured !== PRODUCTION_APP_ORIGIN) throw new Error("unsupported_configured_app_origin");
    // This exact Vercel branch alias is the temporary canonical QA entrypoint
    // while the custom QA domain is unavailable. PKCE state is stored by
    // browser origin, so its callbacks must return to the origin that started
    // the flow. Production remains bound only to its configured origin.
    if (configured === CANONICAL_QA_APP_ORIGIN && browser === CANONICAL_QA_BRANCH_APP_ORIGIN) return browser;
    if (browser !== configured) throw new Error("app_origin_environment_mismatch");
    return configured;
  }
  if (browser === CANONICAL_QA_APP_ORIGIN || browser === PRODUCTION_APP_ORIGIN) return browser;
  throw new Error("stable_app_origin_required");
}
