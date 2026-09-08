export type LegalReturnContext = "account" | "onboarding" | "access" | "app";
export const LEGAL_APP_RETURN_KEY = "backyard-legal-app-return-v1";
const APP_SCREENS = new Set(["welcome", "setup", "round", "standings", "personals", "personalDetail", "historyDetail", "results", "history", "courses", "rules", "pollaLive", "account", "groups"]);

export function legalReturnDestination(value: string | null, appScreen?: string | null) {
  if (value === "account") return { href: "/?screen=account", label: "← Regresar a Mi Cuenta" };
  if (value === "onboarding") return { href: "/", label: "← Regresar al consentimiento" };
  if (value === "access") return { href: "/", label: "← Regresar al acceso" };
  if (value === "app") return { href: APP_SCREENS.has(appScreen || "") ? `/?screen=${appScreen}` : "/", label: "← Regresar a la app" };
  return { href: "/", label: "← Volver a The Backyard" };
}

export function preserveLegalReturn(href: string, value: string | null) {
  if (!value || !["account", "onboarding", "access", "app"].includes(value)) return href;
  const [path, hash = ""] = href.split("#");
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}returnTo=${value}${hash ? `#${hash}` : ""}`;
}

export function legalAppReturnScreen(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { screen?: unknown };
    return typeof value.screen === "string" && APP_SCREENS.has(value.screen) ? value.screen : null;
  } catch { return null; }
}
